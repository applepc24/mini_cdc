#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:8000}"
EMAIL="${EMAIL:-latencyfast@example.com}"
PASSWORD="${PASSWORD:-test1234!}"

# 실험 파라미터
CONC="${CONC:-100}"
WAIT_POLL_SEC="${WAIT_POLL_SEC:-0.2}"
N_LIST="${N_LIST:-1000 5000 10000}"

OUT="${OUT:-mttr_curve.csv}"

ts() { date -Iseconds; }

# --- login ---
login_json="$(curl -sS -X POST "$API_BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")"

TOKEN="$(printf "%s" "$login_json" | python -c "import sys,json; print(json.load(sys.stdin).get('accessToken',''))")"
if [[ -z "${TOKEN}" ]]; then
  echo "[ERR] login failed: $login_json" >&2
  exit 1
fi

ME="$(curl -sS "$API_BASE/auth/me" -H "Authorization: Bearer $TOKEN")"
OWNER="$(printf "%s" "$ME" | python -c "import sys,json; print(json.load(sys.stdin)['id'])")"

echo "[OK] OWNER=$OWNER TOKEN_len=${#TOKEN} CONC=$CONC"
echo "[INFO] N_LIST=$N_LIST"

# --- header ---
if [[ ! -f "$OUT" ]]; then
  echo "ts,n,concurrency,send_elapsed_ms,mttr_ms,outbox_after,published_after,applied_after,qty_before,qty_after,qty_delta" > "$OUT"
fi

# --- helper: now_ms ---
now_ms() { python - <<'PY'
import time
print(int(time.time()*1000))
PY
}

# --- helper: product qty ---
get_qty() {
  local pid="$1"
  docker compose exec -T db psql -U postgres -d mini_cdc -tAc \
    "SELECT qty FROM products WHERE id=${pid};" | tr -d '[:space:]'
}

# --- helper: outbox counts after ---
outbox_counts_after() {
  local start="$1" owner="$2" pid="$3"
  docker compose exec -T db psql -U postgres -d mini_cdc -tAc "
SELECT
  COUNT(*) AS outbox_after,
  COUNT(*) FILTER (WHERE published_at IS NOT NULL) AS published_after,
  COUNT(*) FILTER (WHERE al.outbox_id IS NOT NULL) AS applied_after
FROM outbox_events oe
LEFT JOIN readmodel_apply_log al ON al.outbox_id=oe.id
WHERE oe.id > ${start}
  AND oe.owner_id=${owner}
  AND oe.aggregate_id=${pid}
  AND oe.event_type='STOCK_ADJUSTED';
" | tr -d '[:space:]'
}

# --- helper: applied count after ---
applied_count_after() {
  local start="$1" owner="$2" pid="$3"
  docker compose exec -T db psql -U postgres -d mini_cdc -tAc "
SELECT COUNT(*)
FROM outbox_events oe
JOIN readmodel_apply_log al ON al.outbox_id=oe.id
WHERE oe.id > ${start}
  AND oe.owner_id=${owner}
  AND oe.aggregate_id=${pid}
  AND oe.event_type='STOCK_ADJUSTED';
" | tr -d '[:space:]'
}

# --- create fresh product for MTTR tests (single product for all N in this run) ---
CREATE_RES="$(curl -sS -X POST "$API_BASE/products" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"mttr-curve-product","category":"cat","price":1000,"qty":0}')"

PID="$(printf "%s" "$CREATE_RES" | python -c "import sys,json; print(json.load(sys.stdin)['id'])")"
echo "[OK] PID=$PID"

# 기준 START_ID: 전체 outbox max (가장 안전)
START_ID="$(docker compose exec -T db psql -U postgres -d mini_cdc -tAc "SELECT COALESCE(MAX(id),0) FROM outbox_events;" | tr -d '[:space:]')"
echo "[OK] START_ID=$START_ID (global max)"

# consumer stop
echo "[STEP] stopping consumer..."
docker compose stop consumer >/dev/null || true
sleep 1

for N in $N_LIST; do
  echo ""
  echo "===== MTTR RUN N=$N CONC=$CONC ====="

  qty_before="$(get_qty "$PID")"
  echo "[INFO] qty_before=$qty_before"

  # (A) backlog generate (consumer down)
  echo "[STEP] generating backlog..."
  t0="$(now_ms)"

  # NOTE: bash -lc uses parent's exported vars
  export API_BASE TOKEN PID
  seq 1 "$N" | xargs -n 1 -P "$CONC" bash -lc '
i="$1"
curl -s -o /dev/null --connect-timeout 2 --max-time 10 \
  -X POST "'"$API_BASE"'/products/'"$PID"'/stock-adjust" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer '"$TOKEN"'" \
  -d "{\"type\":\"in\",\"quantity\":1,\"note\":\"mttr-'$N'-$i\"}"
' _

  t1="$(now_ms)"
  send_ms="$((t1 - t0))"
  echo "[DONE] backlog sent. send_elapsed_ms=$send_ms"

  # (B) counts while consumer down
  counts_down="$(outbox_counts_after "$START_ID" "$OWNER" "$PID")"   # e.g. 5000|5000|0
  outbox_after="$(echo "$counts_down" | cut -d'|' -f1)"
  published_after="$(echo "$counts_down" | cut -d'|' -f2)"
  applied_after="$(echo "$counts_down" | cut -d'|' -f3)"
  echo "[DOWN] outbox=$outbox_after published=$published_after applied=$applied_after"

  # (C) start consumer + measure MTTR until applied==outbox_after (==N ideally)
  echo "[STEP] starting consumer..."
  docker compose start consumer >/dev/null

  t2="$(now_ms)"

  while true; do
    applied_now="$(applied_count_after "$START_ID" "$OWNER" "$PID")"
    if [[ "$applied_now" == "$outbox_after" ]]; then
      break
    fi
    echo "  applied=$applied_now/$outbox_after"
    sleep "$WAIT_POLL_SEC"
  done

  t3="$(now_ms)"
  mttr_ms="$((t3 - t2))"

  qty_after="$(get_qty "$PID")"
  qty_delta="$((qty_after - qty_before))"

  echo "[OK] MTTR_ms=$mttr_ms qty_after=$qty_after (delta=$qty_delta)"

  # (D) final counts after recovery
  counts_after="$(outbox_counts_after "$START_ID" "$OWNER" "$PID")"
  outbox_after2="$(echo "$counts_after" | cut -d'|' -f1)"
  published_after2="$(echo "$counts_after" | cut -d'|' -f2)"
  applied_after2="$(echo "$counts_after" | cut -d'|' -f3)"

  echo "[AFTER] outbox=$outbox_after2 published=$published_after2 applied=$applied_after2"

  # (E) sanity: expect no loss/dup (best effort)
  # outbox_after2 should equal (prev outbox_after + N) because START_ID fixed
  # qty_delta should equal N (exactly)
  echo "$(ts),$N,$CONC,$send_ms,$mttr_ms,$outbox_after2,$published_after2,$applied_after2,$qty_before,$qty_after,$qty_delta" | tee -a "$OUT"

  # move START_ID forward for next N run (so each run isolates)
  START_ID="$(docker compose exec -T db psql -U postgres -d mini_cdc -tAc "SELECT COALESCE(MAX(id),0) FROM outbox_events;" | tr -d '[:space:]')"
  echo "[NEXT] START_ID=$START_ID"
  echo "[STEP] stopping consumer for next run..."
  docker compose stop consumer >/dev/null || true
  sleep 1
done

echo ""
echo "[DONE] saved -> $OUT"
