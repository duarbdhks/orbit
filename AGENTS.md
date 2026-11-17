# Orbit 개발 지침

Orbit은 QM 위에서 동작하는 Slack 개인 AI 비서다. QM은 `qm/`에서 버전 고정으로 실행하고 수정하지 않는다.

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
