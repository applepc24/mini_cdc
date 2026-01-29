from sqlalchemy import text
from sqlalchemy.orm import Session
from typing import Optional

from app.services.embedding_service import make_query_embedding


def _to_pgvector_str(vec: list[float]) -> str:
    return "[" + ",".join(str(x) for x in vec) + "]"


def hybrid_search_products(
    db: Session,
    owner_id: int,
    q: str,
    top_k: int = 50,
    category: Optional[str] = None,
    minQty: Optional[int] = None,
    maxQty: Optional[int] = None,
    minPrice: Optional[int] = None,
    maxPrice: Optional[int] = None,
):
    emb = make_query_embedding(q)
    if not emb:
        # 임베딩 실패하면 키워드만이라도 줄 수도 있는데,
        # 여기선 단순하게 빈 리스트 처리
        return []

    emb_str = _to_pgvector_str(emb)
    like_q = f"%{q}%"

    vec_k = min(top_k * 3, 200)
    kw_k = min(top_k * 3, 200)

    sql = text("""
    WITH vec AS (
        SELECT
            product_id, name, category, price, qty, updated_at,
            (embedding <=> (:emb)::vector) AS distance,
            0 AS keyword_hit
        FROM product_search
        WHERE embedding IS NOT NULL
          AND owner_id = :owner_id
          AND (:category IS NULL OR category = :category)
          AND (:min_price IS NULL OR price >= :min_price)
          AND (:max_price IS NULL OR price <= :max_price)
          AND (:min_qty IS NULL OR qty >= :min_qty)
          AND (:max_qty IS NULL OR qty <= :max_qty)
        ORDER BY embedding <=> (:emb)::vector
        LIMIT :vec_k
    ),
    kw AS (
        SELECT
            product_id, name, category, price, qty, updated_at,
            0.0 AS distance,
            1 AS keyword_hit
        FROM product_search
        WHERE (name ILIKE :like_q OR category ILIKE :like_q)
          AND owner_id = :owner_id
          AND (:category IS NULL OR category = :category)
          AND (:min_price IS NULL OR price >= :min_price)
          AND (:max_price IS NULL OR price <= :max_price)
          AND (:min_qty IS NULL OR qty >= :min_qty)
          AND (:max_qty IS NULL OR qty <= :max_qty)
        ORDER BY updated_at DESC
        LIMIT :kw_k
    )
    SELECT DISTINCT ON (product_id)
        product_id, name, category, price, qty, updated_at
    FROM (
        SELECT * FROM kw
        UNION ALL
        SELECT * FROM vec
    ) u
    ORDER BY
        product_id,
        keyword_hit DESC,
        distance ASC,
        updated_at DESC
    LIMIT :top_k;
    """)

    rows = db.execute(
        sql,
        {
            "emb": emb_str,
            "like_q": like_q,
            "top_k": top_k,
            "vec_k": vec_k,
            "kw_k": kw_k,
            "owner_id": owner_id,
            "category": category,
            "min_price": minPrice,
            "max_price": maxPrice,
            "min_qty": minQty,
            "max_qty": maxQty,
        },
    ).mappings().all()

    return [dict(r) for r in rows]