<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-11-17 | Updated: 2026-11-17 -->

# 테스트

Node 내장 테스트와 임시 Postgres로 수집부터 분류, MCP, 브리핑, 라우팅까지 검증한다.

## 주요 파일

| 파일                                                | 역할                                                            |
| --------------------------------------------------- | --------------------------------------------------------------- |
| `run.ts`                                            | 임시 Postgres를 시작하고 `node --test`를 실행한 뒤 종료·정리    |
| `helpers.ts`                                        | 호출마다 별도 DB를 만들고 기본적으로 마이그레이션 적용          |
| `fake-slack.ts`                                     | 로컬 Slack API, 페이지 나눔, 채널 오류와 429 응답 모의          |
| `collector.test.ts`                                 | 수집 재개·중복·수정·삭제·접근 상실·보존 기간 검증               |
| `classify.test.ts`, `research.test.ts`              | 규칙 분류, 알림, webhook과 샘플 적재 검증                       |
| `mcp.test.ts`, `briefing.test.ts`, `server.test.ts` | MCP 인증·제출·비공개 처리, 브리핑과 healthz 검증                |
| `router.test.ts`, `jev.test.ts`                     | 라우터 모드, Jev 응답 검증·예산·사용량과 실패 시 규칙 대체 검증 |
| `policy.test.ts`, `config.test.ts`                  | 모델 전송 허용·마스킹과 설정 기본값 검증                        |
| `db.test.ts`, `migrations-lint.test.ts`             | 마이그레이션 적용·롤백·SQL selfcheck와 추가 전용 lint 검증      |
| `eval.test.ts`, `eval-router.test.ts`               | 평가 집계와 라벨이 붙은 예시의 정확도 기준 검증                 |

## 작업과 검증

- 전체 실행은 `npm test`, 파일 하나는 예를 들어 `npm test -- test/collector.test.ts`다. 둘 다 `run.ts`를 거친다.
- `run.ts`는 임시 디렉터리와 임의 포트의 Postgres를 사용하고 자식 프로세스의 `TEST_DATABASE_URL`을 덮어쓴다. 나머지 환경 변수는 상속한다. `testDb()`는 별도 이름의 DB를 만들며, 마이그레이션 자체를 검증할 때는 `testDb({ migrate: false })`를 쓴다.
- 수집 테스트는 `startFakeSlack()`과 `FAKE_TOKEN`을 사용하고, 테스트 후 서버와 DB 연결을 닫는다. Jev와 webhook은 `fetch`를 주입해 모의한다. Fastify는 주로 `app.inject()`를 쓰고, MCP SDK 호환성 테스트만 `127.0.0.1`의 임시 포트에 연결한다.
- 실제 데이터 노출 경계는 `policy.test.ts`와 `mcp.test.ts`의 허용·차단 및 canary 검사로 확인한다. `collector`, `research`, `router` SQL의 현재 스키마 호환성은 각 테스트의 `selfcheck`로 확인한다.
- `eval.test.ts`는 runtime 예시가 35개 이상이고 세 tier가 모두 예측되며 정확도가 0.8 이상인지 확인한다. `eval-router.test.ts`는 runtime·classify 정확도 각각 0.8 이상과 `analysis_skipped`가 0과 1 사이인지 확인한다.

## 의존 관계

- 내부: `src/`의 구현과 `migrations/` 스키마, `fixtures/` 샘플·평가 입력, `scripts/eval_router.ts`를 사용한다.
- 외부: `embedded-postgres`, `pg`, `fastify`, `@modelcontextprotocol/sdk`와 Node 내장 테스트·HTTP 도구를 사용한다. Slack, Jev, webhook은 로컬 모의 또는 주입된 응답을 사용한다.

<!-- MANUAL: 수동 추가 내용은 재생성 시 보존한다. -->
