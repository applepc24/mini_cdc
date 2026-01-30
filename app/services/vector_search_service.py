from sqlalchemy import text, bindparam, Integer, String
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
        return []

    emb_str = _to_pgvector_str(emb)
    like_q = f"%{q}%"

    vec_k = min(top_k * 3, 200)
    kw_k = min(top_k * 3, 200)

    sql = (
        text("""
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
        .bindparams(
            bindparam("owner_id", type_=Integer()),
            bindparam("category", type_=String()),
            bindparam("min_price", type_=Integer()),
            bindparam("max_price", type_=Integer()),
            bindparam("min_qty", type_=Integer()),
            bindparam("max_qty", type_=Integer()),
            bindparam("top_k", type_=Integer()),
            bindparam("vec_k", type_=Integer()),
            bindparam("kw_k", type_=Integer()),
            bindparam("like_q", type_=String()),
            bindparam("emb", type_=String()),
        )
    )

    rows = db.execute(
        sql,
        {
            "emb": emb_str,
            "like_q": like_q,
            "top_k": top_k,
            "vec_k": vec_k,
            "kw_k": kw_k,
            "owner_id": owner_id,
            "category": category,   # None이어도 이제 타입 힌트가 있어서 안 터짐
            "min_price": minPrice,
            "max_price": maxPrice,
            "min_qty": minQty,
            "max_qty": maxQty,
        },
    ).mappings().all()

    return [dict(r) for r in rows]