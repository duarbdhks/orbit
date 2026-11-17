<!-- Generated: 2026-11-17 | Updated: 2026-11-17 -->

# Orbit 개발 지침

Orbit은 QM 위에서 동작하는 Slack 개인 AI 비서다. QM은 `qm/`에서 버전 고정으로 실행하고 수정하지 않는다.

## 주요 파일

| 파일 | 역할 |
|---|---|
| `README.md` | 기능 소개와 운영 문서 진입점 |
| `package.json`, `package-lock.json` | 실행·검증 명령과 정확한 의존성 버전 |
| `.node-version`, `tsconfig.json`, `biome.json` | Node 버전, 타입 검사와 코드 스타일 |
| `.env.example` | 수집·분석·라우팅·유료 호출 설정 예시 |
| `Dockerfile`, `.dockerignore`, `compose.yaml` | Orbit 이미지와 API·collector·Postgres 컨테이너 구성 |
| `.gitignore`, `.gitleaks.toml` | 로컬 생성물 제외와 비밀값 검사 설정 |
| `BACKLOG.md` | 보류한 기능과 재검토 조건 |

## 하위 디렉터리

| 디렉터리 | 역할 |
|---|---|
| [src/](src/AGENTS.md) | 수집, 분류, MCP, 라우팅과 데이터 접근 |
| [migrations/](migrations/AGENTS.md) | 추가 방식의 Postgres 스키마 변경 |
| [test/](test/AGENTS.md) | 임시 Postgres와 모의 외부 서비스로 검증 |
| [fixtures/](fixtures/AGENTS.md) | 샘플 Slack 데이터와 분류·라우터 평가 입력 |
| [scripts/](scripts/AGENTS.md) | CI, 배포, 백업, QM 연결과 Mac 운영 도구 |
| [docs/](docs/AGENTS.md) | 구조, 로컬 실행, 데이터 정책, 복구와 검증 근거 |
| [.github/](.github/AGENTS.md) | GitHub Actions CI 구성 |
| `qm/` | 수정 제외 대상인 QM 배포 디렉터리. 통합 지점은 `docs/ARCHITECTURE.md` 참조 |

## 변경 경로와 검증

- HTTP·MCP 동작은 `src/server.ts`, `src/mcp.ts`에서 시작하고, SQL은 `src/sql.ts`가 `src/db/` 문장을 모은다.
- 수집은 `src/collector.ts`와 `src/slack.ts`, 분석은 `src/research.ts`, 실행 경로는 `src/router.ts`에서 찾는다.
- 동작 변경은 `npm run typecheck`, `npm run lint`, `npm test`로 검증한다. 운영 probe는 실제 서비스에 접근하므로 로컬 테스트와 구분한다.
- `scripts/ci_gate.sh [REF]`는 커밋된 트리의 임시 사본만 검사한다. 커밋하지 않은 변경의 검증은 직접 실행한다.

## 의존 관계

- QM은 대화·에이전트 실행을 맡고, Orbit API는 MCP·decision rule·webhook으로 연결한다. collector의 Slack User 토큰은 API와 분리한다.
- 런타임 외부 패키지는 `fastify`, `pg`, `zod`다. 테스트는 `embedded-postgres`와 MCP SDK를 사용한다.

<!-- MANUAL: 기존 실행·규칙 지침. 재생성 시 아래 내용을 보존한다. -->

## 실행

- Node `24.22.1`로 TypeScript를 직접 실행한다. 빌드 단계는 없다.
- `npm test`는 임시 Postgres를 띄우고 `test/*.test.ts`를 돌린다.
- 커밋 전 `scripts/ci_gate.sh`를 실행한다. CI의 `gate` 작업도 같은 스크립트다.

## 규칙

- 브라우저가 필요하면 `/ego-browser`를 쓴다.
- 의존성은 정확한 버전으로 고정한다. 몇 줄로 되는 일에 의존성을 더하지 않는다.
- 스키마 변경은 `migrations/`에 추가만 한다. `DROP`, `RENAME`, `ALTER TYPE`, `CONCURRENTLY`, 기본값 없는 `ADD COLUMN ... NOT NULL`은 lint가 막는다.
- SQL은 `src/db/`의 이름 붙은 문장으로 둔다. `selfcheck`가 전부 PREPARE 한다.
- Slack 응답, Jev 응답, AI 제출 결과는 경계에서 zod로 검증한다. 안쪽 코드는 타입을 믿는다.
- 모델로 나가는 데이터는 `forModel` 하나만 만든다.
- 로그에 Slack 메시지 원문과 토큰을 남기지 않는다.
- 유료 호출은 기본값에서 0건이어야 한다. Jev 요청은 켜짐, 예산, 키 세 조건이 모두 맞을 때만 나간다.
- 테스트는 실제 Slack, Codex, OpenRouter에 접근하지 않는다.
