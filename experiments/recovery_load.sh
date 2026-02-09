#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8000}"
EMAIL="${EMAIL:-recovery@example.com}"
PASSWORD="${PASSWORD:-test1234!}"
NAME="${NAME:-recovery}"
N="${N:-5000}"

# 1) (없으면) 회원가입
curl -s -X POST "$BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"$NAME\"}" >/dev/null || true

# 2) 로그인 -> TOKEN
TOKEN="$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  | python -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")"

echo "[OK] got TOKEN (len=${#TOKEN})"

# 3) 테스트 상품 생성
PROD_JSON="$(curl -s -X POST "$BASE_URL/products" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"recovery-test","category":"cat","price":1000,"qty":0}')"

PRODUCT_ID="$(echo "$PROD_JSON" | python -c "import sys,json; print(json.load(sys.stdin)['id'])")"
echo "[OK] created product_id=$PRODUCT_ID"

echo "[STEP] Now stop consumer before load:"
echo "  docker compose stop consumer"
echo

# 4) 5000번 stock-adjust
echo "[LOAD] sending $N stock-adjust requests..."
START_TS="$(date +%s)"

for i in $(seq 1 "$N"); do
  curl -s -X POST "$BASE_URL/products/$PRODUCT_ID/stock-adjust" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"type\":\"in\",\"quantity\":1,\"note\":\"recovery-$i\"}" >/dev/null

  if (( i % 500 == 0 )); then
    echo "  sent $i/$N"
  fi
done

END_TS="$(date +%s)"
echo "[DONE] load sent. elapsed=$((END_TS-START_TS))s"
echo "[INFO] product_id=$PRODUCT_ID email=$EMAIL"
