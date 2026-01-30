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