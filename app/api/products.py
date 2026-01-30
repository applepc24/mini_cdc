import csv
import io
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.crud import (
    adjust_stock_with_outbox,
    create_product_with_outbox,
    soft_delete_product_with_outbox,
    update_product_with_outbox,
)
from app.db import get_db
from app.models import Product, User, Stock, InventoryEvent
from app.schemas import ProductCreate, ProductOut, ProductUpdate

router = APIRouter(prefix="/products", tags=["products"])


class StockAdjustPayload(BaseModel):
    type: Literal["in", "out"]
    quantity: int = Field(..., ge=1)
    note: Optional[str] = None


class ImportRowError(BaseModel):
    row: int
    reason: str


class ImportResponse(BaseModel):
    ok: bool
    created: int
    updated: int
    unchanged: int
    failed: int
    errors: list[ImportRowError] = []


@router.post("", response_model=ProductOut)
def create_product(
    payload: ProductCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    product, stock = create_product_with_outbox(db, current_user.id, payload)

    db.commit()
    db.refresh(product)
    db.refresh(stock)

    return ProductOut(
        id=product.id,
        name=product.name,
        category=product.category,
        price=product.price,
        qty=stock.qty,
    )


@router.put("/{product_id}", response_model=ProductOut)
def update_product(
    product_id: int,
    payload: ProductUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = update_product_with_outbox(db, current_user.id, product_id, payload)
    if result is None:
        raise HTTPException(status_code=404, detail="product not found")

    product, stock = result

    db.commit()
    db.refresh(product)
    db.refresh(stock)

    return ProductOut(
        id=product.id,
        name=product.name,
        category=product.category,
        price=product.price,
        qty=stock.qty,
    )


@router.post("/{product_id}/stock-adjust", response_model=ProductOut)
def adjust_stock(
    product_id: int,
    payload: StockAdjustPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = adjust_stock_with_outbox(
        db,
        owner_id=current_user.id,
        product_id=product_id,
        adj_type=payload.type,
        quantity=payload.quantity,
        note=payload.note,
    )

    if result is None:
        raise HTTPException(status_code=404, detail="product not found")
    if result == "NEGATIVE":
        raise HTTPException(status_code=400, detail="Stock cannot be negative")

    product, stock = result

    db.commit()
    db.refresh(product)
    db.refresh(stock)

    return ProductOut(
        id=product.id,
        name=product.name,
        category=product.category,
        price=product.price,
        qty=stock.qty,
    )


@router.delete("/{product_id}")
def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ok = soft_delete_product_with_outbox(db, current_user.id, product_id)
    if not ok:
        raise HTTPException(status_code=404, detail="product not found")
    
    db.commit()
    return {"ok": True}


@router.post("/import", response_model=ImportResponse)
def import_products_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # 1) 가벼운 확장자 체크
    filename = (file.filename or "").lower()
    if not filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="CSV 파일만 업로드할 수 있습니다.")

    # 2) 파일 읽기 (utf-8 우선, 실패 시 cp949)
    raw_bytes = file.file.read()
    try:
        text = raw_bytes.decode("utf-8-sig")  # excel BOM 대응
    except UnicodeDecodeError:
        try:
            text = raw_bytes.decode("cp949")
        except UnicodeDecodeError:
            raise HTTPException(
                status_code=400,
                detail="파일 인코딩을 읽을 수 없습니다. utf-8로 저장해 주세요.",
            )

    # 3) CSV 파싱
    f = io.StringIO(text)
    reader = csv.DictReader(f)

    # 4) 헤더 검증
    required = {"name", "category", "price", "qty"}
    headers = set([h.strip() for h in (reader.fieldnames or []) if h])
    missing = sorted(list(required - headers))
    if missing:
        raise HTTPException(status_code=400, detail=f"CSV 헤더 누락: {', '.join(missing)}")

    created = 0
    updated = 0
    unchanged = 0
    failed = 0
    errors: list[ImportRowError] = []

    # ✅ (성능) 현재 DB 상태를 한 번에 로딩: name -> (product_id, category, price, qty)
    rows = (
        db.execute(
            select(
                Product.id.label("id"),
                Product.name.label("name"),
                Product.category.label("category"),
                Product.price.label("price"),
                func.coalesce(Stock.qty, 0).label("qty"),
            )
            .outerjoin(
                Stock,
                (Stock.product_id == Product.id) & (Stock.owner_id == Product.owner_id),
            )
            .where(
                Product.owner_id == current_user.id,
                Product.is_deleted.is_(False),
            )
        )
        .all()
    )

    existing_by_name: dict[str, dict] = {
        r.name: {"id": r.id, "category": r.category, "price": r.price, "qty": r.qty}
        for r in rows
    }

    # CSV 내 중복 방지(마지막 행 우선 같은 정책 애매해서, 그냥 에러로 처리)
    seen_in_csv: set[str] = set()

    for idx, row in enumerate(reader, start=2):  # header가 1행
        try:
            with db.begin_nested():
                name = (row.get("name") or "").strip()
                category = (row.get("category") or "").strip()

            if not name:
                raise ValueError("name이 비어있음")
            if not category:
                raise ValueError("category가 비어있음")

            if name in seen_in_csv:
                raise ValueError("CSV 내 name 중복")
            seen_in_csv.add(name)

            try:
                price = int(str(row.get("price") or "").strip())
            except Exception:
                raise ValueError("price가 정수가 아님")

            try:
                qty = int(str(row.get("qty") or "").strip())
            except Exception:
                raise ValueError("qty가 정수가 아님")

            if price < 0:
                raise ValueError("price는 0 이상이어야 함")
            if qty < 0:
                raise ValueError("qty는 0 이상이어야 함")

            # ---------------------------
            # ✅ snapshot 적용 로직
            # ---------------------------
            existing = existing_by_name.get(name)

            if existing is None:
                # 새 상품 생성(=현재 qty로 시작)
                payload = ProductCreate(name=name, category=category, price=price, qty=qty)
                product, stock = create_product_with_outbox(db, current_user.id, payload)

                # snapshot 이벤트 기록
                db.add(
                    InventoryEvent(
                        owner_id=current_user.id,
                        product_id=product.id,
                        event_type="snapshot",
                        delta_qty=0,
                        snapshot_qty=qty,
                        note="csv_snapshot",
                    )
                )

                created += 1
                existing_by_name[name] = {"id": product.id, "category": category, "price": price, "qty": qty}

            else:
                changed = False
                product_id = existing["id"]

                # (1) 상품 메타데이터 업데이트 (category/price)
                if category != existing["category"] or price != existing["price"]:
                    update_product_with_outbox(
                        db,
                        current_user.id,
                        product_id,
                        ProductUpdate(category=category, price=price),
                    )
                    changed = True

                # (2) 재고를 "절대값 qty"로 맞추기 위해 diff 계산
                prev_qty = int(existing["qty"])
                diff = qty - prev_qty
                if diff != 0:
                    adj_type = "in" if diff > 0 else "out"
                    result = adjust_stock_with_outbox(
                        db,
                        owner_id=current_user.id,
                        product_id=product_id,
                        adj_type=adj_type,
                        quantity=abs(diff),
                        note="snapshot_apply",
                    )
                    if result == "NEGATIVE":
                        raise ValueError("qty가 현재 재고보다 작아서 음수가 됨")
                    changed = True

                # (3) snapshot 이벤트는 항상 남김(스냅샷 히스토리)
                db.add(
                    InventoryEvent(
                        owner_id=current_user.id,
                        product_id=product_id,
                        event_type="snapshot",
                        delta_qty=0,
                        snapshot_qty=qty,
                        note="csv_snapshot",
                    )
                )

                if changed:
                    updated += 1
                else:
                    unchanged += 1

                # 캐시 갱신(다음 행 영향/CSV 내부 중복 방지)
                existing["category"] = category
                existing["price"] = price
                existing["qty"] = qty

        except Exception as e:
            failed += 1
            errors.append(ImportRowError(row=idx, reason=str(e)))

    # inventory_events 등 남은 변경 commit
    db.commit()

    return ImportResponse(
        ok=True,
        created=created,
        updated=updated,
        unchanged=unchanged,
        failed=failed,
        errors=errors[:50],
    )