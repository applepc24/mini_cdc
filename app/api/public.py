from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional, Literal

from app.db import get_db
from app.services.dashboard_service import get_dashboard_stats
from app.services.search_service import search_products, get_product_detail

router = APIRouter(prefix="/public", tags=["public"])


@router.get("/dashboard")
def public_dashboard(
    owner_id: int = Query(..., ge=1),
    threshold: int = Query(10, ge=0),
    topN: int = Query(5, ge=1, le=20),
    db: Session = Depends(get_db),
):
    return get_dashboard_stats(db, owner_id=owner_id, threshold=threshold, top_n=topN)


@router.get("/products")
def public_products(
    owner_id: int = Query(..., ge=1),
    q: Optional[str] = None,
    category: Optional[str] = None,
    minQty: Optional[int] = Query(None, ge=0),
    maxQty: Optional[int] = Query(None, ge=0),
    minPrice: Optional[int] = Query(None, ge=0),
    maxPrice: Optional[int] = Query(None, ge=0),
    sortBy: str = "updated_at",
    sortOrder: Literal["asc", "desc"] = "desc",
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    total, items = search_products(
        db=db,
        owner_id=owner_id,
        q=q,
        category=category,
        minQty=minQty,
        maxQty=maxQty,
        minPrice=minPrice,
        maxPrice=maxPrice,
        sortBy=sortBy,
        sortOrder=sortOrder,
        limit=limit,
        offset=offset,
    )
    return {"count": total, "items": list(items)}


@router.get("/products/{product_id}")
def public_product_detail(
    product_id: int,
    owner_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
):
    row = get_product_detail(db, owner_id=owner_id, product_id=product_id)
    return row


@router.get("/alerts/low-stock")
def public_low_stock(
    owner_id: int = Query(..., ge=1),
    threshold: int = Query(10, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    # 기존에 /search/alerts/low-stock 라우터가 이 쿼리로 만들었을 거라서
    # 여기서도 "search_products"로 대체해서 구현 (qty <= threshold + 정렬)
    total, items = search_products(
        db=db,
        owner_id=owner_id,
        q=None,
        category=None,
        minQty=None,
        maxQty=threshold,
        minPrice=None,
        maxPrice=None,
        sortBy="qty",
        sortOrder="asc",
        limit=limit,
        offset=0,
    )
    return {"count": total, "items": list(items)}