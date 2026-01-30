from __future__ import annotations

from sqlalchemy.orm import Session
from app.services.restock_service import apply_restock_recommendations  # 기존 구현 재사용

def apply(
    db: Session,
    owner_id: int,
    threshold: int,
    limit: int,
    dry_run: bool,
) -> dict:
    res = apply_restock_recommendations(
        db=db,
        owner_id=owner_id,
        threshold=threshold,
        limit=limit,
        dry_run=dry_run,
        window_days=30,
        cover_days=5,
        fallback_days=3,
    )
    return res