#!/usr/bin/env bash
# run_mttr_curve_safe.sh
# - MTTR curve runner (N x CONC grid) with:
#   * zsh-safe (! history expansion off)
#   * error-tolerant curl fanout (counts non-2xx, but continues)
#   * robust START_OUTBOX_ID (max(id) from outbox_events)
#   * stock qty verification via stocks.qty (NOT products.qty)
#   * per-run integrity checks: outbox/published/applied, distinct applied outbox_id, qty delta
#   * CSV append + per-run log file
#
# Usage:
#   chmod +x ./run_mttr_curve_safe.sh
#   set +H
#   API_BASE="http://127.0.0.1:8000" EMAIL="latencyfast@example.com" PASSWORD='test1234!' \
#   N_LIST="1000 5000 10000" CONC_LIST="10 25 50 75 100" \
#   OUT="mttr_curve.csv" WAIT="0.5" \
#   ./run_mttr_curve_safe.sh
#
# Notes:
# - Assumes docker compose services: db, consumer, api (api should be up)
# - Uses: curl, python, docker compose, psql inside db container

set -Eeuo pipefail

# ---------- defaults ----------
API_BASE="${API_BASE:-http://127.0.0.1:8000}"
EMAIL="${EMAIL:-latencyfast@example.com}"
PASSWORD="${PASSWORD:-test1234!}"

# Space-separated lists
N_LIST="${N_LIST:-1000 5000 10000}"
CONC_LIST="${CONC_LIST:-10 25 50 75 100}"

# Poll interval seconds for MTTR loop
WAIT="${WAIT:-0.5}"

# Output CSV
OUT="${OUT:-mttr_curve.csv}"
LOG_DIR="${LOG_DIR:-./logs}"

mkdir -p "$LOG_DIR"

# zsh history expansion can break on '!' in passwords, etc.
# If this script is invoked from zsh, user should run: set +H
# We'll also avoid literal '!' issues by not using unescaped bangs.

# ---------- helpers ----------
now_ts() {
  # ISO-8601 with timezone
  date -Iseconds
}

die() {
  echo "[ERR] $*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "missing dependency: $1"
}

psql_db() {
  # Run SQL inside db container, return raw stdout
  docker compose exec -T db psql -U postgres -d mini_cdc "$@"
}

psql_scalar() {
  # Print single scalar with trimming
  local sql="$1"
  psql_db -tAc "$sql" | tr -d '[:space:]'
}

json_get() {
  # Read JSON from stdin; print key
  local key="$1"
  python -c "import sys,json; print(json.load(sys.stdin).get('$key',''))"
}

trap 'echo "[ERR] script failed at line $LINENO" >&2' ERR

need curl
need python
need docker

# ---------- login ----------
echo "[ENV] API_BASE=$API_BASE EMAIL=$EMAIL"
echo "[ENV] N_LIST=($N_LIST) CONC_LIST=($CONC_LIST) WAIT=$WAIT OUT=$OUT"

TOKEN="$(curl -sS -X POST "$API_BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  | python -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")"

if [[ -z "${TOKEN:-}" ]]; then
  die "failed to obtain TOKEN"
fi

ME="$(curl -sS "$API_BASE/auth/me" -H "Authorization: Bearer $TOKEN")"
OWNER="$(printf '%s' "$ME" | python -c "import sys,json; print(json.load(sys.stdin)['id'])")"
echo "[OK] OWNER=$OWNER TOKEN_len=${#TOKEN}"

# ---------- create product for this whole curve ----------
CREATE_RES="$(curl -sS -X POST "$API_BASE/products" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"mttr-curve-product","category":"cat","price":1000,"qty":0}')"

PID="$(printf '%s' "$CREATE_RES" | python -c "import sys,json; print(json.load(sys.stdin)['id'])")"
if [[ -z "${PID:-}" ]]; then
  echo "[DBG] CREATE_RES=$CREATE_RES" >&2
  die "failed to create product (PID empty)"
fi
echo "[OK] PID=$PID"

# ---------- ensure stocks row exists & get stock before ----------
# Some systems create stock row lazily; your API likely does it.
# We'll read stocks.qty; if missing row, qty_before will be empty -> treat as 0.
stock_qty() {
  local pid="$1"
  local owner="$2"
  local q
  q="$(psql_db -tAc "SELECT qty FROM stocks WHERE product_id=$pid AND owner_id=$owner;" | tr -d '[:space:]' || true)"
  if [[ -z "${q}" ]]; then
    echo "0"
  else
    echo "$q"
  fi
}

# ---------- CSV header ----------
if [[ ! -f "$OUT" ]]; then
  echo "ts,n,conc,owner,pid,start_outbox_id,send_elapsed_ms,mttr_ms,req_ok,req_fail,outbox_after,published_after,applied_after,distinct_applied_outbox_id,stock_before,stock_after,stock_delta" > "$OUT"
fi

# ---------- request fanout (tolerant) ----------
# Prints: "<ok_count> <fail_count> <send_elapsed_ms>"
send_requests() {
  local n="$1"
  local conc="$2"
  local pid="$3"
  local token="$4"

  local t0 t1
  t0="$(python - <<'PY'
import time; print(int(time.time()*1000))
PY
)"
  # Fanout: output HTTP code per request; count 2xx vs others
  # Important: do not let single curl fail abort the script.
  local counts
  counts="$(
    seq 1 "$n" | xargs -n 1 -P "$conc" bash -lc '
      i="$1"
      code="$(curl -s -o /dev/null -w "%{http_code}" \
        --connect-timeout 2 --max-time 15 \
        -X POST "'"$API_BASE"'/products/'"$PID"'/stock-adjust" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer '"$TOKEN"'" \
        -d "{\"type\":\"in\",\"quantity\":1,\"note\":\"mttr-curve-$i\"}" \
        || echo "000")"
      echo "$code"
    ' _ 2>/dev/null \
    | awk '{
        if ($1 ~ /^2/) ok++;
        else fail++;
      } END { printf("%d %d\n", ok+0, fail+0) }'
  )"

  t1="$(python - <<'PY'
import time; print(int(time.time()*1000))
PY
)"
  local send_ms=$((t1 - t0))
  local ok fail
  ok="$(echo "$counts" | awk '{print $1}')"
  fail="$(echo "$counts" | awk '{print $2}')"
  echo "$ok $fail $send_ms"
}

# ---------- measure MTTR ----------
# MTTR is measured from consumer start -> applied_after == n
measure_mttr_ms() {
  local n="$1"
  local start_outbox_id="$2"
  local owner="$3"
  local pid="$4"
  local wait="$5"

  local t0 t1 applied
  t0="$(python - <<'PY'
import time; print(int(time.time()*1000))
PY
)"
  while true; do
    applied="$(psql_scalar "
      SELECT COUNT(*)
      FROM outbox_events oe
      JOIN readmodel_apply_log al ON al.outbox_id=oe.id
      WHERE oe.id > $start_outbox_id
        AND oe.owner_id=$owner
        AND oe.aggregate_id=$pid
        AND oe.event_type='STOCK_ADJUSTED';
    ")"
    if [[ "$applied" == "$n" ]]; then
      break
    fi
    sleep "$wait"
  done
  t1="$(python - <<'PY'
import time; print(int(time.time()*1000))
PY
)"
  echo $((t1 - t0))
}

# ---------- per-run verification summary ----------
verify_counts_csv() {
  local start_outbox_id="$1"
  local owner="$2"
  local pid="$3"
  psql_db -tAc "
    SELECT
      COUNT(*)::int AS outbox_after,
      COUNT(*) FILTER (WHERE oe.published_at IS NOT NULL)::int AS published_after,
      COUNT(*) FILTER (WHERE al.outbox_id IS NOT NULL)::int AS applied_after,
      COUNT(DISTINCT al.outbox_id)::int AS distinct_applied_outbox_id
    FROM outbox_events oe
    LEFT JOIN readmodel_apply_log al ON al.outbox_id=oe.id
    WHERE oe.id > $start_outbox_id
      AND oe.owner_id=$owner
      AND oe.aggregate_id=$pid
      AND oe.event_type='STOCK_ADJUSTED';
  " | tr -d '[:space:]'
}

# ---------- run grid ----------
for N in $N_LIST; do
  for CONC in $CONC_LIST; do
    TS="$(now_ts)"
    LOG="$LOG_DIR/mttr_${TS}_N${N}_C${CONC}.log"
    {
      echo ""
      echo "===== MTTR RUN ts=$TS N=$N CONC=$CONC ====="
      echo "[INFO] OWNER=$OWNER PID=$PID"

      # 0) refresh START_OUTBOX_ID each run (avoid START_ID=0 bug)
      START_OUTBOX_ID="$(psql_scalar "SELECT COALESCE(MAX(id),0) FROM outbox_events;")"
      echo "[OK] start_outbox_id=$START_OUTBOX_ID"

      STOCK_BEFORE="$(stock_qty "$PID" "$OWNER")"
      echo "[OK] stock_before=$STOCK_BEFORE"

      # 1) stop consumer
      echo "[STEP] stopping consumer..."
      docker compose stop consumer >/dev/null || true
      sleep 1

      # 2) generate backlog (requests) while consumer is down
      echo "[STEP] generating backlog requests..."
      read -r REQ_OK REQ_FAIL SEND_MS < <(send_requests "$N" "$CONC" "$PID" "$TOKEN")
      echo "[DONE] sent N=$N conc=$CONC send_elapsed_ms=$SEND_MS ok=$REQ_OK fail=$REQ_FAIL"

      # 3) check counts while consumer down (applied should be 0)
      echo "[CHECK] consumer down counts:"
      DOWN_COUNTS="$(verify_counts_csv "$START_OUTBOX_ID" "$OWNER" "$PID")"
      echo "down_counts=$DOWN_COUNTS (outbox|published|applied|distinct_applied)"

      # 4) start consumer & MTTR measure
      echo "[STEP] starting consumer..."
      docker compose start consumer >/dev/null

      # 목표치는 N이 아니라 실제 성공한 요청 수(REQ_OK) 기준이어야 한다.
      # 요청이 일부 실패하면 이벤트가 N보다 적게 생기므로 N을 기다리면 영원히 끝나지 않는다.
      echo "[WAIT] measuring MTTR until applied == $REQ_OK ..."
      MTTR_MS="$(measure_mttr_ms "$REQ_OK" "$START_OUTBOX_ID" "$OWNER" "$PID" "$WAIT")"
      echo "[RESULT] mttr_ms=$MTTR_MS"

      # 5) final verification
      FINAL_COUNTS="$(verify_counts_csv "$START_OUTBOX_ID" "$OWNER" "$PID")"
      echo "final_counts=$FINAL_COUNTS (outbox|published|applied|distinct_applied)"

      STOCK_AFTER="$(stock_qty "$PID" "$OWNER")"
      STOCK_DELTA=$((STOCK_AFTER - STOCK_BEFORE))
      echo "[VERIFY] stock_after=$STOCK_AFTER stock_delta=$STOCK_DELTA (expected ~ +$REQ_OK)"

      # Parse counts
      IFS='|' read -r OUTBOX_AFTER PUBLISHED_AFTER APPLIED_AFTER DISTINCT_APPLIED <<<"$FINAL_COUNTS"

      # Quick assertions (non-fatal: we still record CSV)
      if [[ "$REQ_FAIL" != "0" ]]; then
        echo "[WARN] request failures detected: fail=$REQ_FAIL"
      fi
      if [[ "$APPLIED_AFTER" != "$OUTBOX_AFTER" || "$PUBLISHED_AFTER" != "$OUTBOX_AFTER" ]]; then
        echo "[WARN] mismatch counts outbox/published/applied: $FINAL_COUNTS"
      fi
      if [[ "$DISTINCT_APPLIED" != "$APPLIED_AFTER" ]]; then
        echo "[WARN] duplicate apply detected? distinct_applied != applied ($DISTINCT_APPLIED != $APPLIED_AFTER)"
      fi

      # 6) CSV append
      echo "${TS},${N},${CONC},${OWNER},${PID},${START_OUTBOX_ID},${SEND_MS},${MTTR_MS},${REQ_OK},${REQ_FAIL},${OUTBOX_AFTER},${PUBLISHED_AFTER},${APPLIED_AFTER},${DISTINCT_APPLIED},${STOCK_BEFORE},${STOCK_AFTER},${STOCK_DELTA}" \
        | tee -a "$OUT"

      echo "[DONE] appended -> $OUT"
    } 2>&1 | tee "$LOG"
  done
done

echo ""
echo "[ALL DONE] CSV saved -> $OUT"
