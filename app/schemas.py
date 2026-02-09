from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

class ProductCreate(BaseModel):
    name: str
    category: str
    price: int
    qty: int = Field(ge=0)  # 재고는 0 이상만 허용


class ProductUpdate(BaseModel):
    # 수정은 부분 수정도 가능하게 만들자 (None 허용)
    name: str | None = None
    category: str | None = None
    price: int | None = None
    qty: int | None = Field(default=None, ge=0)


class ProductOut(BaseModel):
    id: int
    name: str
    category: str
    price: int
    qty: int

class ProductSearchOut(BaseModel):
    product_id: int
    name: str
    category: str
    price: int
    qty: int
    updated_at: datetime

class SearchListResponse(BaseModel):
    count: int
    items: List[ProductSearchOut]


class CsvUploadOut(BaseModel):
    id: int
    owner_id: int
    file_name: str
    status: str
    total_rows: int
    valid_rows: int
    invalid_rows: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True  # pydantic v2 호환 (orm_mode 대체)


class CsvUploadItemOut(BaseModel):
    id: int
    upload_id: int
    owner_id: int
    product_id: int
    before_qty: Optional[int] = None
    after_qty: Optional[int] = None
    delta_qty: Optional[int] = None
    issue_code: str
    issue_msg: Optional[str] = None
    created_at: Optional[datetime] = None
    product_name: Optional[str] = None
    product_category: Optional[str] = None

    class Config:
        from_attributes = True


class CsvUploadDetailOut(BaseModel):
    upload: CsvUploadOut
    items: List[CsvUploadItemOut]
    items_count: int