# app/ai/restock/schemas.py
from __future__ import annotations

from typing import Annotated, Literal, Optional, Union, List, Dict, Any
from pydantic import BaseModel, Field

Reason = Literal["product_sales", "category_sales", "threshold_fallback"]


class RestockRecommendation(BaseModel):
    productId: int
    name: str
    category: Optional[str] = None
    currentQty: int
    avgDaily: float
    targetQty: int
    recommendIn: int
    reason: Reason
    windowDays: int
    coverDays: Optional[int] = None


class ApplyItem(BaseModel):
    productId: int
    quantity: int


class ApplyDryRunResponse(BaseModel):
    ok: bool = True
    dryRun: Literal[True] = True
    applyCount: int = 0
    totalInQty: int
    items: List[RestockRecommendation]


class ApplyExecuteResponse(BaseModel):
    ok: bool = True
    dryRun: Literal[False] = False
    applyCount: int
    totalInQty: int
    items: List[ApplyItem]

class RestockExplanation(BaseModel):
    overview: str
    top3: List[str]
    notes: List[str]
    perItem: Dict[int, str]

class RestockDebugResponse(BaseModel):
    items: List[RestockRecommendation]
    summary: Dict[str, Any]
    trace: List[Dict[str, Any]]
    llm: Optional[RestockExplanation] = None


# ✅ dryRun 값(True/False)으로 자동으로 타입이 결정됨
ApplyResponse = Annotated[
    Union[ApplyDryRunResponse, ApplyExecuteResponse],
    Field(discriminator="dryRun"),
]

