#!/usr/bin/env bash
set -euo pipefail

PRODUCT_ID=${PRODUCT_ID:-24}
OWNER_ID=${OWNER_ID:-5}
N=${N:-50}

for i in $(seq 1 $N); do
  curl -s -X POST "http://localhost:8000/products/${PRODUCT_ID}/stock-adjust" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"type\":\"in\",\"quantity\":1,\"note\":\"latency-batch-$i\"}" >/dev/null

  OUTBOX_ID=$(docker compose exec -T db psql -U postgres -d mini_cdc -tAc \
    "SELECT id FROM outbox_events ORDER BY id DESC LIMIT 1;")

  # read model 적용될 때까지 최대 3초 폴링(0.1s 간격)
  for t in $(seq 1 30); do
    ROW=$(docker compose exec -T db psql -U postgres -d mini_cdc -tAc "
      WITH ev AS (SELECT id, created_at FROM outbox_events WHERE id=${OUTBOX_ID})
      SELECT
        ev.id,
        (EXTRACT(EPOCH FROM (ps.updated_at - ev.created_at))*1000)::bigint AS latency_ms
      FROM ev
      JOIN product_search ps
        ON ps.product_id=${PRODUCT_ID}
       AND ps.owner_id=${OWNER_ID}
       AND ps.last_outbox_id=ev.id
    ")
    if [[ -n "$ROW" ]]; then
      echo "$ROW"   # outboxId|latencyMs
      break
    fi
    sleep 0.1
  done
done
