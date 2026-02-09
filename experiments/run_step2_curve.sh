#!/usr/bin/env bash
set -euo pipefail

# ====== CONFIG (필요하면 여기만 수정) ======
API_BASE="${API_BASE:-http://127.0.0.1:8000}"
EMAIL="${EMAIL:-latencyfast@example.com}"
PASSWORD="${PASSWORD:-test1234!}"
N="${N:-5000}"
WAIT_POLL_SEC="${WAIT_POLL_SEC:-0.2}"

# step2 범위 (10~100)
CONC_LIST=(${CONC_LIST:-10 25 50 75 100})

OUT="${OUT:-results_curve_step2_$(date -Iseconds | tr ':+' '__').csv}"

export API_BASE EMAIL PASSWORD N WAIT_POLL_SEC

# ====== CSV header ======
echo "ts,n,concurrency,send_elapsed_ms,converge_elapsed_ms,post_send_converge_ms,relay_p50,relay_p95,relay_p99,relay_avg,relay_max,cons_p50,cons_p95,cons_p99,cons_avg,cons_max,e2e_p50,e2e_p95,e2e_p99,e2e_avg,e2e_max" > "$OUT"

echo "[INFO] OUT=$OUT"
echo "[INFO] API_BASE=$API_BASE N=$N CONC_LIST=${CONC_LIST[*]}"

for C in "${CONC_LIST[@]}"; do
  echo ""
  echo "========================================"
  echo "[CASE] CONCURRENCY=$C"
  echo "========================================"

  LOG="$(mktemp /tmp/latency_${C}_XXXX.log)"

  # latency_5000_fast.sh 실행
  CONCURRENCY="$C" bash ./latency_5000_fast.sh > "$LOG"

  # 파싱
  RES="$(grep -m1 '^__RESULT_CSV__=' "$LOG" | sed 's/^__RESULT_CSV__=//')"
  META="$(grep -m1 '^__META__=' "$LOG" | sed 's/^__META__=//')"

  if [[ -z "${RES:-}" || -z "${META:-}" ]]; then
    echo "[ERR] cannot find __RESULT_CSV__ or __META__ in log: $LOG" >&2
    tail -n 50 "$LOG" >&2
    exit 1
  fi

  SEND="$(echo "$META" | sed -n 's/.*send_elapsed_ms=\([0-9]*\).*/\1/p')"
  CONV="$(echo "$META" | sed -n 's/.*converge_elapsed_ms=\([0-9]*\).*/\1/p')"
  POST="$(echo "$META" | sed -n 's/.*post_send_converge_ms=\([0-9]*\).*/\1/p')"

  # RES = n|relay_p50|...|e2e_max  (n 포함 16개)
  RES_CSV="$(echo "$RES" | tr '|' ',')"
  # 최종 row: ts,n,concurrency,send,converge,post, (relay~e2e stats)
  TS="$(date -Iseconds)"

  # RES_CSV의 첫 컬럼은 n(=5000) 이라서 중복방지 위해 뒤(2~)만 붙임
  echo "${TS},${N},${C},${SEND},${CONV},${POST},$(echo "$RES_CSV" | cut -d',' -f2-)" | tee -a "$OUT"

  rm -f "$LOG"
done

echo ""
echo "[DONE] saved -> $OUT"
