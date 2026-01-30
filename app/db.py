from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from app.config import DATABASE_URL

# 1) DB 엔진(연결 통로)
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,  # 연결 죽었으면 자동 감지
    echo=False,          # True면 SQL 로그 찍힘 (디버깅용)
)

# 2) 세션 팩토리(요청마다 세션을 만들기 위해)
SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
)

# 3) ORM 모델들이 상속할 Base 클래스
class Base(DeclarativeBase):
    pass

# 4) FastAPI에서 쓰는 DB dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()