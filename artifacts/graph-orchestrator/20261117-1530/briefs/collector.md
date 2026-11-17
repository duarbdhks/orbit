# 모듈: collector (Slack 수집기)

공통 지시는 `briefs/common.md`다. 먼저 읽는다.

- worktree: `/Users/yeumgw/develop/orbit-wt/collector`
- item 파일: `/Users/yeumgw/develop/orbit/artifacts/graph-orchestrator/20261117-1530/items/collector.json`
- 소유 파일: `src/slack.ts`, `src/collector.ts`, `src/db/collector.ts`, `test/fake-slack.ts`, `test/collector.test.ts`

## 하는 일

읽기 전용 Slack User 토큰으로 허용된 채널의 메시지를 Postgres에 멱등하게 수집한다. 테이블은 `channels`, `messages`, `sync_state`, `collector_hourly`다.

## 인터페이스 (이 이름과 모양을 지킨다. main이 이것을 부른다)

```ts
// src/slack.ts
export interface Slack {
  list(): Promise<SlackChannel[]>;                                   // conversations.list, 공개+비공개, 보관 제외, 전 페이지
  history(channel: string, oldest: string, latest: string, limit: number): Promise<SlackMessage[]>; // 구간 전체, 전 페이지
  historyPage(channel: string, latest: string, limit: number): Promise<SlackMessage[]>;             // latest 이전 한 페이지
  replies(channel: string, threadTs: string): Promise<SlackMessage[]>;                              // 부모 제외 답글 전부
  userName(userId: string): Promise<string | null>;                  // users.info, 프로세스 내 캐시
  takeStats(): { apiCalls: number; rateLimited: number; maxQueueDepth: number }; // 읽고 0으로 되돌린다
}
export function createSlack(options: { token: string; baseUrl: string }): Slack;

// src/collector.ts
export function createCollector(db: Db, slack: Slack, config: Config): { tick(now: Date): Promise<void> };
```

## 동작

- Slack 호출은 전역 큐 하나로 직렬 실행한다. 429면 `Retry-After` 초만큼 기다렸다가 같은 요청을 다시 보내고 `rateLimited`를 올린다. Slack이 `ok: false`를 주면 `error` 코드를 담은 오류를 던진다. 요청은 `POST {baseUrl}/{method}`, `Authorization: Bearer`, form 본문이다.
- `ORBIT_COLLECT_CHANNELS`가 비어 있으면 `tick`은 Slack을 한 번도 부르지 않는다.
- 발견: 6시간마다 `list()`로 보이는 채널을 `channels`에 upsert 한다(이름, 종류, 가입 여부). 수집은 허용 목록에 있는 채널만 한다.
- 채널 동기화는 구간 하나(`sync_state.covered_from`, `covered_until`)를 넓히는 일이다.
  - 증분: `oldest = min(covered_until, now - 24시간)`부터 `now`까지 읽어 upsert 하고, 그 구간에서 Slack에 없는 최상위 행을 지운 뒤 `covered_until = now`로 둔다. 오래 꺼져 있다 켜져도 같은 식이 빈 구간을 메운다.
  - 스레드: 부모의 `latest_reply`나 `reply_count`가 저장값과 다르면 `replies()`로 답글을 upsert 하고 Slack에 없는 답글 행을 지운다.
  - 과거 수집: `covered_from`이 `now - ORBIT_BACKFILL_DAYS`보다 뒤면 tick마다 채널당 한 페이지(200건)를 `historyPage`로 읽고 `covered_from`을 그 페이지의 가장 오래된 시각으로 옮긴다. 더 없으면 목표 시각으로 둔다. 중단돼도 다음 tick이 이어 간다.
  - 대조: 하루 한 번 최근 72시간을, 주 한 번 보존 구간 전체를 다시 읽어 수정과 삭제를 반영한다. 이때는 구간 안 모든 스레드의 답글을 다시 읽는다. 증분과 같은 함수에 구간과 깊이만 바꿔 쓴다.
- upsert는 `(channel_id, ts)` 충돌 시 `text`, `edited_ts`, `reply_count`, `latest_reply`, `user_name`만 갱신한다. `ingested_at`과 `source`는 처음 값 그대로 둔다. `source`는 `backfill`, `incremental`, `reconcile` 중 하나다. `posted_at`은 `ts`에서 계산한다. 본문 없는 시스템 메시지(`subtype`이 `channel_join` 등)는 저장하지 않는다.
- 접근 상실: 허용 채널에서 Slack이 `not_in_channel`이나 `channel_not_found`를 주거나, 발견 결과에서 사라지면 `access_state = 'lost'`, `access_lost_at = now`로 두고 그 채널 수집을 멈춘다. 7일이 지나면 그 채널의 `messages`와 `sync_state`를 지우고 `purged`로 둔다. 채널 하나의 오류는 `sync_state.last_error`에 코드만 남기고 다른 채널을 계속한다.
- 보존: 하루 한 번 `ORBIT_RETENTION_DAYS`보다 오래된 `messages`를 지우고, 근거(`knowledge_evidence`)가 하나도 없는 `knowledge_items`를 지운다. `is_sample` 채널은 건드리지 않는다.
- 지표: tick 끝에 `takeStats()`를 그 시각의 `collector_hourly` 행에 더한다(`max_queue_depth`는 최댓값).
- 주기(6시간, 하루, 주)는 프로세스 메모리의 마지막 실행 시각으로 판단한다. 재시작하면 한 번 더 도는 것은 괜찮다(전부 멱등).

## 테스트 (가짜 Slack HTTP 서버 `test/fake-slack.ts`를 `node:http`로 만들어 쓴다)

- tick을 두 번 돌려도 `messages` 행이 같다.
- 과거 수집이 중간에 끊겨도 이어서 목표 시각까지 채운다.
- `now`가 3일 건너뛰어도 빈 구간의 메시지가 들어온다.
- 수정된 본문이 반영되고, 삭제된 메시지와 답글이 사라진다.
- 답글이 `thread_ts`로 부모에 묶인다.
- 429를 주입하면 재시도해 성공하고 `collector_hourly.rate_limited`가 오른다.
- 허용 목록이 비면 가짜 서버가 요청을 하나도 받지 않는다.
- 접근을 잃은 채널은 `lost`가 되고 7일 뒤 지워진다. 보존 기간이 지난 메시지가 지워진다.
- `selfcheck(db, SQL)`이 통과한다.
