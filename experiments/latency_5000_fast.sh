#!/usr/bin/env bash
set -euo pipefail

# =========================
# latency_5000_fast.sh
# - 5,000건 stock-adjust 요청 전송
# - outbox_events.created_at -> readmodel_apply_log.applied_at E2E(ms)
# - (추가) relay_ms / consumer_ms stage breakdown
#
# 사용:
#   chmod +x latency_5000_fast.sh
#   ./latency_5000_fast.sh
#
# 옵션(ENV):
#   API_BASE="http://127.0.0.1:8000"
#   EMAIL="latencyfast@example.com"
#   PASSWORD="test1234!"
#   N=5000
#   CONCURRENCY=50
#   WAIT_POLL_SEC=0.2
# =========================

API_BASE="${API_BASE:-http://127.0.0.1:8000}"
EMAIL="${EMAIL:-latencyfast@example.com}"
PASSWORD="${PASSWORD:-test1234!}"
N="${N:-5000}"
CONCURRENCY="${CONCURRENCY:-50}"
WAIT_POLL_SEC="${WAIT_POLL_SEC:-0.2}"

echo "[ENV] API_BASE=$API_BASE N=$N CONCURRENCY=$CONCURRENCY WAIT_POLL_SEC=$WAIT_POLL_SEC EMAIL=$EMAIL"

# 0) 유저 준비 + 로그인 토큰
curl -s -X POST "${API_BASE}/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"name\":\"latencyfast\"}" >/dev/null || true

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

# 1) product 생성 (반드시 이 TOKEN으로 만든 product로만 테스트)
CREATE_RES="$(curl -s -X POST "${API_BASE}/products" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{"name":"latency-fast-product","category":"cat","price":1000,"qty":0}')"

PRODUCT_ID="$(python - <<PY
import json
d=json.loads('''$CREATE_RES''')
print(d['id'])
PY
)"
echo "[OK] created product_id=${PRODUCT_ID}"

# 2) 시작 outbox id (테스트 범위 기준점)
START_OUTBOX_ID="$(docker compose exec -T db psql -U postgres -d mini_cdc -tAc \
  "SELECT COALESCE(MAX(id),0) FROM outbox_events;")"
START_OUTBOX_ID="$(echo "$START_OUTBOX_ID" | tr -d '[:space:]')"
echo "[OK] start_outbox_id=${START_OUTBOX_ID}"

# 3) 부하 전송(병렬)
echo "[RUN] sending ${N} requests with concurrency=${CONCURRENCY} ..."

t0_ms="$(python - <<'PY'
import time
print(int(time.time()*1000))
PY
)"

seq 1 "$N" | xargs -I{} -P "$CONCURRENCY" \
  curl -s -X POST "${API_BASE}/products/${PRODUCT_ID}/stock-adjust" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d "{\"type\":\"in\",\"quantity\":1,\"note\":\"latency-fast-{}\"}" >/dev/null

t1_ms="$(python - <<'PY'
import time
print(int(time.time()*1000))
PY
)"
send_ms=$((t1_ms - t0_ms))
echo "[DONE] sent ${N}. send_elapsed_ms=${send_ms}"

# 4) 적용 완료 대기
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
  sleep "${WAIT_POLL_SEC}"
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

# (핵심) psql을 -tAc로 한 줄 CSV로 뽑아서 파싱 안정화
STATS_CSV="$(docker compose exec -T db psql -U postgres -d mini_cdc -tAc "
WITH base AS (
  SELECT
    oe.id AS outbox_id,
    EXTRACT(EPOCH FROM (al.applied_at - oe.created_at)) * 1000.0 AS e2e_ms,
    EXTRACT(EPOCH FROM (oe.published_at - oe.created_at)) * 1000.0 AS relay_ms,
    EXTRACT(EPOCH FROM (al.applied_at - oe.published_at)) * 1000.0 AS consumer_ms
  FROM outbox_events oe
  JOIN readmodel_apply_log al ON al.outbox_id = oe.id
  WHERE oe.id > ${START_OUTBOX_ID}
    AND oe.owner_id = ${OWNER_ID}
    AND oe.aggregate_id = ${PRODUCT_ID}
    AND oe.event_type = 'STOCK_ADJUSTED'
    AND oe.published_at IS NOT NULL
)
SELECT
  COUNT(*)::int,
  ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY relay_ms))::int,
  ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY relay_ms))::int,
  ROUND(percentile_cont(0.99) WITHIN GROUP (ORDER BY relay_ms))::int,
  ROUND(AVG(relay_ms))::int,
  ROUND(MAX(relay_ms))::int,
  ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY consumer_ms))::int,
  ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY consumer_ms))::int,
  ROUND(percentile_cont(0.99) WITHIN GROUP (ORDER BY consumer_ms))::int,
  ROUND(AVG(consumer_ms))::int,
  ROUND(MAX(consumer_ms))::int,
  ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY e2e_ms))::int,
  ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY e2e_ms))::int,
  ROUND(percentile_cont(0.99) WITHIN GROUP (ORDER BY e2e_ms))::int,
  ROUND(AVG(e2e_ms))::int,
  ROUND(MAX(e2e_ms))::int
FROM base;
")"

STATS_CSV="$(echo "$STATS_CSV" | tr -d '[:space:]')"

# 사람용 출력(선택)
echo "[STATS_CSV] $STATS_CSV"

echo ""
echo "================ RESULT ================"
echo "N=${N}"
echo "CONCURRENCY=${CONCURRENCY}"
echo "send_elapsed_ms=${send_ms}"
echo "converge_elapsed_ms=${total_ms}  (from first request -> all applied)"
echo "post_send_converge_ms=${post_send_ms} (after send done -> all applied)"
echo "========================================"
echo ""
echo "[INFO] owner_id=${OWNER_ID} product_id=${PRODUCT_ID} start_outbox_id=${START_OUTBOX_ID} email=${EMAIL}"

# 머신 파싱용 라인 (run_curve.sh가 이것만 읽음)
# 포맷:
# n,relay_p50,relay_p95,relay_p99,relay_avg,relay_max,cons_p50,cons_p95,cons_p99,cons_avg,cons_max,e2e_p50,e2e_p95,e2e_p99,e2e_avg,e2e_max
echo "__RESULT_CSV__=${STATS_CSV}"

# run_curve.sh가 함께 기록할 수 있도록 send/elapsed도 별도 제공
echo "__META__=send_elapsed_ms=${send_ms},converge_elapsed_ms=${total_ms},post_send_converge_ms=${post_send_ms}"
