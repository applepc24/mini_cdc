# app/api/slack.py
import os
import re
import secrets
from datetime import datetime
from typing import Optional
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db import get_db
from app.models import User, SlackSettings

# ✅ Public: OAuth callback(토큰 없이 들어옴)
router_public = APIRouter(prefix="/slack", tags=["slack"])

# ✅ Private: 나머지는 토큰 필요
router_private = APIRouter(
    prefix="/slack",
    tags=["slack"],
    dependencies=[Depends(get_current_user)],
)

# ----------------------------
# helpers
# ----------------------------
def _env(name: str) -> str:
    return (os.getenv(name) or "").strip()


def _web_base() -> str:
    # 프론트 주소(배포/로컬)를 환경변수로 받고, 없으면 로컬로
    return (_env("WEB_BASE_URL") or "http://localhost:3000").rstrip("/")


def _redirect_success() -> str:
    return f"{_web_base()}/settings?slack=connected"


def _redirect_error(reason: str) -> str:
    return f"{_web_base()}/settings?slack=failed&reason={reason}"


def mask_webhook(url: str) -> str:
    if not url:
        return ""
    if len(url) <= 24:
        return url[:6] + "..."
    return url[:18] + "..." + url[-10:]


def looks_like_slack_webhook(url: str) -> bool:
    return bool(
        re.search(r"^https://hooks\.slack\.com/services/[^/]+/[^/]+/[^/]+$", url.strip())
    )


# ----------------------------
# schemas
# ----------------------------
class SlackSettingsOut(BaseModel):
    is_enabled: bool
    channel_name: Optional[str] = None
    webhook_masked: str


class SlackSettingsUpsertIn(BaseModel):
    webhook_url: Optional[str] = Field(default=None, description="Slack Incoming Webhook URL")
    is_enabled: bool = True
    channel_name: Optional[str] = None

    notify_on_import: bool = True
    notify_failures: bool = True
    notify_zero_stock: bool = True
    zero_stock_threshold: int = 1


class SlackTestResult(BaseModel):
    ok: bool
    status_code: Optional[int] = None
    error: Optional[str] = None

class SlackOauthStartOut(BaseModel):
    authorize_url: str


# ----------------------------
# Private: settings CRUD
# ----------------------------
@router_private.get("/settings", response_model=SlackSettingsOut)
def get_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = db.query(SlackSettings).filter(SlackSettings.owner_id == current_user.id).first()
    if not row:
        return SlackSettingsOut(is_enabled=False, channel_name=None, webhook_masked="")

    return SlackSettingsOut(
        is_enabled=bool(row.is_enabled),
        channel_name=getattr(row, "channel_name", None),
        webhook_masked=mask_webhook(row.webhook_url),
    )


@router_private.put("/settings", response_model=SlackSettingsOut)
def upsert_settings(
    payload: SlackSettingsUpsertIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = db.query(SlackSettings).filter(SlackSettings.owner_id == current_user.id).first()

    # webhook_url 검증(있을 때만)
    if payload.webhook_url is not None:
        if payload.webhook_url.strip() == "":
            payload.webhook_url = None
        else:
            if not looks_like_slack_webhook(payload.webhook_url):
                raise HTTPException(status_code=400, detail="Invalid Slack webhook_url format")

    if not row:
        if not payload.webhook_url:
            raise HTTPException(status_code=400, detail="webhook_url is required for first setup")

        row = SlackSettings(
            owner_id=current_user.id,
            webhook_url=payload.webhook_url,
            is_enabled=payload.is_enabled,
            channel_name=payload.channel_name,
            notify_on_import=payload.notify_on_import,
            notify_failures=payload.notify_failures,
            notify_zero_stock=payload.notify_zero_stock,
            zero_stock_threshold=max(1, int(payload.zero_stock_threshold or 1)),
        )
        db.add(row)
    else:
        if payload.webhook_url is not None and payload.webhook_url.strip():
            row.webhook_url = payload.webhook_url.strip()

        row.is_enabled = payload.is_enabled
        row.channel_name = payload.channel_name

        row.notify_on_import = payload.notify_on_import
        row.notify_failures = payload.notify_failures
        row.notify_zero_stock = payload.notify_zero_stock
        row.zero_stock_threshold = max(1, int(payload.zero_stock_threshold or 1))

    db.commit()
    db.refresh(row)

    return SlackSettingsOut(
        is_enabled=bool(row.is_enabled),
        channel_name=getattr(row, "channel_name", None),
        webhook_masked=mask_webhook(row.webhook_url),
    )


@router_private.post("/settings/test", response_model=SlackTestResult)
def test_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = db.query(SlackSettings).filter(SlackSettings.owner_id == current_user.id).first()
    if not row or not row.webhook_url:
        raise HTTPException(status_code=400, detail="Slack webhook is not configured")
    if not row.is_enabled:
        raise HTTPException(status_code=400, detail="Slack notifications are disabled")

    msg = (
        f"✅ Slack 연결 테스트\n"
        f"• user: {current_user.email}\n"
        f"• channel: {getattr(row, 'channel_name', None) or '(unknown)'}\n"
        f"• time: {datetime.now().isoformat(timespec='seconds')}"
    )

    try:
        r = httpx.post(row.webhook_url, json={"text": msg}, timeout=5.0)
        ok = 200 <= r.status_code < 300
        return SlackTestResult(ok=ok, status_code=r.status_code, error=None if ok else r.text[:200])
    except Exception as e:
        return SlackTestResult(ok=False, status_code=None, error=str(e)[:200])


# ----------------------------
# Private: OAuth start (토큰 필요)
# ----------------------------
@router_private.get("/oauth/start", response_model=SlackOauthStartOut)
def slack_oauth_start(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    client_id = _env("SLACK_CLIENT_ID")
    redirect_uri = _env("SLACK_REDIRECT_URL")
    if not client_id or not redirect_uri:
        raise HTTPException(status_code=500, detail="slack_oauth_env_missing")

    state = secrets.token_urlsafe(32)
    current_user.slack_oauth_state = state
    db.commit()

    params = {
        "client_id": client_id,
        "scope": "incoming-webhook",
        "redirect_uri": redirect_uri,
        "state": state,
    }
    authorize_url = "https://slack.com/oauth/v2/authorize?" + urlencode(params)

    # ✅ Redirect가 아니라 JSON 반환
    return SlackOauthStartOut(authorize_url=authorize_url)


# ----------------------------
# Public: OAuth callback (토큰 없이 들어옴)
# ----------------------------
@router_public.get("/oauth/callback")
def slack_oauth_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: Session = Depends(get_db),
):
    # 1) state로 유저 찾기
    user = db.query(User).filter(User.slack_oauth_state == state).first()
    if not user:
        # 중복/재시도 UX: 성공으로 보내버림
        return RedirectResponse(_redirect_success(), status_code=302)

    client_id = _env("SLACK_CLIENT_ID")
    client_secret = _env("SLACK_CLIENT_SECRET")
    redirect_uri = _env("SLACK_REDIRECT_URL")
    if not client_id or not client_secret or not redirect_uri:
        return RedirectResponse(_redirect_error("env_missing"), status_code=302)

    # 2) code 교환
    try:
        resp = httpx.post(
            "https://slack.com/api/oauth.v2.access",
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "redirect_uri": redirect_uri,
            },
            timeout=10.0,
        ).json()
    except Exception:
        return RedirectResponse(_redirect_error("oauth_exchange_failed"), status_code=302)

    if not resp.get("ok"):
        err = resp.get("error") or "oauth_failed"
        # code 1회용/재시도 흡수
        if err in ("invalid_code", "expired_code", "bad_redirect_uri"):
            return RedirectResponse(_redirect_success(), status_code=302)
        return RedirectResponse(_redirect_error(err), status_code=302)

    # 3) incoming webhook 저장
    incoming = resp.get("incoming_webhook") or {}
    webhook_url = (incoming.get("url") or "").strip()
    channel = incoming.get("channel")

    if not webhook_url:
        return RedirectResponse(_redirect_error("no_incoming_webhook"), status_code=302)

    row = db.query(SlackSettings).filter(SlackSettings.owner_id == user.id).first()
    if row is None:
        row = SlackSettings(
            owner_id=user.id,
            webhook_url=webhook_url,
            is_enabled=True,
            channel_name=channel,
            notify_on_import=True,
            notify_failures=True,
            notify_zero_stock=True,
            zero_stock_threshold=1,
        )
        db.add(row)
    else:
        row.webhook_url = webhook_url
        row.is_enabled = True
        row.channel_name = channel

    # ✅ state 1회용 처리
    user.slack_oauth_state = None

    db.commit()
    return RedirectResponse(_redirect_success(), status_code=302)