from __future__ import annotations

from sqlalchemy.orm import Session
from app.services.restock_service import get_restock_recommendations  # 기존 구현 재사용

def recommend(
    db: Session,
    owner_id: int,
    threshold: int,
    limit: int,
) -> list[dict]:
    # (기존 함수 시그니처 유지) - 내부 로직은 이미 잘 동작하니까 그대로 호출만
    return get_restock_recommendations(
        db=db,
        owner_id=owner_id,
        threshold=threshold,
        limit=limit,
        window_days=30,
        cover_days=5,
        fallback_days=3,
    )