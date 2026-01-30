from __future__ import annotations

from typing import List, Dict, Any
from pydantic import BaseModel, Field

from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser

from app.ai.restock.schemas import RestockRecommendation, RestockExplanation
from app.ai.restock.llm_client import has_openai_key, get_openai_model_name


def _fallback_explain(
    recs: List[RestockRecommendation],
    summary: Dict[str, Any],
) -> RestockExplanation:
    need = [r for r in recs if r.recommendIn > 0]
    top = sorted(need, key=lambda x: x.recommendIn, reverse=True)[:3]

    by_reason = summary.get("byReason", {}) or {}
    parts = []
    parts.append(
        f"임계값 {summary.get('threshold')}개 기준으로 재입고 필요 품목은 {summary.get('needCount', 0)}개이며, "
        f"총 권장 수량은 {summary.get('totalInQty', 0)}개입니다."
    )
    if by_reason:
        reason_str = ", ".join([f"{k}:{v}개" for k, v in by_reason.items()])
        parts.append(f"추천 근거 분포는 {reason_str} 입니다.")
    if top:
        parts.append(
            "우선순위 Top3는 "
            + " · ".join([f"{t.name} +{t.recommendIn}개" for t in top])
            + " 입니다."
        )

    per_item: Dict[int, str] = {}
    for r in top:  # 너무 길어지니 fallback은 top3만 1줄 제공
        if r.reason == "product_sales":
            per_item[r.productId] = f"최근 판매량 기반으로 {r.coverDays or '-'}일 커버 목표로 보충(+{r.recommendIn})"
        elif r.reason == "category_sales":
            per_item[r.productId] = f"카테고리 평균 판매 기반으로 보수적으로 보충(+{r.recommendIn})"
        else:
            per_item[r.productId] = f"판매 데이터 부족 → 임계값 기준으로 최소 보충(+{r.recommendIn})"

    return RestockExplanation(
        overview=" ".join(parts),
        top3=[f"{t.name} +{t.recommendIn}개" for t in top],
        notes=[
            "이 설명은 LLM 없이 규칙 기반으로 생성되었습니다.",
            "실제 발주/입고 리드타임, 안전재고 정책이 있으면 커버일수를 조정하세요.",
        ],
        perItem=per_item,
    )


class _LLMOut(BaseModel):
    overview: str = Field(..., description="전체 설명 1~2문단, 너무 길지 않게")
    top3: List[str] = Field(default_factory=list, description="Top3 한 줄 목록")
    notes: List[str] = Field(default_factory=list, description="주의사항/운영 팁")
    perItem: Dict[int, str] = Field(default_factory=dict, description="productId -> 1줄 설명")


def explain_with_llm(
    recs: List[RestockRecommendation],
    summary: Dict[str, Any],
) -> RestockExplanation:
    # 키 없으면 fallback (서버 안전)
    if not has_openai_key():
        return _fallback_explain(recs, summary)

    parser = PydanticOutputParser(pydantic_object=_LLMOut)

    # LLM에 줄 데이터(너무 크면 토큰 폭발하니 요약해서)
    need = [r for r in recs if r.recommendIn > 0]
    top = sorted(need, key=lambda x: x.recommendIn, reverse=True)[:10]

    compact_items = [
        {
            "productId": r.productId,
            "name": r.name,
            "category": r.category,
            "currentQty": r.currentQty,
            "targetQty": r.targetQty,
            "recommendIn": r.recommendIn,
            "avgDaily": r.avgDaily,
            "reason": r.reason,
            "coverDays": r.coverDays,
        }
        for r in top
    ]

    prompt = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                "너는 재고 운영을 돕는 분석가야. 숫자를 왜 그렇게 추천했는지 납득 가능하게 설명해. "
                "단, 실제 재고를 변경하지 않는 '추천-only' 화면에 쓰일 문장이라 과장하지 말고, 불확실하면 불확실하다고 말해."
            ),
            (
                "human",
                "다음 재입고 추천 결과를 사용자에게 설명해줘.\n"
                "- overview: 전체 요약 1~2문단\n"
                "- top3: Top3 품목을 '이름 +권장수량' 형식 문자열 배열\n"
                "- notes: 운영자가 참고할 주의사항 2~4개\n"
                "- perItem: productId별로 1줄 설명(Top10만)\n\n"
                "summary:\n{summary}\n\n"
                "top10_items:\n{items}\n\n"
                "{format_instructions}"
            ),
        ]
    )

    llm = ChatOpenAI(model=get_openai_model_name(), temperature=0.2)

    chain = prompt | llm | parser
    out: _LLMOut = chain.invoke(
        {
            "summary": summary,
            "items": compact_items,
            "format_instructions": parser.get_format_instructions(),
        }
    )

    return RestockExplanation(
        overview=out.overview,
        top3=out.top3,
        notes=out.notes,
        perItem=out.perItem,
    )