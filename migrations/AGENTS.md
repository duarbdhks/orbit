<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-11-17 | Updated: 2026-11-17 -->

# migrations

Orbit의 Postgres 스키마를 순서대로 적용하는 SQL 마이그레이션이다.

## 주요 파일

| 파일 | 역할 |
|---|---|
| `001_init.sql` | `pg_trgm` 확장, 채널·메시지·수집 상태, 분류·지식·근거·브리핑·알림, 수집 통계·라우터 판단·Jev 사용량 테이블과 인덱스 정의 |

## 작업과 검증

- 다음 번호의 `.sql` 파일을 추가한다. `src/db.ts`는 파일명을 정렬하고 `schema_migrations`에 기록된 이름을 제외해 미적용 파일을 찾는다. 이미 적용된 파일을 수정해도 다시 실행되지 않는다.
- 미적용 파일 전체는 advisory transaction lock을 잡은 한 트랜잭션에서 적용되며 하나라도 실패하면 롤백된다. 추가 방식 제약은 `src/migrations-lint.ts`와 해당 테스트가 검사한다.
- `test/migrations-lint.test.ts`는 이 디렉터리의 모든 파일을 확장자 구분 없이 검사하므로 문서에도 lint 금지 구문을 쓰면 실패할 수 있다.
- 메시지의 기본 키는 `(channel_id, ts)`이며 분류·알림·근거는 메시지 삭제에 연쇄 반응한다. 스키마 변경 시 `src/db/` 쿼리와 이 관계를 함께 확인한다.
- `test/db.test.ts`는 초기 대기·적용 파일 목록을 현재 `001_init.sql` 하나로 명시하므로 새 마이그레이션 추가 시 기대값을 갱신한다. `npm test -- test/db.test.ts test/migrations-lint.test.ts`로 적용·롤백과 lint를 확인하고, 관련 쿼리의 selfcheck도 실행한다.

## 의존 관계

- 적용과 SQL `PREPARE` 검사는 `src/db.ts`, 애플리케이션 쿼리는 [src/db/](../src/db/AGENTS.md)에 있다. 배포 시 구버전 쿼리 호환성 검사는 `docs/ARCHITECTURE.md`와 `scripts/deploy.sh`를 참조한다.
- Postgres와 `pg_trgm` 확장이 필요하며 테스트는 `test/run.ts`의 임시 Postgres를 사용한다.

<!-- MANUAL: 수동 추가 내용은 재생성 시 보존한다. -->
