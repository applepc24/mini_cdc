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


def apply_stock_adjusted(db, owner_id: int, payload: dict, outbox_id: int):
    sql = text("""
        UPDATE product_search
        SET
            qty = :after_qty,
            last_outbox_id = :outbox_id,
            updated_at = NOW()
        WHERE product_id = :product_id
          AND owner_id = :owner_id
    """)
    db.execute(sql, {
        "product_id": payload["productId"],
        "owner_id": owner_id,
        "after_qty": payload["afterQty"],
        "outbox_id": outbox_id,
    })


def soft_delete_product_search(db, owner_id: int, payload: dict, outbox_id: int):
    sql = text("""
        UPDATE product_search
        SET
            is_deleted = TRUE,
            deleted_at = COALESCE(:deleted_at, NOW()),
            last_outbox_id = :outbox_id,
            updated_at = NOW()
        WHERE product_id = :product_id
          AND owner_id = :owner_id
    """)
    db.execute(sql, {
        "product_id": payload["productId"],
        "owner_id": owner_id,
        "deleted_at": payload.get("deletedAt"),
        "outbox_id": outbox_id,
    })


def upsert_product_search(db, owner_id: int, payload: dict, outbox_id: int):
    # ⚠️ 멀티-테넌시(owner_id) 안전하게: 같은 product_id라도 owner_id가 다르면 업데이트 금지
    # (네 스키마가 product_id 단독 UNIQUE라면 이 WHERE 절이 꼭 필요함)
    sql = text("""
        INSERT INTO product_search
            (product_id, owner_id, name, category, price, qty, is_deleted, deleted_at, last_outbox_id, updated_at)
        VALUES
            (:product_id, :owner_id, :name, :category, :price, :qty, FALSE, NULL, :outbox_id, NOW())
        ON CONFLICT (product_id) DO UPDATE
        SET
            owner_id = EXCLUDED.owner_id,
            name = EXCLUDED.name,
            category = EXCLUDED.category,
            price = EXCLUDED.price,
            qty = EXCLUDED.qty,
            is_deleted = FALSE,
            deleted_at = NULL,
            last_outbox_id = EXCLUDED.last_outbox_id,
            updated_at = NOW()
        WHERE product_search.owner_id = EXCLUDED.owner_id
    """)
    db.execute(sql, {
        "product_id": payload["productId"],
        "owner_id": owner_id,
        "name": payload["name"],
        "category": payload["category"],
        "price": payload["price"],
        "qty": payload["qty"],
        "outbox_id": outbox_id,
    })


def record_apply_log(db, owner_id: int, product_id: int, event_type: str, outbox_id: int):
    # outbox_id가 PK라서 중복 insert는 무시(멱등)
    sql = text("""
        INSERT INTO readmodel_apply_log (outbox_id, owner_id, product_id, event_type, applied_at)
        VALUES (:outbox_id, :owner_id, :product_id, :event_type, NOW())
        ON CONFLICT (outbox_id) DO NOTHING
    """)
    db.execute(sql, {
        "outbox_id": outbox_id,
        "owner_id": owner_id,
        "product_id": product_id,
        "event_type": event_type,
    })


def already_processed(db, outbox_id: int) -> bool:
    sql = text("SELECT 1 FROM readmodel_apply_log WHERE outbox_id = :outbox_id")
    return db.execute(sql, {"outbox_id": outbox_id}).first() is not None


def should_skip_as_duplicate(db, owner_id: int, product_id: int, outbox_id: int) -> bool:
    # product_search에 이미 더 “새로운(outbox_id가 큰)” 이벤트가 반영되어 있으면 스킵
    sql = text("""
        SELECT COALESCE(last_outbox_id, 0)
        FROM product_search
        WHERE owner_id = :owner_id AND product_id = :product_id
    """)
    last = db.execute(sql, {"owner_id": owner_id, "product_id": product_id}).scalar()
    last = int(last or 0)
    return last >= outbox_id


def main():
    engine = create_engine(DATABASE_URL, pool_pre_ping=True, echo=False)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    consumer = KafkaConsumer(
        KAFKA_TOPIC,
        bootstrap_servers=KAFKA_BOOTSTRAP,
        api_version=(3, 6, 0),
        request_timeout_ms=20000,
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
        owner_id = int(value["ownerId"])
        event_type = (value.get("eventType") or "UNKNOWN")
        outbox_id = int(value["outboxId"])
        product_id = int(payload["productId"])

        db = SessionLocal()
        try:
            # 1) outbox_id 기준 멱등 (가장 강한 기준)
            if already_processed(db, outbox_id):
                record_apply_log(db, owner_id, product_id, event_type, outbox_id)
                db.commit()
                consumer.commit()
                continue

            # 2) (선택) read model이 더 최신이면 스킵 (역전/중복 방어)
            if should_skip_as_duplicate(db, owner_id, product_id, outbox_id):
                record_apply_log(db, owner_id, product_id, event_type, outbox_id)
                db.commit()
                consumer.commit()
                continue

            # 3) 이벤트 적용
            if event_type == "PRODUCT_DELETED":
                soft_delete_product_search(db, owner_id, payload, outbox_id)
            elif event_type == "STOCK_ADJUSTED":
                apply_stock_adjusted(db, owner_id, payload, outbox_id)
            else:
                upsert_product_search(db, owner_id, payload, outbox_id)

            # 4) 적용 성공 후 apply log 기록
            record_apply_log(db, owner_id, product_id, event_type, outbox_id)

            # 5) 한 트랜잭션 커밋 + offset 커밋
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