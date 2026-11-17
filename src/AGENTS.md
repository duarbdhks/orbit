<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-11-17 | Updated: 2026-11-17 -->

# src

Slack 메시지를 수집·분류하고, QM에 MCP 도구와 실행 경로 판단을 제공하는 TypeScript 소스다.

## 주요 파일

| 파일 | 역할 |
|---|---|
| `main.ts`, `server.ts` | 명령 진입점과 Fastify 서버 구성 |
| `slack.ts`, `collector.ts` | Slack API 응답 검증·직렬 요청과 수집·대조·보존 삭제 |
| `classify.ts`, `research.ts` | 규칙 분류와 분류 결과 저장·긴급 알림 webhook 발송 |
| `policy.ts` | 모델 전송 허용 채널, 메시지 가림과 permalink |
| `mcp.ts` | QM용 JSON-RPC 도구, 인증과 분석 결과 저장 |
| `router.ts`, `jev.ts` | QM 실행 경로와 메시지 route 판단, Jev 호출·예산 기록 |
| `briefing.ts` | 지식 항목을 브리핑 문자열로 구성 |
| `db.ts`, `sql.ts` | Postgres 연결·마이그레이션·selfcheck와 SQL 문장 수집 |
| `migrations-lint.ts` | 추가 방식 마이그레이션 검사 |
| `sample.ts`, `eval.ts` | 샘플 데이터 적재와 예측 평가 지표 계산 |
| `config.ts`, `types.ts` | 환경 설정 검증과 공통 도메인 타입 |

## 하위 디렉터리

| 디렉터리 | 역할 |
|---|---|
| [db/](db/AGENTS.md) | 수집·분석·라우터별 이름 붙은 SQL 문장 |

## 작업할 때

- `main.ts`의 `collector`는 수집 tick을, `api`는 서버와 분류 pass를 반복한다. 수집 대상은 `ORBIT_COLLECT_CHANNELS`로 제한한다.
- 수집기는 답글을 부모보다 먼저 저장해 중간 실패 후에도 변경된 스레드를 다시 찾는다. 대조 시 사라진 메시지와 답글을 삭제하므로 저장 순서와 삭제 범위를 함께 확인한다.
- 분류 pass는 규칙 결과를 저장하고, 최근 긴급 메시지의 알림은 URL과 서명 키가 모두 있을 때 QM에 HMAC 서명으로 전송한다. webhook에는 알림 ID와 permalink가 담긴다.
- `/mcp`는 API 토큰을 검사하며 `tools/call`은 `x-qm-actor`도 검사한다. `submit_analysis`와 `mark_briefed`는 각각 트랜잭션으로 저장한다.
- MCP 메시지 응답은 `policy.ts`의 `forModel`을 거친다. 분류용 Jev의 `createAdvise`는 `modelAllowed` 확인 후 원문을 직접 전달하며 `forModel`을 거치지 않는다. 모델 전송 경계를 변경할 때는 이 경로와 루트의 단일 `forModel` 지침을 함께 확인한다. 실제 채널은 분석 활성화와 채널 허용 설정이 모두 필요하다.
- 라우터는 `off`·`shadow`·`active` 모드에 따라 규칙과 Jev 결과를 사용한다. Jev 응답의 선택지와 확률 검증, 실패 시 규칙 결과를 유지한다.

## 검증과 의존 관계

- 변경 영역의 테스트를 고를 때는 예를 들어 `npm test -- test/collector.test.ts`를 사용한다. `test/run.ts`가 임시 Postgres를 띄우고 선택한 테스트에 `TEST_DATABASE_URL`을 전달한다.
- 스키마는 [migrations/](../migrations/AGENTS.md), 샘플 입력은 [fixtures/](../fixtures/AGENTS.md), 테스트와 모의 Slack은 [test/](../test/AGENTS.md)에 있다. QM 연동 구조는 [ARCHITECTURE.md](../docs/ARCHITECTURE.md)를 참조한다.
- 외부 런타임 의존성은 `fastify`, `pg`, `zod`이며, 경로에 따라 Slack API, OpenRouter Jev, QM webhook과 통신한다.

<!-- MANUAL: 수동 추가 내용은 재생성 시 보존한다. -->
