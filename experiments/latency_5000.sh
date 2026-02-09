#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:8000}"
EMAIL="${EMAIL:-latency@example.com}"
PASSWORD="${PASSWORD:-test1234!}"
N="${N:-5000}"

# 폴링 간격/최대 대기 (각 이벤트가 read model 반영될 때까지)
POLL_SEC="${POLL_SEC:-0.05}"          # 50ms
MAX_WAIT_SEC="${MAX_WAIT_SEC:-10}"    # 이벤트 1개당 최대 10초까지 기다림

# 결과 파일
OUT="${OUT:-latency_results_5000.txt}"
: > "$OUT"

echo "[ENV] API_BASE=$API_BASE N=$N POLL_SEC=$POLL_SEC MAX_WAIT_SEC=$MAX_WAIT_SEC OUT=$OUT"

# 0) 유저 준비(있으면 무시) + 로그인 토큰
curl -s -X POST "${API_BASE}/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"name\":\"latency\"}" >/dev/null || true

TOKEN="$(curl -s -X POST "${API_BASE}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" \
  | python -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")"

echo "[OK] got TOKEN (len=${#TOKEN})"

# 1) 테스트용 상품 생성
CREATE_RES="$(curl -s -X POST "${API_BASE}/products" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{"name":"latency-product","category":"cat","price":1000,"qty":0}')"

PRODUCT_ID="$(python - <<PY
import json
d=json.loads('''$CREATE_RES''')
print(d['id'])
PY
)"
echo "[OK] created product_id=${PRODUCT_ID}"

# owner_id 조회
ME="$(curl -s "${API_BASE}/auth/me" -H "Authorization: Bearer ${TOKEN}")"
OWNER_ID="$(python - <<PY
import json
d=json.loads('''$ME''')
print(d['id'])
PY
)"
echo "[OK] owner_id=${OWNER_ID}"

# 2) 시작점 outbox_id 기록
START_OUTBOX_ID="$(docker compose exec -T db psql -U postgres -d mini_cdc -tAc "SELECT COALESCE(MAX(id),0) FROM outbox_events;")"
echo "[OK] start_outbox_id=${START_OUTBOX_ID}"

# 3) N건 요청을 순차로 보내고, 매번 outbox_id를 뽑아 해당 outbox가 read model에 반영될 때까지 폴링
echo "[RUN] sending ${N} requests + measuring per-event E2E latency..."

for i in $(seq 1 "$N"); do
  # 요청 시각(ms)
  req_ms="$(python - <<'PY'
import time
print(int(time.time()*1000))
PY
)"

  # API 요청 (outbox 생성 트리거)
  curl -s -X POST "${API_BASE}/products/${PRODUCT_ID}/stock-adjust" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d "{\"type\":\"in\",\"quantity\":1,\"note\":\"latency-${i}\"}" >/dev/null

  # 방금 생성된 outbox_id (start_outbox_id 이후 중 가장 최신)
  OUTBOX_ID="$(docker compose exec -T db psql -U postgres -d mini_cdc -tAc \
    "SELECT id FROM outbox_events WHERE id > ${START_OUTBOX_ID} ORDER BY id DESC LIMIT 1;" | tr -d '[:space:]')"

  # read model 반영까지 폴링: product_search.last_outbox_id == outbox_id
  # done_ms는 read model updated_at을 ms로 변환해서 req_ms 대비 latency 측정
  deadline="$(python - <<PY
import time
print(time.time() + float("${MAX_WAIT_SEC}"))
PY
)"

  while true; do
    row="$(docker compose exec -T db psql -U postgres -d mini_cdc -tAc "
      WITH ev AS (
        SELECT id, EXTRACT(EPOCH FROM created_at)*1000 AS created_ms
        FROM outbox_events WHERE id=${OUTBOX_ID}
      ),
      applied AS (
        SELECT EXTRACT(EPOCH FROM updated_at)*1000 AS updated_ms
        FROM product_search
        WHERE product_id=${PRODUCT_ID}
          AND owner_id=${OWNER_ID}
          AND last_outbox_id=${OUTBOX_ID}
      )
      SELECT ev.id::text || '|' ||
             (COALESCE(applied.updated_ms, 0) - ${req_ms})::bigint
      FROM ev
      LEFT JOIN applied ON TRUE;
    " | tr -d '[:space:]')"

    # row: "outboxId|latencyMs" (latencyMs가 음수/0이면 아직 미반영)
    outbox_id="${row%%|*}"
    lat_ms="${row##*|}"

    if [[ "$lat_ms" =~ ^[0-9]+$ ]] && (( lat_ms > 0 )); then
      echo "${outbox_id}|${lat_ms}" >> "$OUT"
      break
    fi

    now="$(python - <<'PY'
import time
print(time.time())
PY
)"
    # 타임아웃
    if python - <<PY >/dev/null
import sys
now=float("${now}")
dl=float("${deadline}")
sys.exit(0 if now <= dl else 1)
PY
    then
      sleep "$POLL_SEC"
    else
      echo "${outbox_id}|TIMEOUT" >> "$OUT"
      break
    fi
  done

  if (( i % 100 == 0 )); then
    echo "  measured ${i}/${N}"
  fi
done

echo "[DONE] wrote $OUT"

# 4) 통계 출력 (TIMEOUT 제외)
python - <<PY
import numpy as np

path="${OUT}"
vals=[]
timeouts=0
with open(path,"r") as f:
    for line in f:
        line=line.strip()
        if not line: 
            continue
        _, v = line.split("|",1)
        if v=="TIMEOUT":
            timeouts += 1
            continue
        vals.append(int(v))

print("============ STATS ============")
print("file =", path)
print("n_total =", (len(vals)+timeouts))
print("n_ok =", len(vals))
print("n_timeout =", timeouts)

if len(vals)==0:
    print("No successful measurements.")
    raise SystemExit(0)

arr=np.array(vals)

def pct(p):
    return int(np.percentile(arr, p, method="linear"))

print("p50_ms =", pct(50))
print("p95_ms =", pct(95))
print("p99_ms =", pct(99))
print("min_ms =", int(arr.min()))
print("max_ms =", int(arr.max()))
print("avg_ms =", int(arr.mean()))
print("================================")
PY

echo "[INFO] product_id=${PRODUCT_ID} owner_id=${OWNER_ID} email=${EMAIL}"
