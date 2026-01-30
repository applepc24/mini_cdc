from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db import get_db
from app.models import User

from app.ai.services.recommender import recommend
from app.ai.services.applier import apply
from typing import List
from app.ai.restock.schemas import RestockRecommendation, ApplyResponse

router = APIRouter(prefix="/ai", tags=["ai"])

@router.get("/restock/recommend", response_model=List[RestockRecommendation])
def restock_recommend(
    threshold: int = Query(14, ge=0),
    limit: int = Query(200, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return recommend(db=db, owner_id=current_user.id, threshold=threshold, limit=limit)

@router.post("/restock/apply", response_model=ApplyResponse)
def restock_apply(
    threshold: int = Query(14, ge=0),
    limit: int = Query(200, ge=1, le=500),
    dry_run: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return apply(
        db=db,
        owner_id=current_user.id,
        threshold=threshold,
        limit=limit,
        dry_run=dry_run,
    )