import json
import os
import time
from datetime import datetime

from dotenv import load_dotenv
from kafka import KafkaProducer
from kafka.errors import NoBrokersAvailable
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.config import DATABASE_URL
from app.models import OutboxEvent

load_dotenv()

# Kafka 설정
KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
KAFKA_DLQ_TOPIC = os.getenv("KAFKA_DLQ_TOPIC", "product-events-dlq")

# DLQ Publisher 설정
BATCH_SIZE = int(os.getenv("DLQ_BATCH_SIZE", "20"))
POLL_INTERVAL_SEC = float(os.getenv("DLQ_POLL_INTERVAL_SEC", "2.0"))

def make_producer() -> KafkaProducer:
    return KafkaProducer(
        bootstrap_servers=KAFKA_BOOTSTRAP,
        value_serializer=lambda v: json.dumps(v, ensure_ascii=False).encode("utf-8"),
        key_serializer=lambda k: str(k).encode("utf-8"),
        acks="all",
        retries=3,
        linger_ms=10,
        request_timeout_ms=10000,
        max_block_ms=10000,
    )

def main():
    print(f"[DLQ] starting... bootstrap={KAFKA_BOOTSTRAP}, topic={KAFKA_DLQ_TOPIC}")

    # DB 세팅
    engine = create_engine(DATABASE_URL, pool_pre_ping=True, echo=False)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    producer = None

    while True:
        # ✅ Kafka가 꺼져있으면 producer 생성 자체가 실패할 수 있음
        if producer is None:
            try:
                producer = make_producer()
                print("[DLQ] producer ready")
            except NoBrokersAvailable:
                print("[DLQ] WARN: Kafka not available. retry in 2s...")
                time.sleep(2.0)
                continue

        db = SessionLocal()
        try:
            # ✅ FAILED 이벤트를 가져와서 DLQ로 보냄
            stmt = (
                select(OutboxEvent)
                .where(OutboxEvent.status == "FAILED")
                .order_by(OutboxEvent.id.asc())
                .limit(BATCH_SIZE)
                .with_for_update(skip_locked=True)
            )

            events = db.execute(stmt).scalars().all()

            if not events:
                time.sleep(POLL_INTERVAL_SEC)
                continue

            success = 0
            failed = 0

            for ev in events:
                try:
                    fut = producer.send(
                        KAFKA_DLQ_TOPIC,
                        key=ev.aggregate_id,
                        value={
                            "outboxId": ev.id,
                            "eventType": ev.event_type,
                            "aggregateType": ev.aggregate_type,
                            "aggregateId": ev.aggregate_id,
                            "payload": ev.payload_json,
                            "retryCount": ev.retry_count,
                            "lastError": ev.last_error,
                            "failedAt": datetime.now().isoformat(),
                        },
                    )
                    fut.get(timeout=10)

                    # ✅ DLQ 전송 성공하면 상태 변경
                    ev.status = "DLQ_SENT"
                    success += 1
                    print(f"[DLQ] sent outboxId={ev.id} -> DLQ_SENT")

                except Exception as e:
                    failed += 1
                    # DLQ까지 실패하면 FAILED 유지 (다음 루프에 다시 시도)
                    ev.last_error = f"{ev.last_error} | DLQ_PUB_ERR={str(e)}"
                    print(f"[DLQ] WARN: failed outboxId={ev.id} err={e}")

            db.commit()
            print(f"[DLQ] batch done success={success}, failed={failed}, last_id={events[-1].id}")

        except Exception as e:
            db.rollback()
            print(f"[DLQ] ERROR: {e}")
            time.sleep(1.0)

        finally:
            db.close()

if __name__ == "__main__":
    main()