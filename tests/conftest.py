import os

# 이 앱은 모듈을 import 하는 것만으로 외부 자격증명을 요구하는 곳이 있다.
# 테스트 수집(collection) 단계에서 app.main 을 import 하므로, 값이 없으면
# 테스트가 한 줄도 실행되기 전에 죽는다.
#
#   app/db.py:5                        engine = create_engine(DATABASE_URL, ...)
#     → sqlalchemy.exc.ArgumentError: Expected string or URL object, got None
#   app/services/embedding_service.py:5  client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
#     → openai.OpenAIError: Missing credentials.
#
# 로컬에서는 .env 를 load_dotenv() 가 채워줘 가려져 있었지만
# .env 는 커밋되지 않으므로 CI에는 존재하지 않는다.
#
# 둘 다 생성 시점에 네트워크를 쓰지 않으므로(create_engine 은 지연 연결,
# OpenAI 클라이언트는 첫 요청에서야 통신) 더미 값으로 충분하다.
# 실수로 실제 DB/API 를 건드리지 않게 격리하는 효과도 있다.
#
# setdefault 이므로 이미 설정된 환경변수는 덮어쓰지 않는다.
_TEST_ENV = {
    "DATABASE_URL": "postgresql+psycopg://test:test@localhost:5432/test",
    "OPENAI_API_KEY": "test-key-not-used",
}

for _key, _value in _TEST_ENV.items():
    os.environ.setdefault(_key, _value)
