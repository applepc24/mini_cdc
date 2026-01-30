# app/ai/restock/service.py
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List

from sqlalchemy.orm import Session

from app.ai.restock.repo import (
    collect_ids_and_categories,
    fetch_category_avg_daily,
    fetch_low_stock_rows,
    fetch_sales_by_product,
)
from app.ai.restock.policy import RestockPolicy
from app.crud import adjust_stock_with_outbox
from app.ai.restock.schemas import (
    ApplyDryRunResponse, ApplyExecuteResponse, ApplyItem, RestockRecommendation
)


def get_restock_recommendations(
    db: Session,
    owner_id: int,
    threshold: int,
    limit: int = 200,
    window_days: int = 30,
    cover_days: int = 5,
    fallback_days: int = 3,
) -> list[RestockRecommendation]:
    since = datetime.now(timezone.utc) - timedelta(days=window_days)
    recs: list[RestockRecommendation] = []

    low_rows = fetch_low_stock_rows(db, owner_id=owner_id, threshold=threshold, limit=limit)
    if not low_rows:
        return []

    product_ids, categories = collect_ids_and_categories(low_rows)

    sales_by_product = fetch_sales_by_product(db, owner_id=owner_id, since=since, product_ids=product_ids)
    cat_avg_daily = fetch_category_avg_daily(db, owner_id=owner_id, since=since, window_days=window_days, categories=categories)

    policy = RestockPolicy(window_days=window_days, cover_days=cover_days, fallback_days=fallback_days)

    recs: List[dict] = []
    for r in low_rows:
        out_qty = int(sales_by_product.get(r.product_id, 0) or 0)
        cad = cat_avg_daily.get(r.category) if r.category else None

        target, avg_daily, reason = policy.compute_target(
            threshold=threshold,
            product_out_qty=out_qty,
            category_avg_daily=cad,
        )
        recommend_in = policy.compute_recommend_in(current_qty=r.qty, target_qty=target)

        cover_days_used = (
            cover_days if reason == "product_sales"
            else (fallback_days if reason == "category_sales" else None)
        )

        recs.append(
            RestockRecommendation(
                productId=r.product_id,
                name=r.name,
                category=r.category,
                currentQty=r.qty,
                avgDaily=round(avg_daily, 4),
                targetQty=int(target),
                recommendIn=int(recommend_in),
                reason=reason,
                windowDays=window_days,
                coverDays=cover_days_used,
            )
        )

    return recs


def apply_restock_recommendations(
    db: Session,
    owner_id: int,
    threshold: int,
    limit: int = 200,
    window_days: int = 30,
    cover_days: int = 5,
    fallback_days: int = 3,
    dry_run: bool = True,
    note: str | None = "ai_restock",
) -> dict:
    recs = get_restock_recommendations(
        db=db,
        owner_id=owner_id,
        threshold=threshold,
        limit=limit,
        window_days=window_days,
        cover_days=cover_days,
        fallback_days=fallback_days,
    )

    plan = [r for r in recs if r.recommendIn > 0]

    if dry_run:
        return ApplyDryRunResponse(
            totalInQty=sum(x.recommendIn for x in plan),
            items=plan,
        )

    applied: list[ApplyItem] = []
    total_in = 0

    for r in plan:
        pid = r.productId
        qty_in = r.recommendIn

        res = adjust_stock_with_outbox(
            db=db,
            owner_id=owner_id,
            product_id=pid,
            adj_type="in",
            quantity=qty_in,
            note=note,
        )
        if res is None or res == "NEGATIVE":
            continue

        applied.append(ApplyItem(productId=pid, quantity=qty_in))
        total_in += qty_in

    return ApplyExecuteResponse(
        applyCount=len(applied),
        totalInQty=total_in,
        items=applied,
    )