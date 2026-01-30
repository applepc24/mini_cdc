# app/ai/restock/features.py
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Dict, Iterable, List, Tuple

from sqlalchemy import Integer, cast, func, select
from sqlalchemy.orm import Session

from app.models import OutboxEvent, Product, Stock


@dataclass(frozen=True)
class LowStockRow:
    product_id: int
    name: str
    category: str | None
    qty: int


def _event_extractors():
    """
    Postgres JSONB ->> 추출식 통일
    payload_json: {"productId":..., "quantity":..., "type":"out"/"in", ...}
    """
    ev_product_id = cast(OutboxEvent.payload_json.op("->>")("productId"), Integer)
    ev_qty = cast(OutboxEvent.payload_json.op("->>")("quantity"), Integer)
    ev_type = OutboxEvent.payload_json.op("->>")("type")
    return ev_product_id, ev_qty, ev_type


def fetch_low_stock_rows(
    db: Session,
    owner_id: int,
    threshold: int,
    limit: int,
) -> List[LowStockRow]:
    rows = (
        db.execute(
            select(
                Product.id.label("product_id"),
                Product.name.label("name"),
                Product.category.label("category"),
                func.coalesce(Stock.qty, 0).label("qty"),
            )
            .select_from(Product)
            .outerjoin(
                Stock,
                (Stock.product_id == Product.id) & (Stock.owner_id == Product.owner_id),
            )
            .where(
                Product.owner_id == owner_id,
                Product.is_deleted.is_(False),
                func.coalesce(Stock.qty, 0) <= threshold,
            )
            .order_by(func.coalesce(Stock.qty, 0).asc(), Product.id.asc())
            .limit(limit)
        )
        .all()
    )

    return [
        LowStockRow(
            product_id=int(r.product_id),
            name=str(r.name),
            category=(str(r.category) if r.category is not None else None),
            qty=int(r.qty or 0),
        )
        for r in rows
    ]


def collect_ids_and_categories(
    low_rows: List[LowStockRow],
) -> Tuple[List[int], List[str]]:
    product_ids = [r.product_id for r in low_rows]
    categories = sorted({r.category for r in low_rows if r.category})
    return product_ids, categories


def fetch_sales_by_product(
    db: Session,
    owner_id: int,
    since: datetime,
    product_ids: Iterable[int],
) -> Dict[int, int]:
    ev_product_id, ev_qty, ev_type = _event_extractors()

    rows = db.execute(
        select(
            ev_product_id.label("product_id"),
            func.coalesce(func.sum(ev_qty), 0).label("out_qty"),
        )
        .where(
            OutboxEvent.owner_id == owner_id,
            OutboxEvent.event_type == "STOCK_ADJUSTED",
            ev_type == "out",
            OutboxEvent.created_at >= since,
            ev_product_id.in_(list(product_ids)),
        )
        .group_by(ev_product_id)
    ).all()

    return {int(pid): int(out_qty or 0) for pid, out_qty in rows}


def fetch_category_avg_daily(
    db: Session,
    owner_id: int,
    since: datetime,
    window_days: int,
    categories: Iterable[str],
) -> Dict[str, float]:
    categories = list(categories)
    if not categories:
        return {}

    ev_product_id, ev_qty, ev_type = _event_extractors()

    per_product_subq = (
        select(
            ev_product_id.label("product_id"),
            func.coalesce(func.sum(ev_qty), 0).label("out_qty"),
        )
        .where(
            OutboxEvent.owner_id == owner_id,
            OutboxEvent.event_type == "STOCK_ADJUSTED",
            ev_type == "out",
            OutboxEvent.created_at >= since,
        )
        .group_by(ev_product_id)
        .subquery()
    )

    cat_rows = db.execute(
        select(
            Product.category.label("category"),
            func.avg(per_product_subq.c.out_qty / float(window_days)).label("cat_avg_daily"),
        )
        .select_from(Product)
        .join(per_product_subq, per_product_subq.c.product_id == Product.id)
        .where(
            Product.owner_id == owner_id,
            Product.is_deleted.is_(False),
            Product.category.in_(categories),
            per_product_subq.c.out_qty > 0,
        )
        .group_by(Product.category)
    ).all()

    return {str(r.category): float(r.cat_avg_daily) for r in cat_rows}