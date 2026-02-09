import os
import secrets
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db import get_db
from app.models import User, SlackSettings

logger = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/slack/oauth", tags=["slack"])


def _env(name: str) -> str:
    v = os.getenv(name, "").strip()
    if not v:
        raise HTTPException(status_code=500, detail=f"Missing ENV: {name}")
    return v


@router.get("/start")
def slack_oauth_start(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    1) state 생성 후 DB에 저장
    2) Slack authorize URL로 redirect
    """
    client_id = _env("SLACK_CLIENT_ID")
    redirect_uri = _env("SLACK_REDIRECT_URL")

    # ✅ incoming webhook을 받으려면 보통 incoming-webhook scope 필요
    # (추가로 chat:write 등을 원하면 여기에 추가)
    scope = "incoming-webhook"

    state = secrets.token_urlsafe(24)
    current_user.slack_oauth_state = state
    db.commit()

    # Slack OAuth authorize URL
    url = (
        "https://slack.com/oauth/v2/authorize"
        f"?client_id={client_id}"
        f"&scope={scope}"
        f"&redirect_uri={redirect_uri}"
        f"&state={state}"
    )
    return RedirectResponse(url)


@router.get("/callback")
def slack_oauth_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # 1) state 검증
    if not current_user.slack_oauth_state or state != current_user.slack_oauth_state:
        raise HTTPException(status_code=400, detail="Invalid state")

    client_id = _env("SLACK_CLIENT_ID")
    client_secret = _env("SLACK_CLIENT_SECRET")
    redirect_uri = _env("SLACK_REDIRECT_URL")

    # 2) code 교환
    resp = httpx.post(
        "https://slack.com/api/oauth.v2.access",
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
        },
        timeout=10.0,
        follow_redirects=True,
    ).json()

    if not resp.get("ok"):
        raise HTTPException(status_code=400, detail=resp.get("error", "oauth_failed"))

    # 3) incoming webhook 저장
    incoming = resp.get("incoming_webhook") or {}
    webhook_url = (incoming.get("url") or "").strip()
    channel = incoming.get("channel")  # "#incoming-webhook" 같은 값

    if not webhook_url:
        raise HTTPException(status_code=400, detail="no_incoming_webhook")

    row = db.query(SlackSettings).filter(SlackSettings.owner_id == current_user.id).first()
    if row is None:
        row = SlackSettings(owner_id=current_user.id, webhook_url=webhook_url, is_enabled=True)
        db.add(row)
    else:
        row.webhook_url = webhook_url
        row.is_enabled = True

    row.channel_name = channel
    db.commit()

    # 4) state 지우기
    current_user.slack_oauth_state = None
    db.commit()

    # 완료 후 어디로 보낼지: WEB_BASE_URL 있으면 거기로, 없으면 로컬 경로
    web_base = os.getenv("WEB_BASE_URL", "").strip()
    if web_base:
        return RedirectResponse(f"{web_base.rstrip('/')}/settings/slack?connected=1")

    return RedirectResponse("/settings/slack?connected=1")