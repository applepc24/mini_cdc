#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:8000}"
EMAIL="${EMAIL:-latencyfast@example.com}"
PASSWORD="${PASSWORD:-test1234!}"
N="${N:-5000}"
CONCURRENCY="${CONCURRENCY:-100}"
WAIT_POLL_SEC="${WAIT_POLL_SEC:-0.2}"

echo "[ENV] API_BASE=$API_BASE N=$N CONCURRENCY=$CONCURRENCY WAIT_POLL_SEC=$WAIT_POLL_SEC EMAIL=$EMAIL"

# register (ignore if exists)
curl -s -X POST "${API_BASE}/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"name\":\"latencyfast\"}" >/dev/null || true

TOKEN="$(curl -sS -X POST "${API_BASE}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" \
  | python -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")"

echo "[OK] got TOKEN (len=${#TOKEN})"

ME="$(curl -sS "${API_BASE}/auth/me" -H "Authorization: Bearer ${TOKEN}")"
OWNER_ID="$(python - <<PY
import json
d=json.loads('''$ME''')
print(d['id'])
PY
)"
echo "[OK] owner_id=${OWNER_ID}"

CREATE_RES="$(curl -sS -X POST "${API_BASE}/products" \
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

START_OUTBOX_ID="$(docker compose exec -T db psql -U postgres -d mini_cdc -tAc \
  "SELECT COALESCE(MAX(id),0) FROM outbox_events;" | tr -d '[:space:]')"
echo "[OK] start_outbox_id=${START_OUTBOX_ID}"

echo "[RUN] sending ${N} requests with concurrency=${CONCURRENCY} ..."

t0_ms="$(python - <<'PY'
import time; print(int(time.time()*1000))
PY
)"

# ---- 핵심: HTTP 코드 분포를 남긴다 ----
codes_file="/tmp/latency_codes_${PRODUCT_ID}.txt"
: > "$codes_file"

seq 1 "$N" | xargs -n 1 -P "$CONCURRENCY" bash -lc '
i="$1"
code=$(curl -s -o /dev/null -w "%{http_code}" \
  --connect-timeout 2 --max-time 10 \
  -X POST "'"$API_BASE"'/products/'"$PRODUCT_ID"'/stock-adjust" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer '"$TOKEN"'" \
  -d "{\"type\":\"in\",\"quantity\":1,\"note\":\"latency-fast-$i\"}" || echo "000")
echo "$code"
' _ | tee -a "$codes_file" >/dev/null

t1_ms="$(python - <<'PY'
import time; print(int(time.time()*1000))
PY
)"
send_ms=$((t1_ms - t0_ms))
echo "[DONE] sent ${N}. send_elapsed_ms=${send_ms}"

echo "[CODES] http code distribution:"
sort "$codes_file" | uniq -c | sort -nr

echo "[WAIT] waiting until apply_log rows reach N=${N} ..."

while true; do
  got="$(docker compose exec -T db psql -U postgres -d mini_cdc -tAc "
    SELECT COUNT(*)
    FROM outbox_events oe
    JOIN readmodel_apply_log al ON al.outbox_id = oe.id
    WHERE oe.id > ${START_OUTBOX_ID}
      AND oe.owner_id = ${OWNER_ID}
      AND oe.aggregate_id = ${PRODUCT_ID}
      AND oe.event_type = 'STOCK_ADJUSTED';
  " | tr -d '[:space:]')"

  if [[ "${got}" == "${N}" ]]; then
    break
  fi

  outbox_now="$(docker compose exec -T db psql -U postgres -d mini_cdc -tAc "
    SELECT COUNT(*)
    FROM outbox_events oe
    WHERE oe.id > ${START_OUTBOX_ID}
      AND oe.owner_id = ${OWNER_ID}
      AND oe.aggregate_id = ${PRODUCT_ID}
      AND oe.event_type = 'STOCK_ADJUSTED';
  " | tr -d '[:space:]')"

  echo "  applied=${got}/${N} (outbox=${outbox_now}/${N})"
  sleep "${WAIT_POLL_SEC}"
done

t2_ms="$(python - <<'PY'
import time; print(int(time.time()*1000))
PY
)"
total_ms=$((t2_ms - t0_ms))
post_send_ms=$((t2_ms - t1_ms))

echo "[OK] all applied. converge_elapsed_ms=${total_ms} post_send_converge_ms=${post_send_ms}"
