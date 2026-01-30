from __future__ import annotations

from typing import Literal, Optional, List, Dict
from pydantic import BaseModel

from app.ai.restock.schemas import Reason
from app.ai.restock.schemas import RestockRecommendation


class AgentTopNeed(BaseModel):
    productId: int
    name: str
    recommendIn: int
    reason: Reason


class AgentSummary(BaseModel):
    threshold: int
    needCount: int
    totalInQty: int
    byReason: Dict[str, int]
    topNeeds: List[AgentTopNeed]


class AgentDecision(BaseModel):
    action: Literal["apply", "dry_run", "noop"]
    threshold: int
    limit: int


class AgentToolCall(BaseModel):
    name: str
    status: Literal["ok", "skipped", "error"]
    dryRun: Optional[bool] = None


class AgentTrace(BaseModel):
    name: str
    ts: str
    data: dict = {}


class AgentPlanItem(BaseModel):
    productId: int
    quantity: int
    note: Optional[str] = None


class AgentResponse(BaseModel):
    ok: bool = True
    decision: AgentDecision
    summary: AgentSummary
    items: List[RestockRecommendation] = []
    plan: List[AgentPlanItem]
    toolCalls: List[AgentToolCall]
    trace: List[AgentTrace]
    idempotency: AgentIdempotency


IdemStatus = Literal["NONE","STARTED", "DONE", "FAILED", "REUSED"]

class AgentIdempotency(BaseModel):
    key: Optional[str] = None
    status: IdemStatus = "NONE"
    reused: bool = False