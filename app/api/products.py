import csv
import hashlib
import io
from typing import Literal, Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Response,
    UploadFile,
)
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.crud import (
    adjust_stock_with_outbox,
    create_product_with_outbox,
    soft_delete_product_with_outbox,
    update_product_with_outbox,
)
from app.db import get_db
from app.db import SessionLocal
from app.models import (
    CsvUpload,
    CsvUploadItem,
    InventoryEvent,
    Product,
    Stock,
    User,
)
from app.schemas import ProductCreate, ProductOut, ProductUpdate
from app.services.slack_service import send_csv_import_summary_to_slack

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

    # 프론트 호환(기존 모달)
    inserted: int
    skipped: int

    # 추적용
    upload_id: int

    # ✅ mutable default 방지
    errors: list[ImportRowError] = Field(default_factory=list)


def normalize_reason(msg: str) -> str:
    m = msg.lower()

    if "헤더 누락" in m or "csv 헤더" in m:
        return "CSV_HEADER_MISSING"
    if "name이 비어" in m or "name" in m and "비어" in m:
        return "NAME_EMPTY"
    if "category가 비어" in m:
        return "CATEGORY_EMPTY"
    if "name 중복" in m:
        return "DUPLICATE_NAME_IN_CSV"
    if "price가 정수" in m:
        return "PRICE_NOT_INT"
    if "qty가 정수" in m:
        return "QTY_NOT_INT"
    if "price는 0 이상" in m:
        return "PRICE_NEGATIVE"
    if "qty는 0 이상" in m:
        return "QTY_NEGATIVE"
    if "음수" in m:
        return "NEGATIVE_STOCK"
    return "UNKNOWN"

def send_csv_import_summary_to_slack_task(**kwargs):
    db = SessionLocal()
    try:
        return send_csv_import_summary_to_slack(db=db, **kwargs)
    finally:
        db.close()


@router.get("/import/template")
def download_import_template():
    """
    CSV Import 템플릿 다운로드
    """
    csv_text = (
        "name,category,price,qty\n아메리카노,커피,4500,10\n카페라떼,커피,5000,5\n"
    )

    return Response(
        content=csv_text,
        media_type="text/csv; charset=utf-8",
        headers={
            # 브라우저에서 파일 다운로드로 뜨게
            "Content-Disposition": 'attachment; filename="products_template.csv"',
            # 한글 파일명 더 안전하게 하고 싶으면 RFC5987도 추가 가능(일단은 이걸로 충분)
        },
    )


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
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    filename = (file.filename or "").lower()
    if not filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="CSV 파일만 업로드할 수 있습니다.")

    raw_bytes = file.file.read()
    file_sha256 = hashlib.sha256(raw_bytes).hexdigest()

    # 1) 디코딩
    try:
        text = raw_bytes.decode("utf-8-sig")  # BOM 대응
    except UnicodeDecodeError:
        try:
            text = raw_bytes.decode("cp949")
        except UnicodeDecodeError:
            raise HTTPException(
                status_code=400,
                detail="파일 인코딩을 읽을 수 없습니다. utf-8로 저장해 주세요.",
            )

    # 2) CSV 파싱 + 헤더 검증
    f = io.StringIO(text)
    reader = csv.DictReader(f)

    required = {"name", "category", "price", "qty"}
    headers = set([h.strip() for h in (reader.fieldnames or []) if h])
    missing = sorted(list(required - headers))
    if missing:
        raise HTTPException(
            status_code=400, detail=f"CSV 헤더 누락: {', '.join(missing)}"
        )

    # 3) 현재 DB 스냅샷 로딩(name unique 전제)
    rows = db.execute(
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
    ).all()

    existing_by_name: dict[str, dict] = {
        r.name: {"id": r.id, "category": r.category, "price": r.price, "qty": r.qty}
        for r in rows
    }

    # 4) csv_uploads 생성(업로드 로그)
    upload = CsvUpload(
        owner_id=current_user.id,
        file_name=file.filename or "upload.csv",
        file_sha256=file_sha256,
        status="PROCESSING",  # ✅ 시작 상태 명확히
        total_rows=0,
        valid_rows=0,
        invalid_rows=0,
        requested_by=current_user.id,
    )
    db.add(upload)
    db.flush()  # upload.id 확보

    created = 0
    updated = 0
    unchanged = 0
    failed = 0
    errors: list[ImportRowError] = []

    seen_in_csv: set[str] = set()
    total_rows = 0
    valid_rows = 0
    invalid_rows = 0
    zero_count = 0

    # 5) row 단위 처리(Savepoint)
    for idx, row in enumerate(reader, start=2):
        total_rows += 1
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

                existing = existing_by_name.get(name)

                if existing is None:
                    payload = ProductCreate(
                        name=name, category=category, price=price, qty=qty
                    )
                    product, stock = create_product_with_outbox(
                        db, current_user.id, payload
                    )

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
                    before_qty = None
                    after_qty = qty
                    delta_qty = qty
                    product_id = product.id

                    existing_by_name[name] = {
                        "id": product_id,
                        "category": category,
                        "price": price,
                        "qty": qty,
                    }

                else:
                    product_id = existing["id"]
                    prev_qty = int(existing["qty"])
                    changed = False

                    if category != existing["category"] or price != existing["price"]:
                        update_product_with_outbox(
                            db,
                            current_user.id,
                            product_id,
                            ProductUpdate(category=category, price=price),
                        )
                        changed = True

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

                    before_qty = prev_qty
                    after_qty = qty
                    delta_qty = diff

                    if changed:
                        updated += 1
                    else:
                        unchanged += 1

                    existing["category"] = category
                    existing["price"] = price
                    existing["qty"] = qty

                # ✅ 성공 row만 기록(A 정책)
                db.add(
                    CsvUploadItem(
                        upload_id=upload.id,
                        owner_id=current_user.id,
                        product_id=product_id,
                        before_qty=before_qty,
                        after_qty=after_qty,
                        delta_qty=delta_qty,
                        issue_code="OK",
                        issue_msg=None,
                    )
                )

            valid_rows += 1

            if after_qty == 0:
                zero_count += 1

        except Exception as e:
            failed += 1
            invalid_rows += 1
            raw = str(e)
            code = normalize_reason(raw)
            errors.append(ImportRowError(row=idx, reason=code))

    # 6) 업로드 집계 + 상태 마감
    upload.total_rows = total_rows
    upload.valid_rows = valid_rows
    upload.invalid_rows = invalid_rows
    upload.status = "APPLIED"
    upload.approved_by = current_user.id

    db.commit()

    inserted = created + updated
    skipped = unchanged

    background_tasks.add_task(
        send_csv_import_summary_to_slack_task,
        owner_id=current_user.id,
        upload_id=upload.id,
        file_name=upload.file_name,
        inserted=inserted,
        skipped=skipped,
        failed=failed,
        created=created,
        updated=updated,
        unchanged=unchanged,
        zero_count=zero_count,
        # (선택) 에러는 Top3만
        errors=[{"row": e.row, "reason": e.reason} for e in errors[:3]],
        # (선택) 누가 업로드했는지 표시
        actor=current_user.email,
    )

    return ImportResponse(
        ok=True,
        created=created,
        updated=updated,
        unchanged=unchanged,
        failed=failed,
        inserted=inserted,
        skipped=skipped,
        upload_id=upload.id,
        errors=errors[:50],
    )
