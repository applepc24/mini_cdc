from sqlalchemy.orm import Session

from app.models import OutboxEvent, Product, Stock
from app.schemas import ProductCreate, ProductUpdate
from datetime import datetime, timezone

def create_product_with_outbox(db: Session, owner_id: int, data: ProductCreate):
    """
    1) products insert
    2) stocks insert
    3) outbox_events insert
    => 한 트랜잭션으로 commit
    """

    # (1) Product 생성
    product = Product(
        owner_id=owner_id,
        name=data.name,
        category=data.category,
        price=data.price,
    )
    db.add(product)

    # flush()를 하면 commit 전에 id가 만들어짐 (AUTO_INCREMENT 반영)
    db.flush()

    # (2) Stock 생성 (product_id는 방금 만들어진 product.id 사용)
    stock = Stock(
        product_id=product.id,
        owner_id=owner_id,
        qty=data.qty,
    )
    db.add(stock)

    # (3) Outbox 이벤트 생성
    event = OutboxEvent(
        owner_id=owner_id,
        aggregate_type="product",
        aggregate_id=product.id,
        event_type="PRODUCT_CREATED",
        payload_json={
            "productId": product.id,
            "name": product.name,
            "category": product.category,
            "price": product.price,
            "qty": stock.qty,
        },
    )
    db.add(event)

    db.flush()

    return product, stock


def update_product_with_outbox(
    db: Session, owner_id: int, product_id: int, data: ProductUpdate
):
    """
    1) products update
    2) stocks update
    3) outbox_events insert
    => 한 트랜잭션으로 commit
    """

    # (1) Product 찾기
    product = (
        db.query(Product)
        .filter(Product.id == product_id, Product.owner_id == owner_id)
        .first()
    )
    if not product:
        return None

    # (2) Stock 찾기 (없으면 만들기)
    stock = db.get(Stock, product_id)
    if not stock:
        stock = Stock(product_id=product_id, owner_id=owner_id, qty=0)
        db.add(stock)

    # (3) 들어온 값만 반영 (부분 수정)
    if data.name is not None:
        product.name = data.name
    if data.category is not None:
        product.category = data.category
    if data.price is not None:
        product.price = data.price
    if data.qty is not None:
        stock.qty = data.qty

    # (4) 수정 후 최종 상태를 Outbox 이벤트로 기록
    event = OutboxEvent(
        owner_id=owner_id,
        aggregate_type="product",
        aggregate_id=product_id,
        event_type="PRODUCT_UPDATED",
        payload_json={
            "productId": product_id,
            "name": product.name,
            "category": product.category,
            "price": product.price,
            "qty": stock.qty,
        },
    )
    db.add(event)

    db.flush()

    return product, stock




def soft_delete_product_with_outbox(db: Session, owner_id: int, product_id: int):
    # 1) Product 찾기 (내 것 + 삭제 안된 것)
    product = (
        db.query(Product)
        .filter(
            Product.id == product_id,
            Product.owner_id == owner_id,
            Product.is_deleted == False,  # noqa: E712
        )
        .first()
    )
    if not product:
        return None

    # 2) Stock 조회 (없으면 0으로 취급)
    stock = db.get(Stock, product_id)
    qty = stock.qty if stock else 0

    # 3) 소프트 삭제 처리
    product.is_deleted = True
    product.deleted_at = datetime.now(timezone.utc)

    # 4) Outbox 이벤트 기록 (삭제 알림용)
    event = OutboxEvent(
        owner_id=owner_id,
        aggregate_type="product",
        aggregate_id=product_id,
        event_type="PRODUCT_DELETED",
        payload_json={
            "productId": product_id,
            "name": product.name,
            "category": product.category,
            "price": product.price,
            "qty": qty,
            "isDeleted": True,
            "deletedAt": product.deleted_at.isoformat(),
        },
    )
    db.add(event)

    db.flush()

    return True


def adjust_stock_with_outbox(
    db: Session,
    owner_id: int,
    product_id: int,
    adj_type: str,   # "in" | "out"
    quantity: int,
    note: str | None = None,
):
    # 1) product 조회 (내 것 + 삭제 안된 것)
    product = (
        db.query(Product)
        .filter(
            Product.id == product_id,
            Product.owner_id == owner_id,
            Product.is_deleted == False,  # noqa: E712
        )
        .first()
    )
    if not product:
        return None

    # 2) stock 조회 (없으면 0으로 생성)
    stock = db.get(Stock, product_id)
    if not stock:
        stock = Stock(product_id=product_id, owner_id=owner_id, qty=0)
        db.add(stock)
        db.flush()

    before_qty = stock.qty
    delta = quantity if adj_type == "in" else -quantity
    after_qty = before_qty + delta

    if after_qty < 0:
        # caller에서 400으로 처리할 수 있게 표시
        return "NEGATIVE"

    # 3) 재고 반영
    stock.qty = after_qty

    # 4) outbox 이벤트 기록 (STOCK_ADJUSTED 유지!)
    event = OutboxEvent(
        owner_id=owner_id,
        aggregate_type="product",
        aggregate_id=product_id,
        event_type="STOCK_ADJUSTED",
        payload_json={
            "productId": product_id,
            "name": product.name,
            "category": product.category,
            "price": product.price,
            "beforeQty": before_qty,
            "afterQty": after_qty,
            "delta": delta,
            "type": adj_type,
            "quantity": quantity,
            "note": note,
        },
    )
    db.add(event)

    db.flush()

    return product, stock