from fastapi import  FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.products import router as products_router
from app.api.search import router as search_router
from app.api.public import router as public_router

app = FastAPI(title="Mini CDC Writer")

app.include_router(auth_router)
app.include_router(products_router)
app.include_router(search_router)
app.include_router(public_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # 프론트 주소
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"ok": True}

