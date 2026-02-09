from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from app.config import DATABASE_URL

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    echo=False,

    # ✅ concurrency 테스트용 풀 튜닝
    pool_size=50,       # 기본으로 유지할 커넥션 수
    max_overflow=50,    # 급증 시 추가로 빌릴 수 있는 커넥션
    pool_timeout=30,     # 커넥션 못 구하면 5초 내로 실패(30초 멈춤 방지)
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()