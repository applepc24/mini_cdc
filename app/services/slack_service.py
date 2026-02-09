import os
import logging
from collections import Counter
from typing import Optional

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import SlackSettings

logger = logging.getLogger("uvicorn.error")


def _env(name: str) -> Optional[str]:
    v = os.getenv(name)
    return v.strip() if v and v.strip() else None


def _build_upload_url(upload_id: int) -> Optional[str]:
    base = _env("WEB_BASE_URL")
    if not base:
        return None
    return f"{base.rstrip('/')}/csv-uploads/{upload_id}"


def mask_webhook(url: str) -> str:
    if not url:
        return ""
    if len(url) <= 20:
        return "***"
    return url[:18] + "..." + url[-10:]


def _get_slack_settings(db: Session, owner_id: int) -> Optional[SlackSettings]:
    # 1유저 1설정 (owner_id UNIQUE)
    return (
        db.execute(select(SlackSettings).where(SlackSettings.owner_id == owner_id))
        .scalars()
        .first()
    )


def send_csv_import_summary_to_slack(
    *,
    db: Session,
    owner_id: int,
    upload_id: int,
    file_name: str,
    inserted: int,
    skipped: int,
    failed: int,
    created: int,
    updated: int,
    unchanged: int,
    errors: list[dict],
    zero_count: int = 0,
    actor: Optional[str] = None,
    timeout_sec: float = 5.0,
) -> bool:
    settings = _get_slack_settings(db, owner_id)

    # ✅ 설정 없으면(연결 안함) 종료
    if not settings:
        logger.info("Slack settings missing (owner_id=%s)", owner_id)
        return False

    # ✅ 전체 알림 OFF
    if not settings.is_enabled:
        logger.info("Slack disabled (owner_id=%s)", owner_id)
        return False

    webhook = (settings.webhook_url or "").strip()
    if not webhook:
        logger.info("Slack webhook empty (owner_id=%s)", owner_id)
        return False

    # ✅ import 알림 자체 OFF
    if not settings.notify_on_import:
        return False

    # 실패 Top3 만들기
    reasons = [e.get("reason", "") for e in errors if e.get("reason")]
    top3 = Counter(reasons).most_common(3)

    upload_url = _build_upload_url(upload_id)

    lines = [f"*CSV 업로드 완료*  (upload #{upload_id})"]
    if actor:
        lines.append(f"• 요청자: {actor}")
    lines.append(f"• 파일: `{file_name}`")
    lines.append(f"• 반영: *{inserted}*  (created {created}, updated {updated})")
    lines.append(f"• 스킵: *{skipped}*  (unchanged {unchanged})")
    lines.append(f"• 실패: *{failed}*")

    # ✅ 재고 0 알림 조건
    threshold = int(settings.zero_stock_threshold or 1)
    if settings.notify_zero_stock and zero_count >= max(1, threshold):
        lines.append(f"• ⚠ 재고 0 된 상품: *{zero_count}*개 (이번 업로드 기준)")

    # ✅ 실패 사유 블록 조건
    if settings.notify_failures and top3:
        lines.append("")
        lines.append("*실패 Top3 사유*")
        for reason, cnt in top3:
            label = reason if len(reason) <= 140 else reason[:140] + "…"
            lines.append(f"• ({cnt}) {label}")

    if upload_url:
        lines.append("")
        lines.append(f"상세 보기: {upload_url}")

    payload = {"text": "\n".join(lines)}
    logger.info(
        "Slack payload (owner_id=%s, upload_id=%s): %s",
        owner_id,
        upload_id,
        payload["text"].replace("\n", " | "),
    )

    try:
        r = httpx.post(
            webhook,
            json=payload,
            timeout=timeout_sec,
            follow_redirects=True,  # 302 대응
        )
        logger.info("Slack webhook status=%s body=%s", r.status_code, r.text[:200])
        return 200 <= r.status_code < 300
    except Exception:
        logger.exception("Slack webhook request failed (owner_id=%s)", owner_id)
        return False


def send_test_to_slack(webhook_url: str, actor: str | None = None, timeout_sec: float = 5.0) -> tuple[bool, int | None, str | None]:
    text = "✅ Slack 연결 테스트 성공"
    if actor:
        text += f" (by {actor})"

    payload = {"text": text}
    try:
        r = httpx.post(webhook_url, json=payload, timeout=timeout_sec, follow_redirects=True)
        ok = 200 <= r.status_code < 300
        return ok, r.status_code, (None if ok else r.text[:200])
    except Exception as e:
        return False, None, str(e)[:200]