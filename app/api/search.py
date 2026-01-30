import asyncio
import json

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text 

from app.auth.deps import get_current_user
from app.db import SessionLocal, get_db
from app.models import OutboxEvent, ProductSearch, User
from app.schemas import SearchListResponse
from app.services.dashboard_service import get_dashboard_stats
# from app.services.embedding_service import make_product_embedding
from app.services.notification_service import list_notifications, to_iso_z
from app.services.search_service import search_products
from app.services.vector_search_service import hybrid_search_products
from app.auth.deps import get_current_user_sse

router = APIRouter(prefix="/search", tags=["search"])


class ProductUpsert(BaseModel):
    name: str
    category: str
    price: int
    qty: int


class ProductUpdate(BaseModel):
    name: str
    category: str
    price: int


@router.get("/products")
def get_search_products(
    q: str | None = None,
    category: str | None = None,
    minQty: int | None = Query(None, ge=0),
    maxQty: int | None = Query(None, ge=0),
    minPrice: int | None = Query(None, ge=0),
    maxPrice: int | None = Query(None, ge=0),
    sortBy: str = Query("updated_at"),
    sortOrder: Literal["asc", "desc"] = Query("desc"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if q and q.strip():
        items = hybrid_search_products(
            db,
            owner_id=current_user.id,
            q=q.strip(),
            top_k=limit,
            category=category,
            minQty=minQty,
            maxQty=maxQty,
            minPrice=minPrice,
            maxPrice=maxPrice,
        )
        return {"count": len(items), "items": items}

    total, items = search_products(
        db,
        owner_id=current_user.id,
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
    safe_items = []
    for p in items:
        safe_items.append(
            {
                "product_id": p["product_id"],
                "name": p["name"],
                "category": p["category"],
                "price": p["price"],
                "qty": p["qty"],
                "updated_at": p["updated_at"],
            }
        )
    return {"count": total, "items": safe_items}


@router.get("/products/{product_id}")
def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = (
        db.query(ProductSearch)
        .filter(
            ProductSearch.product_id == product_id,
            ProductSearch.owner_id == current_user.id,
        )
        .first()
    )

    if item is None:
        raise HTTPException(status_code=404, detail="Product not found")

    return {
        "product_id": item.product_id,
        "name": item.name,
        "category": item.category,
        "price": item.price,
        "qty": item.qty,
        "updated_at": item.updated_at,
    }


@router.get("/alerts/low-stock", response_model=SearchListResponse)
def low_stock_alerts(
    threshold: int = Query(10, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    items = (
        db.query(ProductSearch)
        .filter(
            ProductSearch.owner_id == current_user.id,
            ProductSearch.qty <= threshold,
        )
        .order_by(ProductSearch.qty.asc(), ProductSearch.updated_at.desc())
        .limit(limit)
        .all()
    )

    return {"count": len(items), "items": items}


@router.get("/dashboard")
def get_dashboard(
    threshold: int = Query(10, ge=0),
    topN: int = Query(5, ge=1, le=20),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return get_dashboard_stats(
        db,
        owner_id=current_user.id,
        threshold=threshold,
        top_n=topN,
    )


@router.get("/notifications")
def get_notifications(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    items = list_notifications(db, owner_id=current_user.id, limit=limit)
    return {"items": items}


@router.get("/notifications/stream")
async def stream_notifications(
    request: Request,
    after_id: int = Query(0),
    limit: int = Query(10),
    interval: float = Query(1.0),
    current_user: User = Depends(get_current_user_sse),
):
    async def event_generator():
        last_id = after_id

        yield ": connected\n\n"

        while True:
            if await request.is_disconnected():
                break

            # 여기서 "세션을 짧게" 열고 닫기
            db = SessionLocal()
            try:
                rows = (
                    db.query(OutboxEvent)
                    .filter(
                        OutboxEvent.owner_id == current_user.id,
                        OutboxEvent.id > last_id,
                    )
                    .order_by(OutboxEvent.id.asc())
                    .limit(limit)
                    .all()
                )

                for r in rows:
                    item = {
                        "id": r.id,
                        "eventType": r.event_type,
                        "payload": r.payload_json,
                        "createdAt": to_iso_z(r.created_at),
                    }
                    last_id = r.id

                    yield f"id: {item['id']}\n"
                    yield "event: notification\n"
                    yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"

            finally:
                db.close()

            yield ": ping\n\n"
            await asyncio.sleep(interval)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # nginx 있으면 버퍼링 방지
        },
    )

@router.get("/categories")
def get_categories(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = db.execute(
        text("""
            SELECT DISTINCT category
            FROM product_search
            WHERE owner_id = :owner_id
              AND category IS NOT NULL
              AND category <> ''
            ORDER BY category ASC
        """),
        {"owner_id": current_user.id},
    ).all()

    return {"items": [r[0] for r in rows]}