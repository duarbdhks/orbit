import assert from "node:assert/strict";
import { test } from "node:test";
import { createCollector } from "../src/collector.ts";
import { loadConfig } from "../src/config.ts";
import { SQL } from "../src/db/collector.ts";
import { type Db, selfcheck } from "../src/db.ts";
import { createSlack } from "../src/slack.ts";
import { FAKE_TOKEN, startFakeSlack } from "./fake-slack.ts";
import { testDb } from "./helpers.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 1);
const at = (ms: number) => new Date(ms);
const ts = (ms: number) => (ms / 1000).toFixed(6);
const hoursAgo = (h: number) => ts(T0 - h * HOUR);

async function setup(env: Record<string, string> = {}) {
  const { db, url } = await testDb();
  const fake = await startFakeSlack();
  fake.channels.push({ id: "C1", name: "general", is_private: false, is_member: true });
  const config = loadConfig({ DATABASE_URL: url, ORBIT_COLLECT_CHANNELS: "C1", ...env });
  // 새 collector는 주기 기억이 없는, 다시 시작한 프로세스와 같다.
  const start = () => createCollector(db, createSlack({ token: FAKE_TOKEN, baseUrl: fake.url }), config);
  const close = async () => {
    await fake.close();
    await db.end();
  };
  return { db, fake, start, collector: start(), close };
}

const rows = async (db: Db, sql = "SELECT * FROM messages ORDER BY channel_id, ts") =>
  (await db.query(sql)).rows;

test("tick을 두 번 돌려도 messages 행이 같다", async (t) => {
  const s = await setup();
  t.after(s.close);
  s.fake.add("C1", { ts: ts(T0 - 2 * HOUR), text: "배포 일정 공유", user: "U1" });
  s.fake.add("C1", { ts: ts(T0 - HOUR), text: "확인했습니다", user: "U1", thread_ts: ts(T0 - 2 * HOUR) });
  s.fake.add("C1", { ts: ts(T0 - 30 * HOUR), text: "어제 회의록", user: "U2" });
  await s.collector.tick(at(T0));
  const first = await rows(s.db);
  assert.equal(first.length, 3);
  await s.collector.tick(at(T0 + MINUTE));
  assert.deepEqual(await rows(s.db), first);
});

test("과거 수집이 중간에 끊겨도 이어서 목표 시각까지 채운다", async (t) => {
  const s = await setup({ ORBIT_BACKFILL_DAYS: "10" });
  t.after(s.close);
  for (let d = 1; d <= 12; d++)
    s.fake.add("C1", { ts: ts(T0 - d * DAY + HOUR), text: `${d}일 전`, user: "U1" });
  await s.collector.tick(at(T0));
  s.fake.errors.set("C1", "internal_error");
  await s.collector.tick(at(T0 + MINUTE));
  assert.deepEqual(await rows(s.db, "SELECT last_error FROM sync_state"), [{ last_error: "internal_error" }]);
  s.fake.errors.clear();
  const end = T0 + 10 * MINUTE;
  for (let now = T0 + 2 * MINUTE; now <= end; now += MINUTE) await s.start().tick(at(now));

  const target = end - 10 * DAY;
  const stored = new Set((await rows(s.db)).map((r) => r.ts));
  const wanted = s.fake.messages.filter((m) => Number(m.ts) * 1000 >= target);
  assert.equal(wanted.length, 10);
  for (const m of wanted) assert.ok(stored.has(m.ts), m.text);
  const [state] = await rows(s.db, "SELECT covered_from, last_error FROM sync_state");
  assert.ok(state.covered_from.getTime() <= target);
  assert.equal(state.last_error, null);
});

test("now가 3일 넘게 건너뛰어도 빈 구간의 메시지가 들어온다", async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.collector.tick(at(T0));
  const missed = [T0 + 6 * HOUR, T0 + 2 * DAY, T0 + 3 * DAY + 6 * HOUR].map(ts);
  for (const m of missed) s.fake.add("C1", { ts: m, text: "꺼져 있던 동안 온 메시지", user: "U1" });
  await s.collector.tick(at(T0 + 3 * DAY + 12 * HOUR));
  assert.deepEqual(
    (await rows(s.db)).map((r) => r.ts),
    missed,
  );
});

test("수정된 본문이 반영되고 삭제된 메시지와 답글이 사라진다", async (t) => {
  const s = await setup();
  t.after(s.close);
  const parent = hoursAgo(3);
  const gone = hoursAgo(2);
  const reply = hoursAgo(1);
  const deleted = hoursAgo(10);
  const old = hoursAgo(40);
  const oldReply = hoursAgo(39);
  s.fake.add("C1", { ts: parent, text: "원래 본문", user: "U1" });
  s.fake.add("C1", { ts: gone, text: "지울 답글", user: "U1", thread_ts: parent });
  s.fake.add("C1", { ts: reply, text: "남길 답글", user: "U1", thread_ts: parent });
  s.fake.add("C1", { ts: deleted, text: "지울 메시지", user: "U1" });
  s.fake.add("C1", { ts: old, text: "오래된 본문", user: "U1" });
  s.fake.add("C1", { ts: oldReply, text: "오래된 답글", user: "U1", thread_ts: old });
  await s.collector.tick(at(T0));
  assert.equal((await rows(s.db)).length, 6);

  s.fake.edit(parent, "고친 본문", ts(T0));
  s.fake.remove(gone);
  s.fake.remove(deleted);
  s.fake.edit(old, "고친 오래된 본문", ts(T0));
  s.fake.edit(oldReply, "고친 오래된 답글", ts(T0));
  await s.collector.tick(at(T0 + MINUTE));
  const now = "SELECT ts, text, reply_count FROM messages ORDER BY ts DESC LIMIT 2";
  assert.deepEqual(await rows(s.db, now), [
    { ts: reply, text: "남길 답글", reply_count: 0 },
    { ts: parent, text: "고친 본문", reply_count: 1 },
  ]);
  assert.equal((await rows(s.db)).length, 4);

  // 24시간보다 오래된 수정은 하루 한 번 대조가 반영한다.
  await s.collector.tick(at(T0 + DAY + MINUTE));
  assert.deepEqual(await rows(s.db, "SELECT ts, text, edited_ts FROM messages ORDER BY ts LIMIT 2"), [
    { ts: old, text: "고친 오래된 본문", edited_ts: ts(T0) },
    { ts: oldReply, text: "고친 오래된 답글", edited_ts: ts(T0) },
  ]);
});

test("답글은 thread_ts로 부모에 묶이고 시스템 메시지는 저장하지 않는다", async (t) => {
  const s = await setup();
  t.after(s.close);
  const joined = hoursAgo(4);
  const parent = hoursAgo(3);
  const first = hoursAgo(2);
  const second = hoursAgo(1);
  s.fake.add("C1", { ts: joined, text: "<@U1> has joined the channel", user: "U1", subtype: "channel_join" });
  s.fake.add("C1", { ts: parent, text: "질문 있습니다", user: "U1" });
  s.fake.add("C1", { ts: first, text: "답 1", user: "U2", thread_ts: parent });
  s.fake.add("C1", { ts: second, text: "답 2", user: "U1", thread_ts: parent, subtype: "thread_broadcast" });
  await s.collector.tick(at(T0));
  const sql = "SELECT ts, thread_ts, user_name, reply_count, latest_reply FROM messages ORDER BY ts";
  assert.deepEqual(await rows(s.db, sql), [
    { ts: parent, thread_ts: parent, user_name: "alice", reply_count: 2, latest_reply: second },
    { ts: first, thread_ts: parent, user_name: null, reply_count: 0, latest_reply: null },
    { ts: second, thread_ts: parent, user_name: "alice", reply_count: 0, latest_reply: null },
  ]);
});

test("429를 받으면 기다렸다가 다시 보내 성공하고 rate_limited를 센다", async (t) => {
  const s = await setup();
  t.after(s.close);
  s.fake.add("C1", { ts: ts(T0 - HOUR), text: "안녕하세요", user: "U1" });
  s.fake.rateLimit = 2;
  await s.collector.tick(at(T0 + 5 * MINUTE));
  assert.equal((await rows(s.db)).length, 1);
  const [stats] = await rows(s.db, "SELECT bucket, api_calls, rate_limited FROM collector_hourly");
  assert.deepEqual(stats.bucket, at(T0));
  assert.equal(stats.rate_limited, 2);
  assert.equal(stats.api_calls, s.fake.requests.length);
});

test("허용 목록이 비면 Slack에 요청을 하나도 보내지 않는다", async (t) => {
  const s = await setup({ ORBIT_COLLECT_CHANNELS: "" });
  t.after(s.close);
  s.fake.add("C1", { ts: ts(T0 - HOUR), text: "안녕하세요", user: "U1" });
  await s.collector.tick(at(T0));
  await s.collector.tick(at(T0 + DAY));
  assert.deepEqual(s.fake.requests, []);
});

test("접근을 잃은 채널은 lost가 되고 7일 뒤 지워지며 다른 채널은 계속 수집한다", async (t) => {
  const s = await setup({ ORBIT_COLLECT_CHANNELS: "C1,C2" });
  t.after(s.close);
  s.fake.channels.push({ id: "C2", name: "random", is_private: true, is_member: true });
  s.fake.add("C1", { ts: ts(T0 - HOUR), text: "하나", user: "U1" });
  s.fake.add("C2", { ts: ts(T0 - 2 * HOUR), text: "둘", user: "U1" });
  await s.collector.tick(at(T0));
  const state = () =>
    rows(
      s.db,
      `SELECT c.id, c.access_state, s.last_error,
        (SELECT count(*)::int FROM messages m WHERE m.channel_id = c.id) AS messages
       FROM channels c LEFT JOIN sync_state s ON s.channel_id = c.id ORDER BY c.id`,
    );

  s.fake.errors.set("C1", "not_in_channel");
  s.fake.add("C2", { ts: ts(T0 + 30_000), text: "셋", user: "U1" });
  await s.collector.tick(at(T0 + MINUTE));
  assert.deepEqual(await state(), [
    { id: "C1", access_state: "lost", last_error: "not_in_channel", messages: 1 },
    { id: "C2", access_state: "active", last_error: null, messages: 2 },
  ]);

  s.fake.channels.splice(1, 1);
  await s.collector.tick(at(T0 + 6 * HOUR + MINUTE));
  assert.deepEqual(
    (await state()).map((r) => r.access_state),
    ["lost", "lost"],
  );

  await s.collector.tick(at(T0 + 6 * DAY));
  assert.deepEqual(
    (await state()).map((r) => r.messages),
    [1, 2],
  );

  await s.collector.tick(at(T0 + 8 * DAY));
  assert.deepEqual(await state(), [
    { id: "C1", access_state: "purged", last_error: null, messages: 0 },
    { id: "C2", access_state: "purged", last_error: null, messages: 0 },
  ]);
});

test("보존 기간이 지난 메시지와 근거 없는 지식을 지우고 샘플 채널은 남긴다", async (t) => {
  const s = await setup({ ORBIT_RETENTION_DAYS: "30" });
  t.after(s.close);
  const recent = ts(T0 - HOUR);
  s.fake.add("C1", { ts: recent, text: "최근 메시지", user: "U1" });
  await s.collector.tick(at(T0));

  await s.db.query(
    "INSERT INTO channels (id, name, kind, is_member, is_sample) VALUES ('S1', 'sample', 'public', true, true)",
  );
  for (const [channel, source] of [
    ["C1", "backfill"],
    ["S1", "sample"],
  ]) {
    await s.db.query(
      "INSERT INTO messages (channel_id, ts, text, posted_at, source) VALUES ($1, $2, '오래된 메시지', $3, $4)",
      [channel, ts(T0 - 40 * DAY), at(T0 - 40 * DAY), source],
    );
  }
  const items = await rows(
    s.db,
    "INSERT INTO knowledge_items (kind, title, summary) VALUES ('progress', '근거 있음', '.'), ('risk', '근거 없음', '.') RETURNING id",
  );
  await s.db.query(
    "INSERT INTO knowledge_evidence (item_id, channel_id, ts, permalink) VALUES ($1, 'C1', $2, 'https://example.invalid/p')",
    [items[0].id, recent],
  );

  await s.collector.tick(at(T0 + DAY));
  assert.deepEqual(await rows(s.db, "SELECT channel_id, text FROM messages ORDER BY channel_id"), [
    { channel_id: "C1", text: "최근 메시지" },
    { channel_id: "S1", text: "오래된 메시지" },
  ]);
  assert.deepEqual(await rows(s.db, "SELECT title FROM knowledge_items"), [{ title: "근거 있음" }]);
});

test("collector SQL은 지금 스키마에서 모두 준비된다", async () => {
  const { db } = await testDb();
  await selfcheck(db, SQL);
  await db.end();
});
