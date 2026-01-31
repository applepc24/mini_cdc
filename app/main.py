from fastapi import  FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.products import router as products_router
from app.api.search import router as search_router
from app.api.public import router as public_router
from app.api.restock import router as ai_router

ALLOWED_ORIGINS = [
    "https://www.stockops.site",
    "https://stockops.site",
]

app = FastAPI(title="Mini CDC Writer")

app.include_router(auth_router)
app.include_router(products_router)
app.include_router(search_router)
app.include_router(public_router)
app.include_router(ai_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,   # 쿠키 인증 아니면 False로 바꿔도 됨
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"ok": True}

