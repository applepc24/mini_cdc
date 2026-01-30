# app/ai/restock/explain.py
from __future__ import annotations
from typing import Iterable
from app.ai.restock.schemas import RestockRecommendation

def summarize(recs: Iterable[RestockRecommendation], threshold: int) -> dict:
    recs = list(recs)
    need = [r for r in recs if r.recommendIn > 0]

    by_reason = {}
    for r in need:
        by_reason[r.reason] = by_reason.get(r.reason, 0) + 1

    top = sorted(need, key=lambda x: x.recommendIn, reverse=True)[:5]
    return {
        "threshold": threshold,
        "needCount": len(need),
        "totalInQty": sum(r.recommendIn for r in need),
        "byReason": by_reason,
        "topNeeds": [
            {"productId": r.productId, "name": r.name, "recommendIn": r.recommendIn, "reason": r.reason}
            for r in top
        ],
    }