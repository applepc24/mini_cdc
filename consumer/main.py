import json
import os
import time

from dotenv import load_dotenv
from kafka import KafkaConsumer
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.config import DATABASE_URL

load_dotenv()

KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
KAFKA_TOPIC = os.getenv("KAFKA_TOPIC", "product-events")
CONSUMER_GROUP = os.getenv("CONSUMER_GROUP", "mini-cdc-consumer")

print(f"[Consumer] bootstrap={KAFKA_BOOTSTRAP}, topic={KAFKA_TOPIC}, group={CONSUMER_GROUP}")

def apply_stock_adjusted(db, owner_id: int, payload: dict):
    sql = text("""
        UPDATE product_search
        SET
            qty = :after_qty,
            updated_at = NOW()
        WHERE product_id = :product_id
          AND owner_id = :owner_id
    """)
    db.execute(sql, {
        "product_id": payload["productId"],
        "owner_id": owner_id,
        "after_qty": payload["afterQty"],
    })


def soft_delete_product_search(db, owner_id: int, payload: dict):
    sql = text("""
        UPDATE product_search
        SET
            is_deleted = TRUE,
            deleted_at = COALESCE(:deleted_at, NOW()),
            updated_at = NOW()
        WHERE product_id = :product_id
          AND owner_id = :owner_id
    """)
    db.execute(
        sql,
        {
            "product_id": payload["productId"],
            "owner_id": owner_id,
            "deleted_at": payload.get("deletedAt"),
        },
    )


def upsert_product_search(db, owner_id: int, payload: dict):
    sql = text("""
        INSERT INTO product_search (product_id, owner_id, name, category, price, qty, is_deleted, deleted_at, updated_at)
        VALUES (:product_id, :owner_id, :name, :category, :price, :qty, FALSE, NULL, NOW())
        ON CONFLICT (product_id) DO UPDATE
        SET
            name = EXCLUDED.name,
            category = EXCLUDED.category,
            price = EXCLUDED.price,
            qty = EXCLUDED.qty,
            is_deleted = FALSE,
            deleted_at = NULL,
            updated_at = NOW()
    """)
    db.execute(
        sql,
        {
            "product_id": payload["productId"],
            "owner_id": owner_id,
            "name": payload["name"],
            "category": payload["category"],
            "price": payload["price"],
            "qty": payload["qty"],
        },
    )


def main():
    engine = create_engine(DATABASE_URL, pool_pre_ping=True, echo=False)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    consumer = KafkaConsumer(
        KAFKA_TOPIC,
        bootstrap_servers=KAFKA_BOOTSTRAP,
        group_id=CONSUMER_GROUP,
        auto_offset_reset="earliest",
        enable_auto_commit=False,
        value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        key_deserializer=lambda k: k.decode("utf-8") if k else None,
    )

    print("[Consumer] started. waiting messages...")

    for msg in consumer:
        value = msg.value
        payload = value["payload"]
        owner_id = value["ownerId"]
        event_type = value.get("eventType")

        db = SessionLocal()
        try:
            if event_type == "PRODUCT_DELETED":
                soft_delete_product_search(db, owner_id, payload)

            elif event_type == "STOCK_ADJUSTED":
                apply_stock_adjusted(db, owner_id, payload)
            else:
                upsert_product_search(db, owner_id, payload)

            db.commit()
            consumer.commit()

        except Exception as e:
            db.rollback()
            print(f"[Consumer] ERROR: {e}")
            time.sleep(1.0)
        finally:
            db.close()


if __name__ == "__main__":
    main()