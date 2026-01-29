from datetime import timezone

from sqlalchemy.orm import Session

from app.models import OutboxEvent


def to_iso_z(dt):
    if dt is None:
        return None
    # created_at이 tzinfo 없는 naive datetime이면 UTC로 간주
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    # UTC ISO 문자열로 보내기 (Z)
    return (
        dt.astimezone(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def list_notifications(db: Session, owner_id: int, limit: int = 20):
    rows = (
        db.query(OutboxEvent)
        .filter(OutboxEvent.owner_id == owner_id)
        .order_by(OutboxEvent.created_at.desc())
        .limit(limit)
        .all()
    )

    # 프론트가 쓰기 좋게 가공
    items = []
    for r in rows:
        items.append(
            {
                "id": r.id,
                "eventType": r.event_type,
                "payload": r.payload_json,
                "createdAt": to_iso_z(r.created_at),
            }
        )

    return items


def list_notifications_since(
    db: Session, owner_id: int, after_id: int = 0, limit: int = 20
):
    rows = (
        db.query(OutboxEvent)
        .filter(
            OutboxEvent.owner_id == owner_id,
            OutboxEvent.id > after_id,
        )
        .order_by(OutboxEvent.id.asc())
        .limit(limit)
        .all()
    )

    items = []
    for r in rows:
        items.append(
            {
                "id": r.id,
                "eventType": r.event_type,
                "payload": r.payload_json,
                "createdAt": to_iso_z(r.created_at),
            }
        )

    return items
