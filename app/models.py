from typing import List, Optional

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    TIMESTAMP,
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import JSONB

from app.db import Base


class Product(Base):
    __tablename__ = "products"

    id = Column(BigInteger, primary_key=True, autoincrement=True)

    owner_id = Column(
        BigInteger,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(255), nullable=False)
    category = Column(String(100), nullable=False)
    price = Column(Integer, nullable=False)
    is_deleted = Column(Boolean, nullable=False, default=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(
        TIMESTAMP,
        server_default=text("CURRENT_TIMESTAMP"),
        server_onupdate=text("CURRENT_TIMESTAMP"),
        nullable=False,
    )

    # Product(1) : Stock(1)
    stock = relationship("Stock", back_populates="product", uselist=False)


class Stock(Base):
    __tablename__ = "stocks"

    product_id = Column(
        BigInteger,
        ForeignKey("products.id", ondelete="CASCADE"),
        nullable=False,
        primary_key=True,
    )

    owner_id = Column(
        BigInteger,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    qty = Column(Integer, nullable=False)

    created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(
        TIMESTAMP,
        server_default=text("CURRENT_TIMESTAMP"),
        server_onupdate=text("CURRENT_TIMESTAMP"),
        nullable=False,
    )

    product = relationship("Product", back_populates="stock")


class OutboxEvent(Base):
    __tablename__ = "outbox_events"

    id = Column(BigInteger, primary_key=True, autoincrement=True)

    owner_id = Column(
        BigInteger,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    aggregate_type = Column(String(50), nullable=False)
    aggregate_id = Column(BigInteger, nullable=False)
    event_type = Column(String(50), nullable=False)
    payload_json = Column(JSON, nullable=False)

    status = Column(String(20), nullable=False, server_default=text("'NEW'"))
    published_at = Column(TIMESTAMP, nullable=True)
    created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    retry_count = Column(Integer, nullable=False, default=0)
    last_error = Column(Text, nullable=True)

    __table_args__ = (
        # relay가 0.5초마다 도는 폴링 쿼리 전용 부분 인덱스.
        #   SELECT * FROM outbox_events WHERE status='NEW' ORDER BY id LIMIT n
        # status 인덱스가 없으면 SENT까지 포함한 전체 순차 스캔이 되어
        # 테이블이 커질수록 relay 지연이 선형으로 나빠진다.
        # NEW인 행만 담으므로 인덱스가 항상 작게 유지되고, id 정렬도 함께 해결된다.
        Index(
            "ix_outbox_events_status_new",
            "id",
            postgresql_where=text("status = 'NEW'"),
        ),
    )


class ProductSearch(Base):
    __tablename__ = "product_search"

    product_id = Column(BigInteger, primary_key=True, autoincrement=True)

    owner_id = Column(
        BigInteger,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name = Column(String(255), nullable=False)
    category = Column(String(100), nullable=False)
    price = Column(Integer, nullable=False)
    qty = Column(Integer, nullable=False)
    is_deleted = Column(Boolean, nullable=False, default=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    embedding: Mapped[Optional[List[float]]] = mapped_column(
        Vector(1536), nullable=True
    )

    updated_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))


class User(Base):
    __tablename__ = "users"

    id = Column(BigInteger, primary_key=True, autoincrement=True)

    email = Column(String(255), nullable=False, unique=True, index=True)
    password_hash = Column(String(255), nullable=False)
    name = Column(String(100), nullable=True)

    is_active = Column(Boolean, nullable=False, server_default=text("true"))

    created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(
        TIMESTAMP,
        server_default=text("CURRENT_TIMESTAMP"),
        server_onupdate=text("CURRENT_TIMESTAMP"),
        nullable=False,
    )
    slack_webhook_url = Column(Text, nullable=True)
    slack_oauth_state = Column(Text, nullable=True)


class InventoryEvent(Base):
    __tablename__ = "inventory_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    product_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )

    event_type: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # snapshot/receipt/adjust
    delta_qty: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    snapshot_qty: Mapped[int | None] = mapped_column(Integer, nullable=True)

    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[object] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            "event_type IN ('snapshot','receipt','adjust')",
            name="inventory_events_type_check",
        ),
        CheckConstraint(
            "(event_type = 'snapshot' AND snapshot_qty IS NOT NULL) OR (event_type <> 'snapshot' AND snapshot_qty IS NULL)",
            name="inventory_events_snapshot_rule",
        ),
    )

class RestockIdempotency(Base):
    __tablename__ = "restock_idempotency"

    id = Column(BigInteger, primary_key=True)
    owner_id = Column(Integer, nullable=False)
    idem_key = Column(Text, nullable=False)
    endpoint = Column(Text, nullable=False)

    request_json = Column(JSONB, nullable=False)
    response_json = Column(JSONB, nullable=True)

    status = Column(Text, nullable=False, server_default="STARTED")  # STARTED | DONE | FAILED

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("owner_id", "idem_key", "endpoint", name="ux_restock_idem"),
    )


class CsvUpload(Base):
    __tablename__ = "csv_uploads"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    file_name: Mapped[str] = mapped_column(Text, nullable=False)
    file_sha256: Mapped[Optional[str]] = mapped_column(Text)

    status: Mapped[str] = mapped_column(Text, nullable=False, default="UPLOADED")
    total_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    valid_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    invalid_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    requested_by: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("users.id"))
    approved_by: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("users.id"))
    reject_reason: Mapped[Optional[str]] = mapped_column(Text)

    created_at: Mapped[Optional[DateTime]] = mapped_column(
        TIMESTAMP(timezone=False), server_default=func.now()
    )
    updated_at: Mapped[Optional[DateTime]] = mapped_column(
        TIMESTAMP(timezone=False), server_default=func.now()
    )

    items: Mapped[List["CsvUploadItem"]] = relationship(
        "CsvUploadItem",
        back_populates="upload",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class CsvUploadItem(Base):
    __tablename__ = "csv_upload_items"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    upload_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("csv_uploads.id", ondelete="CASCADE"), nullable=False
    )

    owner_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    product_id: Mapped[int] = mapped_column(BigInteger, nullable=False)

    before_qty: Mapped[Optional[int]] = mapped_column(Integer)
    after_qty: Mapped[Optional[int]] = mapped_column(Integer)
    delta_qty: Mapped[Optional[int]] = mapped_column(Integer)

    issue_code: Mapped[str] = mapped_column(Text, nullable=False, default="OK")
    issue_msg: Mapped[Optional[str]] = mapped_column(Text)

    created_at: Mapped[Optional[DateTime]] = mapped_column(
        TIMESTAMP(timezone=False), server_default=func.now()
    )

    upload: Mapped["CsvUpload"] = relationship("CsvUpload", back_populates="items")


class SlackSettings(Base):
    __tablename__ = "slack_settings"

    id = Column(BigInteger, primary_key=True)
    owner_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)

    webhook_url = Column(Text, nullable=False)

    is_enabled = Column(Boolean, nullable=False, server_default="true")
    channel_name = Column(Text, nullable=True)

    notify_on_import = Column(Boolean, nullable=False, server_default="true")
    notify_failures = Column(Boolean, nullable=False, server_default="true")
    notify_zero_stock = Column(Boolean, nullable=False, server_default="true")
    zero_stock_threshold = Column(Integer, nullable=False, server_default="1")

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)