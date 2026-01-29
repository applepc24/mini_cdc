import os, sys
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from app.db import Base, engine
import app.models  # ✅ 모델 import

def main():
    Base.metadata.create_all(bind=engine)
    print("✅ tables created")

if __name__ == "__main__":
    main()