FROM python:3.13-slim

WORKDIR /app

# (선택) 빌드 최적화용
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

# 시스템 패키지 (psycopg2 / 기타 빌드 필요할 때 대비)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    git \
    && rm -rf /var/lib/apt/lists/*

# requirements 먼저 복사해서 캐시 활용
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# 나머지 소스 복사
COPY . /app

# 기본은 API로 실행 (compose에서 override 가능)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
