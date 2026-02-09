#!/usr/bin/env bash
set -euo pipefail

N="${N:-5000}"
CONC_LIST="${CONC_LIST:-10 25 50 100}"
OUT_CSV="${OUT_CSV:-results_curve_baseline.csv}"

if [[ ! -f "$OUT_CSV" ]]; then
  echo "ts,n,concurrency,send_elapsed_ms,converge_elapsed_ms,post_send_converge_ms,relay_p50,relay_p95,relay_p99,relay_avg,relay_max,cons_p50,cons_p95,cons_p99,cons_avg,cons_max,e2e_p50,e2e_p95,e2e_p99,e2e_avg,e2e_max" > "$OUT_CSV"
fi

echo "[RUN] N=$N CONC_LIST=($CONC_LIST) OUT_CSV=$OUT_CSV"

for C in $CONC_LIST; do
  echo ""
  echo "========================================"
  echo "[CASE] CONCURRENCY=$C"
  echo "========================================"

  OUT="$(N="$N" CONCURRENCY="$C" ./latency_5000_fast.sh 2>&1 | tee /dev/stderr)"
  TS="$(date +%Y-%m-%dT%H:%M:%S)"

  RESULT_RAW="$(echo "$OUT" | grep '^__RESULT_CSV__=' | tail -n 1 | sed 's/^__RESULT_CSV__=//')"
  META_RAW="$(echo "$OUT" | grep '^__META__=' | tail -n 1 | sed 's/^__META__=//')"

  if [[ -z "${RESULT_RAW}" || -z "${META_RAW}" ]]; then
    echo "[ERROR] missing __RESULT_CSV__ or __META__. writing NA row."
    echo "$TS,NA,$C,NA,NA,NA,NA,NA,NA,NA,NA,NA,NA,NA,NA,NA,NA,NA,NA,NA,NA" >> "$OUT_CSV"
    continue
  fi

  # META: 숫자만 뽑아내기 (문자 섞여도 안전)
  SEND="$(echo "$META_RAW" | grep -oE 'send_elapsed_ms=[0-9]+' | head -n1 | cut -d= -f2)"
  CONVERGE="$(echo "$META_RAW" | grep -oE 'converge_elapsed_ms=[0-9]+' | head -n1 | cut -d= -f2)"
  POST="$(echo "$META_RAW" | grep -oE 'post_send_converge_ms=[0-9]+' | head -n1 | cut -d= -f2)"

  # RESULT: 구분자가 , 또는 | 로 섞여도 처리
  RESULT_LINE="$(echo "$RESULT_RAW" | tr '|' ',' | tr -d '[:space:]')"

  # 16 필드 강제
  IFS=',' read -r \
    n \
    relay_p50 relay_p95 relay_p99 relay_avg relay_max \
    cons_p50 cons_p95 cons_p99 cons_avg cons_max \
    e2e_p50 e2e_p95 e2e_p99 e2e_avg e2e_max \
    <<< "$RESULT_LINE"

  # 최소 검증 (n이 비어있으면 실패 처리)
  if [[ -z "${n}" ]]; then
    echo "[ERROR] bad RESULT parse: $RESULT_RAW"
    echo "$TS,NA,$C,$SEND,$CONVERGE,$POST,NA,NA,NA,NA,NA,NA,NA,NA,NA,NA,NA,NA,NA,NA,NA" >> "$OUT_CSV"
    continue
  fi

  echo "[PARSE] n=$n send=$SEND converge=$CONVERGE post=$POST"
  echo "$TS,$n,$C,$SEND,$CONVERGE,$POST,$relay_p50,$relay_p95,$relay_p99,$relay_avg,$relay_max,$cons_p50,$cons_p95,$cons_p99,$cons_avg,$cons_max,$e2e_p50,$e2e_p95,$e2e_p99,$e2e_avg,$e2e_max" >> "$OUT_CSV"
done

echo ""
echo "[OK] wrote $OUT_CSV"
