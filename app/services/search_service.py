from sqlalchemy import text
from typing import Literal, Optional
from sqlalchemy.orm import Session


def search_products(
    db: Session,
    owner_id: int,
    q: Optional[str] = None,
    category: Optional[str] = None,
    minQty: Optional[int] = None,
    maxQty: Optional[int] = None,
    minPrice: Optional[int] = None,
    maxPrice: Optional[int] = None,
    sortBy: str = "updated_at",
    sortOrder: Literal["asc", "desc"] = "desc",
    limit: int = 50,
    offset: int = 0,
):
    conditions = ["owner_id = :owner_id", "is_deleted = false"]
    params = {"owner_id": owner_id, "limit": limit, "offset": offset}

    if q and q.strip():
        conditions.append("name ILIKE :q")
        params["q"] = f"%{q.strip()}%"

    if category:
        conditions.append("category = :category")
        params["category"] = category

    if minQty is not None:
        conditions.append("qty >= :minQty")
        params["minQty"] = minQty

    if maxQty is not None:
        conditions.append("qty <= :maxQty")
        params["maxQty"] = maxQty

    if minPrice is not None:
        conditions.append("price >= :minPrice")
        params["minPrice"] = minPrice

    if maxPrice is not None:
        conditions.append("price <= :maxPrice")
        params["maxPrice"] = maxPrice

    where_clause = "WHERE " + " AND ".join(conditions)

    allowed_sort = {
        "updated_at": "updated_at",
        "price": "price",
        "qty": "qty",
        "name": "name",
        "category": "category",
        "product_id": "product_id",
    }

    sort_col = allowed_sort.get(sortBy, "updated_at")
    sort_dir = "ASC" if sortOrder == "asc" else "DESC"
    order_clause = f"ORDER BY {sort_col} {sort_dir}"

    count_sql = text(f"""
        SELECT COUNT(*) AS total
        FROM product_search
        {where_clause}
    """)
    total = db.execute(count_sql, params).scalar_one()

    list_sql = text(f"""
        SELECT product_id, name, category, price, qty, updated_at
        FROM product_search
        {where_clause}
        {order_clause}
        LIMIT :limit OFFSET :offset
    """)
    items = db.execute(list_sql, params).mappings().all()

    return total, items


def get_product_detail(db: Session, owner_id: int, product_id: int):
    sql = text("""
        SELECT product_id, name, category, price, qty, updated_at
        FROM product_search
        WHERE owner_id = :owner_id
          AND product_id = :product_id
          AND is_deleted = false
    """)
    row = db.execute(sql, {"owner_id": owner_id, "product_id": product_id}).mappings().first()
    return row