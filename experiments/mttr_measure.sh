#!/usr/bin/env bash
set -euo pipefail

PRODUCT_ID="${PRODUCT_ID:-26}"
OWNER_ID="${OWNER_ID:-6}"  # recovery@example.com 유저 id가 뭔지 모르니 아래에서 자동으로 찾음

# owner_id 자동 추출 (email 기반)
EMAIL="${EMAIL:-recovery@example.com}"
OWNER_ID=$(docker compose exec -T db psql -U postgres -d mini_cdc -tAc \
  "SELECT id FROM users WHERE email='${EMAIL}' LIMIT 1;")

if [[ -z "$OWNER_ID" ]]; then
  echo "[ERR] owner_id not found for email=$EMAIL"
  exit 1
fi

echo "[INFO] PRODUCT_ID=$PRODUCT_ID OWNER_ID=$OWNER_ID EMAIL=$EMAIL"

# backlog 정의: outbox_events 중 NEW (아직 relay가 못 보냈거나, consumer 적용 전일 수도 있음)
# + SENT인데 product_search.last_outbox_id로 아직 반영 안 된 것(consumer backlog)
backlog_sql="
WITH latest AS (
  SELECT id, owner_id, aggregate_id, created_at, status
  FROM outbox_events
  WHERE owner_id=${OWNER_ID}
    AND aggregate_id=${PRODUCT_ID}
    AND event_type='STOCK_ADJUSTED'
  ORDER BY id DESC
  LIMIT 5000
),
applied AS (
  SELECT last_outbox_id
  FROM product_search
  WHERE owner_id=${OWNER_ID} AND product_id=${PRODUCT_ID}
)
SELECT
  (SELECT COUNT(*) FROM outbox_events
    WHERE owner_id=${OWNER_ID}
      AND aggregate_id=${PRODUCT_ID}
      AND event_type='STOCK_ADJUSTED'
      AND status='NEW') AS outbox_new,
  (SELECT COALESCE(MAX(id),0) FROM latest) AS max_outbox_id,
  (SELECT COALESCE(last_outbox_id,0) FROM applied) AS applied_outbox_id,
  (SELECT COALESCE(MAX(id),0) FROM latest) - (SELECT COALESCE(last_outbox_id,0) FROM applied) AS pending_by_last_outbox
;
"

echo "[CHECK] backlog before restart:"
docker compose exec -T db psql -U postgres -d mini_cdc -tAc "$backlog_sql"

echo
echo "[ACTION] starting consumer..."
START_MS=$(python -c "import time; print(int(time.time()*1000))")
docker compose start consumer >/dev/null

# pending_by_last_outbox == 0 이 될 때까지 폴링
echo "[MEASURE] waiting backlog -> 0 ..."
while true; do
  ROW=$(docker compose exec -T db psql -U postgres -d mini_cdc -tAc "$backlog_sql" | tr -d ' ')
  # 형식: outbox_new|max_outbox_id|applied_outbox_id|pending
  OUTBOX_NEW=$(echo "$ROW" | cut -d'|' -f1)
  MAX_ID=$(echo "$ROW" | cut -d'|' -f2)
  APPLIED_ID=$(echo "$ROW" | cut -d'|' -f3)
  PENDING=$(echo "$ROW" | cut -d'|' -f4)

  NOW_MS=$(python -c "import time; print(int(time.time()*1000))")
  ELAPSED=$((NOW_MS-START_MS))

  echo "t=${ELAPSED}ms outbox_new=${OUTBOX_NEW} max_id=${MAX_ID} applied_id=${APPLIED_ID} pending=${PENDING}"

  if [[ "$PENDING" == "0" ]]; then
    echo "[DONE] MTTR=${ELAPSED}ms"
    break
  fi
  sleep 0.3
done
