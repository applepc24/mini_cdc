from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db import get_db
from app.models import CsvUpload, CsvUploadItem, User, Product  # ✅ Product 추가
from app.schemas import CsvUploadOut, CsvUploadItemOut, CsvUploadDetailOut

router = APIRouter(prefix="/csv-uploads", tags=["csv-uploads"])


@router.get("", response_model=list[CsvUploadOut])
def list_csv_uploads(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.execute(
            select(CsvUpload)
            .where(CsvUpload.owner_id == current_user.id)
            .order_by(CsvUpload.id.desc())
            .limit(limit)
            .offset(offset)
        )
        .scalars()
        .all()
    )

    return [
        CsvUploadOut(
            id=r.id,
            owner_id=r.owner_id,
            file_name=r.file_name,
            status=r.status,
            total_rows=r.total_rows,
            valid_rows=r.valid_rows,
            invalid_rows=r.invalid_rows,
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in rows
    ]


@router.get("/{upload_id}", response_model=CsvUploadDetailOut)
def get_csv_upload(
    upload_id: int,
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # ✅ 업로드 1건 조회(내 것만)
    upload = (
        db.execute(
            select(CsvUpload).where(
                CsvUpload.id == upload_id,
                CsvUpload.owner_id == current_user.id,
            )
        )
        .scalars()
        .first()
    )
    if not upload:
        raise HTTPException(status_code=404, detail="csv upload not found")

    # ✅ 총 아이템 수
    items_count = db.execute(
        select(func.count()).select_from(CsvUploadItem).where(
            CsvUploadItem.upload_id == upload_id,
            CsvUploadItem.owner_id == current_user.id,
        )
    ).scalar_one()

    # ✅ 아이템 리스트 + Product 조인해서 name/category 같이 받기
    rows = db.execute(
        select(
            CsvUploadItem,
            Product.name.label("product_name"),
            Product.category.label("product_category"),
        )
        .outerjoin(Product, Product.id == CsvUploadItem.product_id)
        .where(
            CsvUploadItem.upload_id == upload_id,
            CsvUploadItem.owner_id == current_user.id,
        )
        .order_by(CsvUploadItem.id.asc())
        .limit(limit)
        .offset(offset)
    ).all()

    items_out: list[CsvUploadItemOut] = []
    for item, product_name, product_category in rows:
        items_out.append(
            CsvUploadItemOut(
                id=item.id,
                upload_id=item.upload_id,
                owner_id=item.owner_id,
                product_id=item.product_id,
                before_qty=item.before_qty,
                after_qty=item.after_qty,
                delta_qty=item.delta_qty,
                issue_code=item.issue_code,
                issue_msg=item.issue_msg,
                created_at=item.created_at,
                # ✅ 조인 데이터
                product_name=product_name,
                product_category=product_category,
            )
        )

    return CsvUploadDetailOut(
        upload=CsvUploadOut(
            id=upload.id,
            owner_id=upload.owner_id,
            file_name=upload.file_name,
            status=upload.status,
            total_rows=upload.total_rows,
            valid_rows=upload.valid_rows,
            invalid_rows=upload.invalid_rows,
            created_at=upload.created_at,
            updated_at=upload.updated_at,
        ),
        items=items_out,
        items_count=items_count,
    )