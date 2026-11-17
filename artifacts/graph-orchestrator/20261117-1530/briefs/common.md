# Orbit 워커 공통 지시

## 목표

추가 인프라 비용 없이 로컬 Mac에서 계속 도는 Slack 개인 AI 비서 Orbit의 첫 작동 버전을 만든다. Orbit은 QM(대화 엔진) 옆에서 Slack 메시지를 수집, 분류, 분석해 DM 브리핑의 재료를 제공한다. 너는 그중 모듈 하나를 맡는다.

## 먼저 읽을 것

네 worktree 안에서 다음을 전부 읽는다: `AGENTS.md`, `migrations/001_init.sql`, `src/types.ts`, `src/config.ts`, `src/db.ts`, `src/server.ts`, `test/helpers.ts`, `test/db.test.ts`.

## 환경

- 셸마다 먼저 실행: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.22.1`
- 처음 한 번 `npm ci`.
- 검사: `npm run typecheck`, `npm run lint` (`npm run format`으로 고친다), `npm test` (임시 Postgres를 띄운다. 파일 하나만: `npm test -- test/x.test.ts`).
- Node가 TypeScript를 직접 실행한다. enum, namespace, 생성자 매개변수 속성은 쓸 수 없다. import 경로는 `.ts`까지 쓴다.

## 규칙

- 지시서의 "소유 파일"만 만들거나 고친다. 다른 파일(`package.json`, `src/config.ts`, `src/main.ts`, `src/server.ts`, `src/sql.ts`, `src/types.ts`, `migrations/`)은 건드리지 않는다. 부족한 것이 있으면 item 파일의 `findings`에 적는다.
- 의존성을 추가하지 않는다. 쓸 수 있는 것은 fastify, pg, zod, Node 표준 라이브러리다. HTTP 호출은 전역 `fetch`를 쓴다.
- commit, push, 브랜치 변경을 하지 않는다. 네 worktree 밖을 쓰지 않는다. 실제 Slack, OpenRouter, QM에 접속하지 않는다.
- 가장 작은 코드로 끝낸다. 요청받지 않은 옵션, 추상화, 설정을 만들지 않는다. 한 번만 쓰는 래퍼를 만들지 않는다.
- SQL은 `src/db/<모듈>.ts`에 `export const SQL = { 이름: "문장" } as const`로 둔다. 모든 문장은 `PREPARE x AS <문장>`이 되어야 한다(`selfcheck`가 검사한다). 필요하면 `$1::text[]`처럼 타입을 적는다. 테스트 하나가 `selfcheck(db, SQL)`을 호출하게 한다.
- 외부 입력(Slack 응답, HTTP 요청, 모델 제출물, Jev 응답)은 경계에서 zod로 검증한다. 안쪽 함수는 타입을 믿고 다시 검사하지 않는다. 판단 로직은 DB와 네트워크가 없는 순수 함수로 둔다.
- 로그와 오류 메시지에 Slack 메시지 원문, 토큰, 키를 넣지 않는다.
- 주석은 코드가 보여 주지 못하는 이유만 한국어 한 줄로 쓴다. 테스트 이름은 동작을 설명하는 한국어 문장이다.
- 테스트는 사용자가 관찰하는 동작을 검사한다(반환값, DB에 남은 행, 밖으로 나간 요청). 내부 호출 순서를 검사하지 않는다.

## 끝낼 때

1. `npm run typecheck && npm run lint && npm test`가 모두 통과해야 한다.
2. 지시서가 정한 경로에 item 파일(JSON)을 쓴다:
   `{"item_id": "<모듈>", "status": "ok|failed|blocked", "files": ["<바꾼 파일>"], "findings": ["<통합할 때 알아야 할 것>"], "evidence": [{"source": "<파일:줄 또는 명령>", "claim": "<확인한 것>"}], "confidence": "high|medium|low", "errors": []}`
3. 마지막 답은 `item_id`, `status`, `artifact_ref`, 3줄 이내 요약만 쓴다.
