# app/ai/restock/idempotency.py
from __future__ import annotations

from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert
from datetime import datetime, timedelta, timezone

from app.models import RestockIdempotency

STALE_AFTER = timedelta(minutes=5)

def _row_ts(row):
    return getattr(row, "updated_at", None) or getattr(row, "created_at", None)

def _is_stale(row) -> bool:
    ts = _row_ts(row)
    if ts is None:
        return False
    return datetime.now(timezone.utc) - ts > STALE_AFTER

def idem_start_or_get(
    db: Session,
    *,
    owner_id: int,
    endpoint: str,
    idem_key: str,
    request_json: dict[str, Any],
) -> Optional["RestockIdempotency"]:
    """
    - 새로 STARTED row 만들면: 해당 row 리턴
    - 이미 있으면:
        DONE    -> None 리턴 (라우터에서 response_json 그대로 응답)
        STARTED -> 409 (진행중)  단 stale이면 takeover 허용
        FAILED  -> 같은 key로 재시도 허용 (STARTED로 되돌리고 row 리턴)
    """
    stmt = (
        insert(RestockIdempotency)
        .values(
            owner_id=owner_id,
            endpoint=endpoint,
            idem_key=idem_key,
            request_json=request_json,
            status="STARTED",
        )
        .on_conflict_do_nothing(index_elements=["owner_id", "idem_key", "endpoint"])
        .returning(RestockIdempotency.id)
    )

    new_id = db.execute(stmt).scalar_one_or_none()
    if new_id is not None:
        return db.get(RestockIdempotency, new_id)

    row = (
        db.query(RestockIdempotency)
        .filter_by(owner_id=owner_id, idem_key=idem_key, endpoint=endpoint)
        .one()
    )

    if row.status == "DONE":
        return None

    # ✅ A정책: FAILED면 같은 key로 재시도 허용
    if row.status == "FAILED":
        row.status = "STARTED"
        row.request_json = request_json
        row.response_json = None
        if hasattr(row, "error_json"):
            row.error_json = None
        db.flush()
        return row

    # STARTED는 보통 409, 단 stale이면 takeover해서 계속 진행
    if row.status == "STARTED":
        if _is_stale(row):
            row.status = "STARTED"           # 그대로 두고
            row.request_json = request_json  # 최신 요청으로 갱신
            row.response_json = None
            if hasattr(row, "error_json"):
                row.error_json = {"detail": "previous attempt stale; retrying with same key"}
            db.flush()
            return row

        raise HTTPException(
            status_code=409,
            detail=f"idempotency_key already used and status=STARTED (in progress).",
        )

    raise HTTPException(
        status_code=409,
        detail=f"idempotency_key already used and status={row.status}.",
    )


def idem_mark_done(db: Session, *, row: RestockIdempotency, response_json: dict[str, Any]) -> None:
    row.status = "DONE"
    row.response_json = response_json

def idem_mark_failed(db: Session, *, row: RestockIdempotency, error: dict[str, Any]) -> None:
    row.status = "FAILED"
    row.error_json = error 