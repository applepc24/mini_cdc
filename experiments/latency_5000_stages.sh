#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:8000}"
EMAIL="${EMAIL:-latencystage@example.com}"
PASSWORD="${PASSWORD:-test1234!}"
N="${N:-5000}"

echo "[ENV] API_BASE=$API_BASE N=$N EMAIL=$EMAIL"

# 0) 유저 준비 + 로그인 토큰
curl -s -X POST "${API_BASE}/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"name\":\"latencystage\"}" >/dev/null || true

TOKEN="$(curl -s -X POST "${API_BASE}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" \
  | python -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")"

echo "[OK] got TOKEN (len=${#TOKEN})"

ME="$(curl -s "${API_BASE}/auth/me" -H "Authorization: Bearer ${TOKEN}")"
OWNER_ID="$(python - <<PY
import json
d=json.loads('''$ME''')
print(d['id'])
PY
)"
echo "[OK] owner_id=${OWNER_ID}"

# 1) product 생성
CREATE_RES="$(curl -s -X POST "${API_BASE}/products" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{"name":"latency-stage-product","category":"cat","price":1000,"qty":0}')"

PRODUCT_ID="$(python - <<PY
import json
d=json.loads('''$CREATE_RES''')
print(d['id'])
PY
)"
echo "[OK] created product_id=${PRODUCT_ID}"

# 2) 시작 outbox id
START_OUTBOX_ID="$(docker compose exec -T db psql -U postgres -d mini_cdc -tAc \
  "SELECT COALESCE(MAX(id),0) FROM outbox_events;")"
START_OUTBOX_ID="$(echo "$START_OUTBOX_ID" | tr -d '[:space:]')"
echo "[OK] start_outbox_id=${START_OUTBOX_ID}"

# 3) 부하 전송
echo "[RUN] sending ${N} requests..."
t0_ms="$(python - <<'PY'
import time
print(int(time.time()*1000))
PY
)"

for i in $(seq 1 "$N"); do
  curl -s -X POST "${API_BASE}/products/${PRODUCT_ID}/stock-adjust" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d "{\"type\":\"in\",\"quantity\":1,\"note\":\"latency-stage-${i}\"}" >/dev/null

  if (( i % 500 == 0 )); then
    echo "  sent ${i}/${N}"
  fi
done

t1_ms="$(python - <<'PY'
import time
print(int(time.time()*1000))
PY
)"
send_ms=$((t1_ms - t0_ms))
echo "[DONE] sent ${N}. send_elapsed_ms=${send_ms}"

# 4) N개가 모두 apply_log에 찍힐 때까지 대기
echo "[WAIT] waiting until apply_log rows reach N=${N} ..."
while true; do
  got="$(docker compose exec -T db psql -U postgres -d mini_cdc -tAc "
    SELECT COUNT(*)
    FROM outbox_events oe
    JOIN readmodel_apply_log al
      ON al.outbox_id = oe.id
    WHERE oe.id > ${START_OUTBOX_ID}
      AND oe.owner_id = ${OWNER_ID}
      AND oe.aggregate_id = ${PRODUCT_ID}
      AND oe.event_type = 'STOCK_ADJUSTED';
  " | tr -d '[:space:]')"

  if [[ "${got}" == "${N}" ]]; then
    break
  fi
  echo "  applied=${got}/${N}"
  sleep 0.2
done

t2_ms="$(python - <<'PY'
import time
print(int(time.time()*1000))
PY
)"
total_ms=$((t2_ms - t0_ms))
post_send_ms=$((t2_ms - t1_ms))
echo "[OK] all applied. converge_elapsed_ms=${total_ms} post_send_converge_ms=${post_send_ms}"

echo ""
echo "[STATS] stage breakdown (relay_ms / consumer_ms / e2e_ms)..."

docker compose exec -T db psql -U postgres -d mini_cdc -c "
WITH base AS (
  SELECT
    oe.id AS outbox_id,
    (EXTRACT(EPOCH FROM (oe.published_at - oe.created_at)) * 1000.0) AS relay_ms,
    (EXTRACT(EPOCH FROM (al.applied_at - oe.published_at)) * 1000.0) AS consumer_ms,
    (EXTRACT(EPOCH FROM (al.applied_at - oe.created_at)) * 1000.0) AS e2e_ms
  FROM outbox_events oe
  JOIN readmodel_apply_log al
    ON al.outbox_id = oe.id
  WHERE oe.id > ${START_OUTBOX_ID}
    AND oe.owner_id = ${OWNER_ID}
    AND oe.aggregate_id = ${PRODUCT_ID}
    AND oe.event_type = 'STOCK_ADJUSTED'
    AND oe.published_at IS NOT NULL
),
stats AS (
  SELECT
    COUNT(*)::int AS n,

    ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY relay_ms))::int AS relay_p50,
    ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY relay_ms))::int AS relay_p95,
    ROUND(percentile_cont(0.99) WITHIN GROUP (ORDER BY relay_ms))::int AS relay_p99,
    ROUND(AVG(relay_ms))::int AS relay_avg,
    ROUND(MIN(relay_ms))::int AS relay_min,
    ROUND(MAX(relay_ms))::int AS relay_max,

    ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY consumer_ms))::int AS cons_p50,
    ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY consumer_ms))::int AS cons_p95,
    ROUND(percentile_cont(0.99) WITHIN GROUP (ORDER BY consumer_ms))::int AS cons_p99,
    ROUND(AVG(consumer_ms))::int AS cons_avg,
    ROUND(MIN(consumer_ms))::int AS cons_min,
    ROUND(MAX(consumer_ms))::int AS cons_max,

    ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY e2e_ms))::int AS e2e_p50,
    ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY e2e_ms))::int AS e2e_p95,
    ROUND(percentile_cont(0.99) WITHIN GROUP (ORDER BY e2e_ms))::int AS e2e_p99,
    ROUND(AVG(e2e_ms))::int AS e2e_avg,
    ROUND(MIN(e2e_ms))::int AS e2e_min,
    ROUND(MAX(e2e_ms))::int AS e2e_max
  FROM base
)
SELECT * FROM stats;
"

echo ""
echo "================ RESULT ================"
echo "N=${N}"
echo "send_elapsed_ms=${send_ms}"
echo "converge_elapsed_ms=${total_ms}  (from first request -> all applied)"
echo "post_send_converge_ms=${post_send_ms} (after send done -> all applied)"
echo "========================================"
echo ""
echo "[INFO] owner_id=${OWNER_ID} product_id=${PRODUCT_ID} start_outbox_id=${START_OUTBOX_ID} email=${EMAIL}"
