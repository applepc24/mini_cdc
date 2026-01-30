# app/ai/restock/agent.py
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
from sqlalchemy.orm import Session

from app.ai.restock.explain import summarize
from app.ai.restock.schemas import (
    ApplyExecuteResponse,
    ApplyResponse,
    RestockRecommendation,
)
from app.ai.restock.service import (
    apply_restock_recommendations,
    get_restock_recommendations,
)
from app.ai.restock.trace import AgentTrace
from app.models import OutboxEvent
from app.ai.restock.llm_explain import explain_with_llm

@dataclass(frozen=True)
class RestockAgentConfig:
    window_days: int = 30
    cover_days: int = 5
    fallback_days: int = 3
    note: str = "ai_restock"


class RestockAgent:
    """
    지금은 '오케스트레이션'만 담당.
    나중에 LLM 붙이면:
      - recommend/apply 앞뒤로 '분석/설명/검증' 스텝을 추가하면 됨.
    """

    def __init__(self, db: Session, config: Optional[RestockAgentConfig] = None):
        self.db = db
        self.cfg = config or RestockAgentConfig()

    def recommend(
        self, owner_id: int, threshold: int, limit: int
    ) -> list[RestockRecommendation]:
        return get_restock_recommendations(
            db=self.db,
            owner_id=owner_id,
            threshold=threshold,
            limit=limit,
            window_days=self.cfg.window_days,
            cover_days=self.cfg.cover_days,
            fallback_days=self.cfg.fallback_days,
        )
        
    def apply(
        self,
        owner_id: int,
        threshold: int,
        limit: int,
        dry_run: bool,
        idempotency_key: Optional[str] = None,
    ) -> ApplyResponse:
        note = self.cfg.note
        if idempotency_key:
            note = f"{note}:{idempotency_key}"

        # ✅ (dry_run=False일 때만) 중복 방지 체크
        if (not dry_run) and idempotency_key and self._already_applied(owner_id, note):
            # 실행은 안 하고 "이미 적용됨" 결과를 리턴 (형식은 네 schemas에 맞춰)
            return ApplyExecuteResponse(
                ok=True,
                dryRun=False,
                applyCount=0,
                totalInQty=0,
                items=[],
            )

        return apply_restock_recommendations(
            db=self.db,
            owner_id=owner_id,
            threshold=threshold,
            limit=limit,
            window_days=self.cfg.window_days,
            cover_days=self.cfg.cover_days,
            fallback_days=self.cfg.fallback_days,
            dry_run=dry_run,
            note=note,
        )

    def _already_applied(self, owner_id: int, note: str) -> bool:
        # outbox payload_json에 note가 들어가 있으니 그걸로 체크 (너 adjust_stock_with_outbox 구현 기준)
        q = (
            self.db.query(OutboxEvent.id)
            .filter(OutboxEvent.owner_id == owner_id)
            .filter(OutboxEvent.event_type == "STOCK_ADJUSTED")
            .filter(OutboxEvent.payload_json.op("->>")("note") == note)
            .limit(1)
        )
        return self.db.query(q.exists()).scalar()

    def recommend_with_meta(
        self, owner_id: int, threshold: int, limit: int, explain_llm: bool = False
    ) -> tuple[list[RestockRecommendation], dict]:
        trace = AgentTrace()
        trace.add("input", ownerId=owner_id, threshold=threshold, limit=limit, explainLLM=explain_llm)
        recs = self.recommend(owner_id=owner_id, threshold=threshold, limit=limit)

        summary = summarize(recs, threshold)

        meta: dict = {
            "summary": summary,
            "trace": [s.__dict__ for s in trace.steps],
        }

        # ✅ LLM 설명은 옵션 (기본 OFF)
        if explain_llm:
            # 너무 길어지는 것 방지: 추천 필요한 것만 + 상위 N개만
            need = [r for r in recs if r.recommendIn > 0]
            need_sorted = sorted(need, key=lambda x: x.recommendIn, reverse=True)[:20]

            trace.add("llm_explain_start", count=len(need_sorted))
            llm_exp = explain_with_llm(need_sorted, summary)
            meta["llm"] = llm_exp
            trace.add("llm_explain_done")

            # trace 갱신
            meta["trace"] = [s.__dict__ for s in trace.steps]
            

        return recs, meta
