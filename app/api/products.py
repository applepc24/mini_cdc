import csv
import io
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.crud import (
    adjust_stock_with_outbox,
    create_product_with_outbox,
    soft_delete_product_with_outbox,
    update_product_with_outbox,
)
from app.db import get_db
from app.models import Product, User
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
    inserted: int
    skipped: int
    errors: list[ImportRowError] = []


@router.post("", response_model=ProductOut)
def create_product(
    payload: ProductCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    product, stock = create_product_with_outbox(db, current_user.id, payload)
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
        raise HTTPException(
            status_code=400, detail=f"CSV 헤더 누락: {', '.join(missing)}"
        )

    inserted = 0
    skipped = 0
    errors: list[ImportRowError] = []

    # ✅ (성능) 기존 상품 name을 한 번에 읽어서 Set으로 캐시
    # - owner_id 기준으로 name만 가져오기
    existing_names = set(
        db.execute(
            select(Product.name).where(
                Product.owner_id == current_user.id,
                Product.is_deleted.is_(False),
            )
        )
        .scalars()
        .all()
    )

    for idx, row in enumerate(reader, start=2):  # header가 1행
        try:
            name = (row.get("name") or "").strip()
            category = (row.get("category") or "").strip()

            if not name:
                raise ValueError("name이 비어있음")
            if not category:
                raise ValueError("category가 비어있음")

            # ✅ 중복 스킵 정책
            if name in existing_names:
                skipped += 1
                continue

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

            payload = ProductCreate(name=name, category=category, price=price, qty=qty)

            # ✅ outbox 생성 재사용
            product, stock = create_product_with_outbox(db, current_user.id, payload)

            inserted += 1
            existing_names.add(name)  # ✅ 같은 CSV 내 중복도 스킵되게

        except Exception as e:
            errors.append(ImportRowError(row=idx, reason=str(e)))

    return ImportResponse(
        inserted=inserted,
        skipped=skipped,
        errors=errors[:50],
    )
