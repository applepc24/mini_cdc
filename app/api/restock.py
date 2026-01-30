from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.ai.restock.agent import RestockAgent

# ✅ Step3-2: AgentResponse 스키마 (네가 만든 파일명에 맞춰 import)
from app.ai.restock.agent_schemas import (
    AgentDecision,
    AgentIdempotency,
    AgentPlanItem,
    AgentResponse,
    AgentSummary,
    AgentToolCall,
    AgentTopNeed,
    AgentTrace,
)
from app.ai.restock.idempotency import (
    idem_mark_done,
    idem_mark_failed,
    idem_start_or_get,
)
from app.ai.restock.schemas import (
    ApplyResponse,
    RestockDebugResponse,
    RestockRecommendation,
)
from app.auth.deps import get_current_user
from app.db import get_db
from app.models import RestockIdempotency, User

router = APIRouter(prefix="/ai/restock", tags=["ai"])


@router.get("/recommend", response_model=list[RestockRecommendation])
def recommend_restock(
    threshold: int = 10,
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = RestockAgent(db)
    return agent.recommend(owner_id=current_user.id, threshold=threshold, limit=limit)


@router.post("/apply", response_model=ApplyResponse)
def apply_restock(
    threshold: int = Query(14, ge=0),
    limit: int = Query(200, ge=1, le=500),
    dry_run: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = RestockAgent(db)
    result = agent.apply(
        owner_id=current_user.id,
        threshold=threshold,
        limit=limit,
        dry_run=dry_run,
    )

    if not dry_run:
        db.commit()

    return result


@router.get("/recommend/debug", response_model=RestockDebugResponse)
def recommend_debug(
    threshold: int = 10,
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = RestockAgent(db=db)

    items, meta = agent.recommend_with_meta(
        owner_id=current_user.id,
        threshold=threshold,
        limit=limit,
    )

    return RestockDebugResponse(
        items=items,
        summary=meta["summary"],
        trace=meta["trace"],
    )


@router.post("/agent", response_model=AgentResponse)
def restock_agent(
    threshold: int = Query(14, ge=0),
    limit: int = Query(200, ge=1, le=500),
    dry_run: bool = Query(True),
    explain_llm: bool = Query(False),
    idempotency_key: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    endpoint = "POST /ai/restock/agent"

    # ✅ 기본: 항상 idempotency를 채워서 내려보내기
    idem_info = AgentIdempotency(
        key=idempotency_key,
        status=("NONE" if dry_run else "STARTED"),  # 아래에서 REUSED로 바뀔 수 있음
        reused=False,
    )

    # ✅ 실행(apply)일 때만 idempotency_key 강제
    if (not dry_run) and (not idempotency_key):
        raise HTTPException(
            status_code=400,
            detail="idempotency_key is required when dry_run=false (apply).",
        )

    idem_row: RestockIdempotency | None = None

    # 0) idempotency START or GET (execute일 때만)
    if not dry_run:
        idem_row = idem_start_or_get(
            db,
            owner_id=current_user.id,
            endpoint=endpoint,
            idem_key=idempotency_key,  # 여기선 None 아님
            request_json={"threshold": threshold, "limit": limit, "dry_run": dry_run},
        )

        # DONE이면 기존 응답 그대로 리턴 + idempotency=REUSED 붙여서
        if idem_row is None:
            existing = (
                db.query(RestockIdempotency)
                .filter_by(
                    owner_id=current_user.id,
                    idem_key=idempotency_key,
                    endpoint=endpoint,
                )
                .one()
            )
            existing_json = existing.response_json or {}
            existing_json["idempotency"] = {
                "key": idempotency_key,
                "status": "REUSED",
                "reused": True,
            }
            return existing_json

        # 여기까지 왔으면 NEW 실행
        idem_info = AgentIdempotency(
            key=idempotency_key, status=("NONE" if dry_run else "STARTED"), reused=False
        )

    try:
        agent = RestockAgent(db=db)

        def now() -> str:
            return datetime.now(timezone.utc).isoformat()

        trace: list[AgentTrace] = [
            AgentTrace(
                name="start",
                ts=now(),
                data={
                    "ownerId": current_user.id,
                    "threshold": threshold,
                    "limit": limit,
                    "dryRun": dry_run,
                },
            )
        ]
        tool_calls: list[AgentToolCall] = []

        # 1) recommend
        items, meta = agent.recommend_with_meta(
            owner_id=current_user.id,
            threshold=threshold,
            limit=limit,
            explain_llm=explain_llm,
            
        )
        tool_calls.append(
            AgentToolCall(name="restock.recommend", status="ok", dryRun=None)
        )
        trace.extend(
            [
                AgentTrace(name=x["name"], ts=x["ts"], data=x.get("data", {}))
                for x in meta.get("trace", [])
            ]
        )

        plan_items = [r for r in items if r.recommendIn > 0]
        need_count = len(plan_items)
        total_in = sum(r.recommendIn for r in plan_items)

        by_reason: dict[str, int] = {}
        for r in plan_items:
            by_reason[r.reason] = by_reason.get(r.reason, 0) + 1

        top_needs = sorted(plan_items, key=lambda x: x.recommendIn, reverse=True)[:5]
        top_needs_out = [
            AgentTopNeed(
                productId=r.productId,
                name=r.name,
                recommendIn=r.recommendIn,
                reason=r.reason,
            )
            for r in top_needs
        ]

        note = "ai_restock" if not idempotency_key else f"ai_restock:{idempotency_key}"
        plan = [
            AgentPlanItem(productId=r.productId, quantity=r.recommendIn, note=note)
            for r in plan_items
        ]

        # 2) decision
        action = "noop" if need_count == 0 else ("dry_run" if dry_run else "apply")

        # 3) apply only if execute
        if (not dry_run) and (need_count > 0):
            res = agent.apply(
                owner_id=current_user.id,
                threshold=threshold,
                limit=limit,
                dry_run=False,
                idempotency_key=idempotency_key,
            )
            tool_calls.append(
                AgentToolCall(name="restock.apply", status="ok", dryRun=False)
            )
            trace.append(
                AgentTrace(
                    name="apply_done",
                    ts=now(),
                    data=(
                        res.model_dump() if hasattr(res, "model_dump") else dict(res)
                    ),
                )
            )
        else:
            tool_calls.append(
                AgentToolCall(name="restock.apply", status="skipped", dryRun=dry_run)
            )

        resp = AgentResponse(
            ok=True,
            decision=AgentDecision(action=action, threshold=threshold, limit=limit),
            summary=AgentSummary(
                threshold=threshold,
                needCount=need_count,
                totalInQty=total_in,
                byReason=by_reason,
                topNeeds=top_needs_out,
            ),
            items=items,
            plan=plan,
            toolCalls=tool_calls,
            trace=trace,
            idempotency=idem_info,  # ✅ 항상 포함
            llm=meta.get("llm"),
        )

        # ✅ DONE 저장 + commit (execute일 때만)
        if idem_row is not None:
            idem_mark_done(db, row=idem_row, response_json=resp.model_dump())

        if not dry_run:
            db.commit()

        return resp

    except Exception as e:
        # ✅ FAILED 저장 + commit (execute일 때만)
        if idem_row is not None:
            idem_mark_failed(
                db,
                row=idem_row,
                error={"type": type(e).__name__, "msg": str(e)},
            )
            db.commit()
        raise
