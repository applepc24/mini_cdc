from pydantic import BaseModel, Field
from typing import List
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