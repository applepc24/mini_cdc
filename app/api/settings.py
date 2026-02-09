from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import User
from app.auth.deps import get_current_user

router = APIRouter(prefix="/settings", tags=["settings"])


class SettingsUpdate(BaseModel):
    slack_webhook_url: str | None = None

    notify_on_import: bool | None = None
    notify_failures: bool | None = None
    notify_zero_stock: bool | None = None
    zero_stock_threshold: int | None = None


@router.get("")
def get_settings(current_user: User = Depends(get_current_user)):
    return {
        "slack_webhook_url": current_user.slack_webhook_url,
        "notify_on_import": current_user.notify_on_import,
        "notify_failures": current_user.notify_failures,
        "notify_zero_stock": current_user.notify_zero_stock,
        "zero_stock_threshold": current_user.zero_stock_threshold,
    }


@router.put("")
def update_settings(payload: SettingsUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # 1) webhook 처리 (기존 그대로)
    if payload.slack_webhook_url is not None:
        url = (payload.slack_webhook_url or "").strip()

        if url == "":
            current_user.slack_webhook_url = None
        else:
            if not url.startswith("https://hooks.slack.com/services/"):
                raise HTTPException(status_code=400, detail="Invalid Slack Webhook URL")
            current_user.slack_webhook_url = url

    # 2) 옵션 처리
    if payload.notify_on_import is not None:
        current_user.notify_on_import = payload.notify_on_import
    if payload.notify_failures is not None:
        current_user.notify_failures = payload.notify_failures
    if payload.notify_zero_stock is not None:
        current_user.notify_zero_stock = payload.notify_zero_stock
    if payload.zero_stock_threshold is not None:
        if payload.zero_stock_threshold < 1:
            raise HTTPException(status_code=400, detail="zero_stock_threshold must be >= 1")
        current_user.zero_stock_threshold = payload.zero_stock_threshold

    db.commit()
    db.refresh(current_user)

    return {
        "ok": True,
        "slack_webhook_url": current_user.slack_webhook_url,
        "notify_on_import": current_user.notify_on_import,
        "notify_failures": current_user.notify_failures,
        "notify_zero_stock": current_user.notify_zero_stock,
        "zero_stock_threshold": current_user.zero_stock_threshold,
    }