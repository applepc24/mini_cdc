# app/services/dashboard_service.py
from sqlalchemy import text


def get_dashboard_stats(db, owner_id: int, threshold: int = 10, top_n: int = 5):
    total_products = db.execute(
        text("""
            SELECT COUNT(*)
            FROM product_search
            WHERE owner_id = :owner_id
              AND is_deleted = false
        """),
        {"owner_id": owner_id},
    ).scalar_one()

    low_stock_count = db.execute(
        text("""
            SELECT COUNT(*)
            FROM product_search
            WHERE owner_id = :owner_id
              AND is_deleted = false
              AND qty <= :threshold
        """),
        {"owner_id": owner_id, "threshold": threshold},
    ).scalar_one()

    total_qty = db.execute(
        text("""
            SELECT COALESCE(SUM(qty), 0)
            FROM product_search
            WHERE owner_id = :owner_id
              AND is_deleted = false
        """),
        {"owner_id": owner_id},
    ).scalar_one()

    top_categories = db.execute(
        text("""
            SELECT category, COUNT(*) AS count
            FROM product_search
            WHERE owner_id = :owner_id
              AND is_deleted = false
            GROUP BY category
            ORDER BY count DESC
            LIMIT :top_n
        """),
        {"owner_id": owner_id, "top_n": top_n},
    ).mappings().all()

    return {
        "totalProducts": total_products,
        "lowStockCount": low_stock_count,
        "totalQty": total_qty,
        "topCategories": top_categories,
    }
    # 	•	이 함수는 쿼리를 4번 날림 → 한 번에 줄일 수 있음


# •	대시보드가 자주 호출되면 캐시(Redis) 걸면 좋음
# •	low_stock_count, total_qty 같은 건 materialized view로도 가능
