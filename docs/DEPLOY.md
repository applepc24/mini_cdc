# 배포 (CI/CD)

`main` 푸시 → CI 통과 → GHCR 빌드/푸시 → 홈서버 SSH 배포 → 헬스체크 → 실패 시 자동 롤백.

```
git push main
   │
   ├─ [ci]     ruff + pytest                        실패 시 여기서 중단
   ├─ [build]  docker build → ghcr.io/applepc24/mini_cdc:sha-abc1234
   └─ [deploy] scp → ssh → deploy.sh
                 ├ docker pull
                 ├ .env.prod 의 IMAGE= 한 줄 교체
                 ├ compose up -d --no-deps api relay consumer   ← 인프라는 안 건드림
                 ├ curl 127.0.0.1:8000/health  (최대 60초)
                 └ 실패하면 이전 IMAGE 로 되돌리고 exit 1
```

인프라(`db` / `kafka` / `zookeeper`)는 CD가 건드리지 않는다. 서버에 상주시킨다.

---

## 대상 서버 (실측)

| 항목 | 값 |
|---|---|
| OS / 계정 | Ubuntu 24.04 LTS / `junseok` |
| Docker | 29.5.3, Compose v5.1.4 |
| 기존 compose 위치 | `/home/junseok/mini-cdc/docker-compose.prod.yml` |
| compose 프로젝트명 | `mini-cdc` (볼륨 `mini-cdc_pgdata`) |
| 리버스 프록시 | **호스트 nginx** (`proxy_pass http://127.0.0.1:8000`) |
| 같은 서버의 다른 서비스 | `wordpress`(8080), `pubinsight`(3001) |

### ⚠️ 이 서버는 이 프로젝트 전용이 아니다

`wordpress`, `pubinsight` 가 같이 떠 있다. 그래서 배포 스크립트는

- `docker compose ... --no-deps api relay consumer` 로 **대상 3개만** 지정하고
- 전역 `docker image prune` 을 쓰지 않는다 (우리 저장소의 `sha-` 태그만 정리)

`docker compose down`, `docker system prune`, `docker stop $(docker ps -q)` 류를
이 서버에서 무심코 실행하면 다른 서비스가 같이 죽는다.

### ⚠️ compose 프로젝트 이름이 곧 볼륨 이름이다

Compose는 기본적으로 **디렉터리 이름**을 프로젝트명으로 삼고 볼륨 앞에 붙인다.
배포 디렉터리를 바꾸면 `mini-cdc_pgdata` 대신 `<새디렉터리>_pgdata` 를 찾게 되고,
없으면 **새 빈 볼륨을 만들어 "DB가 텅 빈" 상태로 뜬다.** (데이터가 지워지진 않지만 원인 찾기가 어렵다)

→ `docker-compose.prod.yml` 최상단에 `name: mini-cdc` 를 명시해 고정했다.
   이 줄을 지우지 말 것.

---

## 1. 서버 최초 셋업 (한 번만)

배포 산출물은 git 클론(`/home/junseok/mini-cdc`)과 분리한다.
`name: mini-cdc` 로 프로젝트명을 고정했으므로 디렉터리가 달라도 기존 볼륨을 그대로 쓴다.

```bash
sudo mkdir -p /opt/stockops && sudo chown junseok:junseok /opt/stockops
cd /opt/stockops

cp /home/junseok/mini-cdc/.env .env.prod   # 기존 값을 출발점으로
chmod 600 .env.prod                        # 시크릿이므로 권한을 좁힌다
```

`docker-compose.prod.yml`, `deploy.sh`, `docker/initdb/` 는 **CD가 매 배포마다 올린다.**
최초 1회는 첫 배포가 알아서 올려주므로 수동 복사가 필요 없다.

> 기존 `/home/junseok/mini-cdc` 를 그대로 쓰고 싶다면 GitHub Variables 의
> `APP_DIR` 을 `/home/junseok/mini-cdc` 로 지정한다. 단 CD가 git 추적 파일인
> `docker-compose.prod.yml` 을 덮어써서 작업 트리가 더러워진다.

---

## 2. `.env.prod` 채우기

`.env.prod.example` 을 기준으로 채운다. 서버의 기존 `.env` 에는 5개
(`OPENAI_API_KEY`, `WEB_BASE_URL`, `SLACK_REDIRECT_URL`, `SLACK_CLIENT_ID`,
`SLACK_CLIENT_SECRET`) 뿐이므로 나머지를 새로 적어야 한다.

### 지금까지 이미지에 구워진 `.env` 로 동작하던 값들

`.dockerignore` 가 `.env` 를 제외하도록 바뀌었다(그전엔 `COPY . /app` 으로
OpenAI 키·Slack 시크릿이 이미지에 그대로 들어갔다).
기존 compose가 주입하지 않던 아래 4개는 **`.env.prod` 에 없으면 Slack 연동이 조용히 죽는다.**

```
WEB_BASE_URL  SLACK_REDIRECT_URL  SLACK_CLIENT_ID  SLACK_CLIENT_SECRET
```

### `POSTGRES_PASSWORD` 는 `postgres` 그대로 둘 것

`POSTGRES_PASSWORD` 는 **데이터 디렉터리가 비어 있을 때(최초 1회) 계정을 만들 때만**
사용된다. 볼륨 `mini-cdc_pgdata` 가 이미 있으므로 여기서 바꿔도 DB 안의 비밀번호는
그대로고, `DATABASE_URL` 만 새 값이 되어 인증 실패가 난다.

바꾸려면 DB에서 먼저 변경한 뒤 `.env.prod` 를 맞춘다:

```bash
docker exec -it mini-cdc-postgres psql -U postgres -c "ALTER USER postgres PASSWORD '새비밀번호';"
# 그 다음 .env.prod 의 POSTGRES_PASSWORD 와 DATABASE_URL 을 동시에 수정
```

### `JWT_SECRET_KEY` 는 반드시 교체할 것

기존 `docker-compose.prod.yml` 에 `"dev-secret"` 이 하드코딩된 채 public 저장소에
공개돼 있었다. 누구든 임의의 `owner_id` 로 유효한 토큰을 위조할 수 있는 상태다.

```bash
openssl rand -hex 32
```

교체하면 기존 발급 토큰이 전부 무효화되므로 사용자는 재로그인이 필요하다.

---

## 3. GitHub 설정

### Secrets (Settings → Secrets and variables → Actions → Secrets)

| 이름 | 값 |
|---|---|
| `SSH_HOST` | `api.stockops.site` |
| `SSH_USER` | `junseok` |
| `SSH_KEY` | 배포 전용 **개인키 전문** (`-----BEGIN …` 부터 끝까지) |
| `SSH_KNOWN_HOSTS` | 아래 `ssh-keyscan` 출력 |

`GITHUB_TOKEN` 은 **만들지 않는다.** GitHub가 job마다 자동 발급하고 job 종료 시 만료된다.
GHCR 푸시(러너)와 풀(서버) 모두 이걸로 처리하므로 장기 PAT를 서버에 두지 않아도 된다.

### Variables (같은 화면 → Variables 탭) — 선택

| 이름 | 기본값 |
|---|---|
| `APP_DIR` | `/opt/stockops` |
| `SSH_PORT` | `22` |

### 배포 전용 SSH 키 만들기

개인 노트북 키를 재사용하지 말고 배포 전용 키를 따로 만든다.
유출 시 그 키만 폐기하면 되고, 사람이 쓰는 키와 감사 로그가 섞이지 않는다.

```bash
# 로컬에서
ssh-keygen -t ed25519 -f ~/.ssh/stockops_deploy -N "" -C "github-actions-deploy"

# 공개키를 서버에 등록
ssh-copy-id -i ~/.ssh/stockops_deploy.pub junseok@api.stockops.site

cat ~/.ssh/stockops_deploy            # → SSH_KEY 시크릿
ssh-keyscan -p 22 api.stockops.site   # → SSH_KNOWN_HOSTS 시크릿
```

> `known_hosts` 를 시크릿으로 고정하는 이유: 워크플로에서 `ssh-keyscan` 을 즉석 실행하면
> 그때 응답한 서버를 검증 없이 신뢰하게 된다(중간자 공격에 무방비).

---

## 4. 배포 / 롤백

```bash
git push origin main     # 끝. Actions 탭에서 확인.
```

**롤백 (GitHub UI)**: Actions → CD → `Run workflow` → `image_tag` 에 `sha-abc1234` 입력
→ CI/빌드를 건너뛰고 GHCR의 기존 이미지를 그대로 배포한다.

**롤백 (서버에서 직접)**:

```bash
cd /opt/stockops && ./deploy.sh ghcr.io/applepc24/mini_cdc:sha-abc1234
```

사용 가능한 태그는 GitHub 저장소 → Packages 에서 확인한다.

---

## 5. 첫 배포 시 바뀌는 것

| | 이전 | 이후 |
|---|---|---|
| 이미지 | 서버에서 `docker build` (`mini-cdc-api` 등 로컬 태그) | GHCR pull (`ghcr.io/…:sha-…`) |
| api 포트 | `0.0.0.0:8000` — **집 안 네트워크 전체에 노출** | `127.0.0.1:8000` — nginx만 접근 |
| 시크릿 | 이미지에 구워진 `.env` + compose 하드코딩 | 실행 시 `.env.prod` 주입 |
| 세 서비스 이미지 | 각각 별도 태그 | 동일 이미지 + `command` 로 분기 |

api 포트가 `127.0.0.1` 로 바뀌어도 nginx가 `proxy_pass http://127.0.0.1:8000` 이므로
외부 동작은 동일하다.

---

## 6. 트러블슈팅

### 배포가 롤백되며 실패할 때

`deploy.sh` 가 실패 시 `docker compose logs --tail 50 api` 를 출력하므로
Actions 로그에서 바로 원인을 볼 수 있다. 대부분 `.env.prod` 키 누락이다.

```bash
cd /opt/stockops
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api
```

### 헬스체크는 통과하는데 외부에서 502

`deploy.sh` 는 `127.0.0.1:8000` 만 본다. 워크플로의 `Verify from outside` 스텝이
`https://api.stockops.site/health` 를 확인하므로, 여기서만 실패하면
앱이 아니라 **nginx / TLS** 문제다.

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### Slack 연동만 안 될 때

이미지에서 `.env` 가 빠졌으므로 `.env.prod` 에 `SLACK_CLIENT_ID` /
`SLACK_CLIENT_SECRET` / `SLACK_REDIRECT_URL` / `WEB_BASE_URL` 이 있는지 확인한다.

```bash
docker exec mini-cdc-api env | grep -E 'SLACK|WEB_BASE' | sed 's/=.*/=***/'
```

### DB가 비어 보일 때

compose 프로젝트명이 바뀌어 새 볼륨을 본 것이다. 확인:

```bash
docker volume ls | grep pgdata          # mini-cdc_pgdata 가 정상
docker inspect mini-cdc-api --format '{{index .Config.Labels "com.docker.compose.project"}}'
```

`mini-cdc` 가 아니면 `docker-compose.prod.yml` 의 `name: mini-cdc` 가 지워진 것이다.
