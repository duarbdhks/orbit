<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-11-17 | Updated: 2026-11-17 -->

# src/db

Postgres에서 실행할 이름 붙은 SQL 문장을 기능별 `SQL` 객체로 보관한다.

## 주요 파일

| 파일           | 역할과 호출자                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| `collector.ts` | 채널·메시지 upsert, 스레드 대조, 수집 상태·보존 삭제. `src/collector.ts`가 사용                              |
| `research.ts`  | 분류·알림, 메시지 검색, 지식·근거·브리핑, 샘플 적재. `src/research.ts`, `src/mcp.ts`, `src/sample.ts`가 사용 |
| `router.ts`    | Jev 사용량·라우터 판단 기록과 샘플 채널 조회. `src/jev.ts`, `src/router.ts`가 사용                           |

## 작업과 검증

- 문장은 `SQL` 객체에 이름을 붙이고 값을 매개변수로 전달한다. 새 SQL 모듈을 추가하면 `src/sql.ts`에도 등록해 `selfcheck` 대상에 포함한다.
- `research.ts`의 분류 INSERT는 수집 중 삭제된 메시지를 건너뛰며, 새 `notify_now` 분류 중 최근 1시간 메시지만 알림으로 만든다. 근거·분석 완료와 브리핑 기록은 `src/mcp.ts`의 트랜잭션 경계를 함께 확인한다.
- 수집 SQL의 누락 메시지 삭제와 보존 삭제는 메시지를 참조하는 분류·알림·근거의 외래 키에도 영향을 준다. 근거 없는 지식 정리는 별도 쿼리다.
- 각 SQL 객체의 `selfcheck`는 `npm test -- test/collector.test.ts test/research.test.ts test/jev.test.ts`로 확인할 수 있다. 호출 동작이 바뀌면 해당 MCP·라우터 테스트도 확인한다.

## 의존 관계

- 테이블과 외래 키 정의는 [migrations/](../../migrations/AGENTS.md), 연결 및 `PREPARE` 검사는 `src/db.ts`, 전체 문장 목록은 `src/sql.ts`에 있다.
- SQL은 Postgres 문법을 사용하고 애플리케이션은 `pg`로 실행한다. 테스트는 임시 Postgres를 사용한다.

<!-- MANUAL: 수동 추가 내용은 재생성 시 보존한다. -->
