#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:8000}"
EMAIL="${EMAIL:-throughput@example.com}"
PASSWORD="${PASSWORD:-test1234!}"
N="${N:-5000}"
POLL_SEC="${POLL_SEC:-0.2}"

curl -s -X POST "${API_BASE}/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"name\":\"throughput\"}" >/dev/null || true

TOKEN="$(curl -s -X POST "${API_BASE}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" \
  | python -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")"

echo "[OK] got TOKEN (len=${#TOKEN})"

CREATE_RES="$(curl -s -X POST "${API_BASE}/products" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{"name":"throughput-product","category":"cat","price":1000,"qty":0}')"

PRODUCT_ID="$(python - <<PY
import json
d=json.loads('''$CREATE_RES''')
print(d['id'])
PY
)"

echo "[OK] created product_id=${PRODUCT_ID}"

ME="$(curl -s "${API_BASE}/auth/me" -H "Authorization: Bearer ${TOKEN}")"
OWNER_ID="$(python - <<PY
import json
d=json.loads('''$ME''')
print(d['id'])
PY
)"
echo "[OK] owner_id=${OWNER_ID}"

START_OUTBOX_ID="$(docker compose exec -T db psql -U postgres -d mini_cdc -tAc "SELECT COALESCE(MAX(id),0) FROM outbox_events;")"
echo "[OK] start_outbox_id=${START_OUTBOX_ID}"

echo "[LOAD] sending ${N} stock-adjust requests (consumer ON)..."
t0=$(python - <<'PY'
import time
print(int(time.time()*1000))
PY
)

for i in $(seq 1 "$N"); do
  curl -s -X POST "${API_BASE}/products/${PRODUCT_ID}/stock-adjust" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d "{\"type\":\"in\",\"quantity\":1,\"note\":\"throughput-${i}\"}" >/dev/null

  if (( i % 500 == 0 )); then
    echo "  sent ${i}/${N}"
  fi
done

t1=$(python - <<'PY'
import time
print(int(time.time()*1000))
PY
)
send_ms=$((t1-t0))
echo "[DONE] load sent. send_elapsed=${send_ms}ms"

echo "[WAIT] waiting until outbox backlog converges to 0..."

while true; do
  not_sent="$(docker compose exec -T db psql -U postgres -d mini_cdc -tAc \
    "SELECT COUNT(*) FROM outbox_events WHERE id > ${START_OUTBOX_ID} AND status <> 'SENT';" | tr -d '[:space:]')"

  new_cnt="$(docker compose exec -T db psql -U postgres -d mini_cdc -tAc \
    "SELECT COUNT(*) FROM outbox_events WHERE id > ${START_OUTBOX_ID} AND status='NEW';" | tr -d '[:space:]')"

  if [[ "${not_sent}" == "0" ]]; then
    break
  fi
  echo "  not_sent=${not_sent} (NEW=${new_cnt})"
  sleep "${POLL_SEC}"
done

t2=$(python - <<'PY'
import time
print(int(time.time()*1000))
PY
)

total_ms=$((t2-t0))
process_ms=$((t2-t1))

evps="$(python - <<PY
N=${N}
ms=${total_ms}
print(round(N / (ms/1000.0), 2))
PY
)"

echo ""
echo "================ RESULT ================"
echo "N=${N}"
echo "send_elapsed_ms=${send_ms}"
echo "converge_elapsed_ms=${total_ms}  (from first request -> backlog 0)"
echo "post_send_converge_ms=${process_ms} (after load sent -> backlog 0)"
echo "throughput_ev_per_sec=${evps}"
echo "========================================"
echo ""
echo "[INFO] product_id=${PRODUCT_ID} owner_id=${OWNER_ID} email=${EMAIL}"
