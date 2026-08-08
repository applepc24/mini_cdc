# Backlog

알려진 과제를 우선순위대로 추적한다. 최종 갱신: 2026-08-08.

> 보안 관련 미해결 항목은 이 문서에 적지 않는다. 저장소가 public 이라
> 수정 전 취약점을 기록하면 공개하는 셈이 되기 때문이다. 수정 후 완료 항목으로 옮긴다.

---

## P1 — 다음에 할 것

### DLQ 재처리 파이프라인
`consumer_dlq` 에 쌓인 이벤트를 다시 적용하는 도구. 기록(2026-08-08 완료)만 있고
읽는 쪽이 없다. 지금은 유실이 나면 데이터로 남기만 하고 복구는 수동이다.

- 대상 조회 → 선행 이벤트 존재 확인 → 재적용 → 성공 시 DLQ 행 마킹
- `readmodel_apply_log` 에 도장이 없으므로 재적용 자체는 안전하다
- 단순 재시도로는 안 되는 경우(선행 upsert 자체가 유실)를 어떻게 다룰지 결정 필요

### 자동 롤백 검증
`scripts/deploy.sh` 의 롤백 경로는 **한 번도 실제로 걸려본 적이 없다.**
헬스체크 결함도 실제 장애를 겪고 나서야 발견했으므로, 일부러 깨진 이미지를
배포해 롤백이 동작하는지 확인할 가치가 있다.
현재 롤백 대상 태그가 GHCR 에 있어 안전하게 테스트 가능하다.

---

## P2 — 통합 테스트 (가장 큰 공백)

CI 는 ruff + 스모크 테스트 3개뿐이다. README 가 내세우는 것 중 **검증된 게 없다.**

| 주장 | 테스트 |
|---|---|
| Outbox 원자성 (도메인 변경과 이벤트를 동일 트랜잭션 커밋) | ❌ |
| Consumer 멱등성 (같은 이벤트 2회 소비) | ❌ |
| 순서 역전 방어 (`should_skip_as_duplicate`) | ❌ |
| Relay `SKIP LOCKED` 중복 발행 방지 (인스턴스 2개 동시 기동) | ❌ |
| 멀티테넌시 격리 | ❌ |
| **0건 반영 시 DLQ 로 빠지는지** (2026-08-08 추가된 경로) | ❌ |

이 프로젝트의 버그는 파이썬 로직이 아니라 **SQL·트랜잭션·동시성·이벤트 순서**에 산다.
그래서 테스트 피라미드가 뒤집혀 통합 테스트가 가장 두꺼워야 정상이다.

실제로 P0-b(0건 반영을 성공으로 처리)는 위 테스트 중 하나만 있었어도 즉시 잡혔을
버그였다. 이게 통합 테스트가 필요한 이유의 실증이다.

---

## P3 — 구조

### import 시점 부작용 제거
- `app/db.py:5` — `engine = create_engine(DATABASE_URL, ...)`
- `app/services/embedding_service.py:5` — `client = OpenAI(api_key=...)`

모듈을 import 하는 것만으로 외부 자격증명을 요구한다. 환경변수가 없으면
앱을 import 조차 할 수 없어 테스트가 어렵다.
현재 `tests/conftest.py` 의 더미 값은 **증상 우회지 원인 수정이 아니다.**
팩토리나 의존성 주입으로 지연 생성하는 편이 낫다.

### 스키마 드리프트
`product_search.last_outbox_id` 와 `readmodel_apply_log` 가 `consumer/main.py` 의
원시 SQL 에만 존재하고 `app/models.py` 에 없다.
`scripts/init_db.py`(`Base.metadata.create_all`)로는 생성되지 않으므로
**새 환경에서는 멱등성 장치가 통째로 없는 상태로 뜬다.**

- 모델에 정의하거나 Alembic 도입
- `ConsumerDlq`(2026-08-08)는 이 패턴을 반복하지 않으려고 모델로 정의했다

---

## P4 — CI/CD 개선

### `cd.yml` 에 `paths-ignore`
현재 `main` 에 문서만 푸시해도 전체 빌드 + 운영 재배포가 돈다.

```yaml
on:
  push:
    branches: [main]
    paths-ignore: ['**.md', 'docs/**', '.gitignore']
```

문서와 코드를 같이 바꾼 커밋은 정상 배포된다.

### SSH 연결 5회 → 1회
`deploy` job 이 짧은 시간에 SSH 를 5번 연다(ssh mkdir + scp ×2 + login + deploy).
`ControlMaster` 멀티플렉싱으로 하나의 TCP 연결을 재사용하면 배포가 빨라지고,
서버 측 연결 제한에 걸릴 확률도 줄어든다.

### fail2ban (선택)
반복 공격 IP 자동 차단. 비밀번호 인증을 껐으므로(2026-08-08) 급하지 않지만,
`MaxStartups` 슬롯 압박을 더 줄일 수 있다.

---

## 완료

### 2026-08-08
- **CI/CD 파이프라인 구축** — `main` 푸시 → ruff/pytest → GHCR 빌드 → 홈서버 SSH 배포
  → 헬스체크 + 워커 검사 → 실패 시 자동 롤백. 상세는 `docs/DEPLOY.md`
- **Consumer 의 조용한 이벤트 유실 수정 (P0-b)** — 0건 반영을 성공으로 보고
  `readmodel_apply_log` 에 기록해 영구 스킵되던 문제. `rowcount` 확인 후
  `consumer_dlq` 로 격리
- **시크릿 유출 경로 차단** — `.dockerignore` 에 `.env` 누락으로 OpenAI 키·Slack
  시크릿이 이미지 레이어에 구워지고 있었다
- **`JWT_SECRET_KEY` 교체** — public 저장소에 `"dev-secret"` 이 하드코딩돼 있었다
- **`kafka-python` 버전 고정** — 무고정 git 의존성이 2.3.0 → 3.1.0.dev 로 튀며
  relay 가 죽었다
- **SSH 하드닝** — 비밀번호 인증 차단, `LoginGraceTime` 120→20초, 개인 키 등록.
  시간당 220건의 무차별 대입을 받고 있었고, 부수적으로 배포가 간헐 실패하고 있었다
- **api 포트 바인딩** — `0.0.0.0:8000` → `127.0.0.1:8000` (LAN 노출 차단)
