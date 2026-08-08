#!/usr/bin/env bash
#
# 서버에서 실행되는 배포 스크립트. CD가 scp로 올린 뒤 ssh로 호출한다.
# 손으로도 실행 가능:
#   cd /opt/stockops && ./deploy.sh ghcr.io/applepc24/mini_cdc:sha-abc1234
#
# 인프라(db/kafka/zookeeper)는 건드리지 않는다. 앱 3개만 교체한다.

set -euo pipefail
# -e: 명령 하나라도 실패하면 즉시 중단 (실패를 못 보고 지나치는 사고 방지)
# -u: 정의 안 된 변수 사용 시 에러 (오타로 빈 문자열이 들어가는 사고 방지)
# -o pipefail: 파이프 중간이 실패해도 전체를 실패로 처리

APP_DIR="${APP_DIR:-/opt/stockops}"
ENV_FILE=".env.prod"
COMPOSE_FILE="docker-compose.prod.yml"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8000/health}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"   # 30회 x 2초 = 최대 60초 대기
APP_SERVICES=(api relay consumer)

NEW_IMAGE="${1:-}"
if [ -z "$NEW_IMAGE" ]; then
  echo "usage: $0 <image>   (예: ghcr.io/applepc24/mini_cdc:sha-abc1234)" >&2
  exit 2
fi

cd "$APP_DIR"
compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

# ── 1. 롤백 지점 확보 ────────────────────────────────────────
# 값에 '=' 가 있어도 잘리지 않도록 -f2- (2번째 필드부터 끝까지)
PREV_IMAGE="$(grep -E '^IMAGE=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
echo "[deploy] prev=${PREV_IMAGE:-<none>}"
echo "[deploy] new =${NEW_IMAGE}"

# ── 2. 먼저 받아둔다 ─────────────────────────────────────────
# up 이 알아서 pull 하게 두면, 컨테이너를 내린 뒤 받다가 실패했을 때
# 서비스가 내려간 채로 멈춘다. 받아놓고 나서 교체해야 다운타임이 짧다.
echo "[deploy] pulling image..."
docker pull "$NEW_IMAGE"

# ── 3. IMAGE 한 줄만 교체 ────────────────────────────────────
if grep -qE '^IMAGE=' "$ENV_FILE"; then
  sed -i "s|^IMAGE=.*|IMAGE=${NEW_IMAGE}|" "$ENV_FILE"
else
  echo "IMAGE=${NEW_IMAGE}" >> "$ENV_FILE"
fi

# ── 4. 앱 컨테이너만 교체 ────────────────────────────────────
# --no-deps: depends_on 을 따라 db/kafka 까지 재생성하는 것을 막는다.
echo "[deploy] recreating: ${APP_SERVICES[*]}"
compose up -d --no-deps "${APP_SERVICES[@]}"

# ── 5. 진짜 살아있는지 확인 ──────────────────────────────────
# 'up 성공' != '앱 정상'. 컨테이너가 떠도 앱은 즉사할 수 있다.
echo "[deploy] health check: ${HEALTH_URL}"
healthy=0
for i in $(seq 1 "$HEALTH_RETRIES"); do
  # -f 필수: 없으면 HTTP 500 을 받아도 curl 은 종료코드 0 을 낸다.
  if curl -fsS -m 3 "$HEALTH_URL" >/dev/null 2>&1; then
    healthy=1
    echo "[deploy] healthy (${i}번째 시도)"
    break
  fi
  sleep 2
done

# ── 6. 실패하면 되돌린다 ────────────────────────────────────
if [ "$healthy" != "1" ]; then
  echo "[deploy] ❌ health check 실패 — 롤백" >&2
  compose logs --tail 50 api >&2 || true

  if [ -n "$PREV_IMAGE" ]; then
    sed -i "s|^IMAGE=.*|IMAGE=${PREV_IMAGE}|" "$ENV_FILE"
    compose up -d --no-deps "${APP_SERVICES[@]}"
    echo "[deploy] 이전 이미지로 롤백함: ${PREV_IMAGE}" >&2
  else
    echo "[deploy] 롤백할 이전 이미지가 없음(최초 배포)" >&2
  fi
  exit 1
fi

# ── 7. 정리 ─────────────────────────────────────────────────
# ⚠️ 이 서버에는 다른 프로젝트(wordpress, pubinsight)도 떠 있다.
# `docker image prune -f` 는 전역으로 동작해 남의 프로젝트 레이어까지 건드리므로 쓰지 않는다.
# 우리 저장소의 sha- 태그 중 최근 5개만 남기고 정리한다(docker image ls 는 최신순 정렬).
REPO="${NEW_IMAGE%%:*}"
docker image ls --format '{{.Repository}}:{{.Tag}}' \
  | grep "^${REPO}:sha-" \
  | tail -n +6 \
  | xargs -r docker rmi >/dev/null 2>&1 || true

echo "[deploy] ✅ 완료: ${NEW_IMAGE}"
