import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from app.db import Base, engine  # noqa: E402
import app.models  # noqa: E402,F401  # Base.metadata에 모델을 등록하려면 import가 필요(미사용 아님)


def main():
    Base.metadata.create_all(bind=engine)
    print("✅ tables created")


if __name__ == "__main__":
    main()
