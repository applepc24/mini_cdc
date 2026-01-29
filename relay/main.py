import json
import os
import time
from datetime import datetime

from dotenv import load_dotenv
from kafka import KafkaProducer
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.config import DATABASE_URL
from app.models import OutboxEvent
from kafka.errors import NoBrokersAvailable

load_dotenv()

# Kafka 설정
KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
KAFKA_TOPIC = os.getenv("KAFKA_TOPIC", "product-events")

# DLQ 설정
KAFKA_DLQ_TOPIC = os.getenv("KAFKA_DLQ_TOPIC", "product-events-dlq")
MAX_RETRY = int(os.getenv("RELAY_MAX_RETRY", "5"))

# Relay 설정
BATCH_SIZE = int(os.getenv("RELAY_BATCH_SIZE", "10"))
POLL_INTERVAL_SEC = float(os.getenv("RELAY_POLL_INTERVAL_SEC", "1.0"))


def make_producer() -> KafkaProducer:
    """
    JSON payload를 Kafka로 보낼 Producer 생성
    """
    return KafkaProducer(
        bootstrap_servers=KAFKA_BOOTSTRAP,
        value_serializer=lambda v: json.dumps(v, ensure_ascii=False).encode("utf-8"),
        key_serializer=lambda k: str(k).encode("utf-8"),
        acks="all",  # 브로커가 확실히 받았을 때만 성공 처리
        retries=3,  # 일시적 실패 재시도
        linger_ms=10,  # 짧게 모아서 전송(성능)
        request_timeout_ms=10000,
        max_block_ms=10000,
    )


def push_to_dlq(producer: KafkaProducer, ev: OutboxEvent):
    """
    DLQ 토픽으로 실패 이벤트를 보낸다.
    (DLQ 전송 실패해도 outbox는 FAILED 유지)
    """
    dlq_future = producer.send(
        KAFKA_DLQ_TOPIC,
        key=ev.aggregate_id,
        value={
            "outboxId": ev.id,
            "ownerId": ev.owner_id,
            "eventType": ev.event_type,
            "aggregateId": ev.aggregate_id,
            "payload": ev.payload_json,
            "retryCount": ev.retry_count,
            "lastError": ev.last_error,
            "failedAt": datetime.now().isoformat(),
        },
    )
    # ✅ DLQ도 "진짜 들어갔는지" 확인
    dlq_future.get(timeout=10)


def main():
    print(f"[Relay] starting... bootstrap={KAFKA_BOOTSTRAP}, topic={KAFKA_TOPIC}")

    # DB 세팅
    engine = create_engine(DATABASE_URL, pool_pre_ping=True, echo=False)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    producer = None

    while True:
        if producer is None:
            try:
                producer = make_producer()
                print("[Relay] producer ready")
            except NoBrokersAvailable:
                producer = None
        db = SessionLocal()
        try:
            # ✅ NEW 이벤트를 "잠금 걸고" 가져오기
            stmt = (
                select(OutboxEvent)
                .where(OutboxEvent.status == "NEW")
                .order_by(OutboxEvent.id.asc())
                .limit(BATCH_SIZE)
                .with_for_update(skip_locked=True)
            )

            events = db.execute(stmt).scalars().all()

            if not events:
                db.close()
                time.sleep(POLL_INTERVAL_SEC)
                continue

            success = 0
            failed = 0
            futures = []

            # ✅ send 단계도 try/except로 보호해야 함
            for ev in events:
                payload = ev.payload_json
                key = ev.aggregate_id

                try:
                    if producer is None:
                        futures.append((ev, None))
                    else:
                        future = producer.send(
                            KAFKA_TOPIC,
                            key=key,
                            value={
                                "outboxId": ev.id,
                                "ownerId": ev.owner_id, 
                                "aggregateType": ev.aggregate_type,
                                "aggregateId": ev.aggregate_id,
                                "eventType": ev.event_type,
                                "payload": payload,
                                "createdAt": ev.created_at.isoformat() if ev.created_at else None,
                            },
                        )
                        futures.append((ev, future))

                    

                except Exception as e:
                    # ✅ send 단계 실패도 retry_count 누적
                    failed += 1
                    ev.retry_count += 1
                    ev.last_error = str(e)

                    if ev.retry_count >= MAX_RETRY:
                        ev.status = "FAILED"
                        print(
                            f"[Relay] SEND ERROR -> FAILED outboxId={ev.id} retry_count={ev.retry_count} err={e}"
                        )
                    else:
                        ev.status = "NEW"
                        print(
                            f"[Relay] SEND ERROR outboxId={ev.id} retry_count={ev.retry_count} err={e}"
                        )

            # ✅ ACK 확인(fut.get) 후에 SENT 처리
            for ev, fut in futures:
                try:
                    if fut is None:
                        raise NoBrokersAvailable()

                    fut.get(timeout=10)

                    ev.status = "SENT"
                    ev.published_at = datetime.now()
                    ev.last_error = None
                    success += 1
                    ev.retry_count = 0

                except Exception as e:
                    failed += 1
                    ev.retry_count += 1
                    ev.last_error = str(e)

                    if ev.retry_count >= MAX_RETRY:
                        ev.status = "FAILED"
                        try:
                            push_to_dlq(producer, ev)
                            print(
                                f"[Relay] DLQ pushed outboxId={ev.id} retry_count={ev.retry_count}"
                            )
                        except Exception as dlq_err:
                            # ✅ DLQ 실패해도 outbox는 FAILED 유지
                            ev.last_error = f"{ev.last_error} | DLQ_ERR={dlq_err}"
                            print(
                                f"[Relay] DLQ FAILED but marked FAILED outboxId={ev.id} err={dlq_err}"
                            )
                    else:
                        ev.status = "NEW"
                        print(
                            f"[Relay] WARN: send failed outboxId={ev.id} retry_count={ev.retry_count} err={e}"
                        )

            db.commit()
            print(
                f"[Relay] batch done success={success}, failed={failed}, last_id={events[-1].id}"
            )

        except Exception as e:
            db.rollback()
            print(f"[Relay] ERROR: {e}")
            time.sleep(1.0)

        finally:
            db.close()


if __name__ == "__main__":
    main()