import os

# app/db.py 는 import 시점에 create_engine(DATABASE_URL) 을 실행한다.
# DATABASE_URL 이 비어 있으면 테스트 수집 단계에서 다음과 같이 죽는다:
#   sqlalchemy.exc.ArgumentError: Expected string or URL object, got None
#
# 로컬에서는 .env 를 load_dotenv() 가 채워줘서 가려져 있었지만,
# .env 는 커밋되지 않으므로 CI에는 존재하지 않는다.
#
# create_engine 은 지연 연결(lazy)이라 이 값으로 실제 접속이 일어나지 않는다.
# 테스트를 실제 DB에서 격리하는 효과도 있다.
os.environ.setdefault(
    "DATABASE_URL", "postgresql+psycopg://test:test@localhost:5432/test"
)
