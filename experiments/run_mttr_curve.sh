#!/usr/bin/env bash
set -euo pipefail

# =========================
# MTTR Curve Runner
# - consumer stop -> backlog generate -> consumer start
# - MTTR = (consumer start -> applied_after == N)
# - prove: outbox/published/applied counts == N, distinct outbox_id == N, final stock delta == N
#
# Usage:
#   chmod +x run_mttr_curve.sh
#   set +H   # (zsh history expansion off)
#   API_BASE="http://127.0.0.1:8000" EMAIL="latencyfast@example.com" PASSWORD='test1234!' \
#   N_LIST="1000 5000 10000" CONC_LIST="10 25 50 75 100" \
#   bash ./run_mttr_curve.sh
# =========================

API_BASE="${API_BASE:-http://127.0.0.1:8000}"
EMAIL="${EMAIL:-latencyfast@example.com}"
PASSWORD="${PASSWORD:-test1234!}"

N_LIST="${N_LIST:-1000 5000 10000}"
CONC_LIST="${CONC_LIST:-10 25 50 75 100}"

POLL="${POLL:-0.2}"
OUT="${OUT:-mttr_curve.csv}"

ts() { date -Iseconds; }

# --- helper: find stock-like int column in stocks table (qty/quantity/stock...) ---
pick_stocks_qty_col() {
  docker compose exec -T db psql -U postgres -d mini_cdc -tAc "
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='stocks'
      AND data_type IN ('integer','bigint','smallint')
      AND column_name NOT IN ('id','product_id','owner_id')
    ORDER BY
      CASE
        WHEN column_name ILIKE '%qty%' THEN 0
        WHEN column_name ILIKE '%quant%' THEN 1
        WHEN column_name ILIKE '%stock%' THEN 2
        WHEN column_name ILIKE '%amount%' THEN 3
        WHEN column_name ILIKE '%count%' THEN 4
        ELSE 99
      END,
      ordinal_position
    LIMIT 1;
  " | tr -d '[:space:]'
}

get_stock_qty() {
  local pid="$1"

  # stocks 테이블이 진짜 재고를 들고 있음 (stocks: product_id, owner_id, qty ...)
  docker compose exec -T db psql -U postgres -d mini_cdc -tAc "
    SELECT qty
    FROM stocks
    WHERE product_id=${pid};
  " | tr -d '[:space:]'
}

# --- header ---
if [[ ! -f "$OUT" ]]; then
  echo "ts,n,concurrency,send_elapsed_ms,mttr_ms,outbox_after,published_after,applied_after,distinct_applied_outbox_id,stock_before,stock_after,stock_delta,start_outbox_id,owner_id,product_id" > "$OUT"
fi

echo "[ENV] API_BASE=$API_BASE EMAIL=$EMAIL N_LIST=($N_LIST) CONC_LIST=($CONC_LIST) OUT=$OUT"

# 0) login
TOKEN="$(curl -sS -X POST "$API_BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  | python -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")"

OWNER="$(curl -sS "$API_BASE/auth/me" -H "Authorization: Bearer $TOKEN" \
  | python -c "import sys,json; print(json.load(sys.stdin)['id'])")"

echo "[OK] OWNER=$OWNER TOKEN_len=${#TOKEN}"

# 1) create product for MTTR
CREATE_RES="$(curl -sS -X POST "$API_BASE/products" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"mttr-product","category":"cat","price":1000,"qty":0}')"

PID="$(echo "$CREATE_RES" | python -c "import sys,json; print(json.load(sys.stdin)['id'])")"
echo "[OK] PID=$PID"

# 2) choose stocks qty col
STOCK_COL="$(pick_stocks_qty_col)"
if [[ -z "$STOCK_COL" ]]; then
  echo "[ERR] Could not find stock-like int column in 'stocks' table." >&2
  echo "      Run: docker compose exec -T db psql -U postgres -d mini_cdc -c \"\\d stocks\"" >&2
  exit 1
fi
echo "[OK] stocks.qty_column=$STOCK_COL"

# 3) baseline stock
STOCK_BEFORE="$(get_stock_qty "$PID" "$STOCK_COL")"
echo "[OK] stock_before=$STOCK_BEFORE"

for N in $N_LIST; do
  for CONC in $CONC_LIST; do
    echo ""
    echo "===== MTTR RUN N=$N CONC=$CONC ====="

    # (A) global start_outbox_id (so it won't be 0)
    START_OUTBOX_ID="$(docker compose exec -T db psql -U postgres -d mini_cdc -tAc "SELECT COALESCE(MAX(id),0) FROM outbox_events;" | tr -d '[:space:]')"
    echo "[OK] start_outbox_id=$START_OUTBOX_ID"

    # (B) stop consumer
    echo "[STEP] stopping consumer..."
    docker compose stop consumer >/dev/null
    sleep 1

    # (C) generate backlog
    echo "[STEP] generating backlog requests..."
    t0_ms="$(python - <<'PY'
import time
print(int(time.time()*1000))
PY
)"
    seq 1 "$N" | xargs -n 1 -P "$CONC" bash -lc '
i="$1"
curl -s -o /dev/null --connect-timeout 2 --max-time 10 \
  -X POST "'"$API_BASE"'/products/'"$PID"'/stock-adjust" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer '"$TOKEN"'" \
  -d "{\"type\":\"in\",\"quantity\":1,\"note\":\"mttr-$i\"}"
' _
    t1_ms="$(python - <<'PY'
import time
print(int(time.time()*1000))
PY
)"
    SEND_MS=$((t1_ms - t0_ms))
    echo "[DONE] sent N=$N send_elapsed_ms=$SEND_MS"

    # (D) confirm backlog created (consumer down -> applied likely 0)
    read -r OUTBOX_AFTER PUB_AFTER APPLIED_AFTER < <(
      docker compose exec -T db psql -U postgres -d mini_cdc -tAc "
        SELECT
          COUNT(*)::int AS outbox_after,
          COUNT(*) FILTER (WHERE published_at IS NOT NULL)::int AS published_after,
          COUNT(*) FILTER (WHERE al.outbox_id IS NOT NULL)::int AS applied_after
        FROM outbox_events oe
        LEFT JOIN readmodel_apply_log al ON al.outbox_id=oe.id
        WHERE oe.id > ${START_OUTBOX_ID}
          AND oe.owner_id=${OWNER}
          AND oe.aggregate_id=${PID}
          AND oe.event_type='STOCK_ADJUSTED';
      " | tr -d '[:space:]' | tr '|' ' '
    )

    echo "[CHECK] after-load (consumer down) outbox=$OUTBOX_AFTER published=$PUB_AFTER applied=$APPLIED_AFTER"

    # (E) start consumer + MTTR measure
    echo "[STEP] starting consumer..."
    docker compose start consumer >/dev/null

    t2_ms="$(python - <<'PY'
import time
print(int(time.time()*1000))
PY
)"
    while true; do
      cur="$(docker compose exec -T db psql -U postgres -d mini_cdc -tAc "
        SELECT COUNT(*)::int
        FROM outbox_events oe
        JOIN readmodel_apply_log al ON al.outbox_id=oe.id
        WHERE oe.id > ${START_OUTBOX_ID}
          AND oe.owner_id=${OWNER}
          AND oe.aggregate_id=${PID}
          AND oe.event_type='STOCK_ADJUSTED';
      " | tr -d '[:space:]')"
      if [[ "$cur" == "$N" ]]; then
        break
      fi
      sleep "$POLL"
    done
    t3_ms="$(python - <<'PY'
import time
print(int(time.time()*1000))
PY
)"
    MTTR_MS=$((t3_ms - t2_ms))
    echo "[OK] MTTR_ms=$MTTR_MS (consumer start -> applied==N)"

    # (F) prove: outbox/published/applied == N and distinct(outbox_id)==N
    read -r OUTBOX2 PUB2 APPLIED2 DISTINCT2 < <(
      docker compose exec -T db psql -U postgres -d mini_cdc -tAc "
        WITH s AS (
          SELECT oe.id AS outbox_id, oe.published_at, al.outbox_id AS applied_id
          FROM outbox_events oe
          LEFT JOIN readmodel_apply_log al ON al.outbox_id=oe.id
          WHERE oe.id > ${START_OUTBOX_ID}
            AND oe.owner_id=${OWNER}
            AND oe.aggregate_id=${PID}
            AND oe.event_type='STOCK_ADJUSTED'
        )
        SELECT
          COUNT(*)::int,
          COUNT(*) FILTER (WHERE published_at IS NOT NULL)::int,
          COUNT(*) FILTER (WHERE applied_id IS NOT NULL)::int,
          COUNT(DISTINCT applied_id)::int
        FROM s;
      " | tr -d '[:space:]' | tr '|' ' '
    )

    # (G) prove: final stock delta == N
    STOCK_AFTER="$(get_stock_qty "$PID" "$STOCK_COL")"
    STOCK_DELTA=$((STOCK_AFTER - STOCK_BEFORE))

    echo "[PROVE] outbox=$OUTBOX2 published=$PUB2 applied=$APPLIED2 distinct_applied=$DISTINCT2  stock_before=$STOCK_BEFORE stock_after=$STOCK_AFTER delta=$STOCK_DELTA"

    # (H) write CSV row
    echo "$(ts),$N,$CONC,$SEND_MS,$MTTR_MS,$OUTBOX2,$PUB2,$APPLIED2,$DISTINCT2,$STOCK_BEFORE,$STOCK_AFTER,$STOCK_DELTA,$START_OUTBOX_ID,$OWNER,$PID" | tee -a "$OUT"
  done
done

echo ""
echo "[DONE] saved -> $OUT"
