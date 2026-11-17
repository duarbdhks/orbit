import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { buildCollectorServer, createLiveSlackClient } from "../src/live-slack.ts";
import { createSlack } from "../src/slack.ts";
import { FAKE_TOKEN, startFakeSlack } from "./fake-slack.ts";

const AUTH = { authorization: "Bearer orbit-test", "x-qm-actor": "owner@qm" };
const FROM = "2026-11-17T00:00:00+09:00";
const TO = "2026-11-18T00:00:00+09:00";
const START = Date.parse(FROM);
const ts = (offset: number) => ((START + offset) / 1000).toFixed(6);

async function setup(t: TestContext) {
  const fake = await startFakeSlack(1);
  const config = loadConfig({
    DATABASE_URL: "postgres://unused",
    ORBIT_API_TOKEN: "orbit-test",
    ORBIT_OWNER_PRINCIPAL: "owner@qm",
    ORBIT_OWNER_USER_ID: "U1",
    ORBIT_ANALYZE_REAL_DATA: "true",
    SLACK_USER_TOKEN: FAKE_TOKEN,
    SLACK_API_BASE: fake.url,
  });
  const slack = createSlack({ token: config.SLACK_USER_TOKEN, baseUrl: config.SLACK_API_BASE });
  const app = buildCollectorServer(slack, config);
  const fetcher: typeof fetch = async (url, init) => {
    const response = await app.inject({
      method: "POST",
      url: new URL(String(url)).pathname,
      headers: init?.headers as Record<string, string>,
      payload: String(init?.body),
    });
    return new Response(response.payload, { status: response.statusCode });
  };
  t.after(async () => {
    await app.close();
    await fake.close();
  });
  return { fake, config, slack, app, client: createLiveSlackClient(config, fetcher), fetcher };
}

test("내부 브리지는 토큰과 owner attestation을 모두 요구하고 Slack 토큰 주인이 다르면 DM을 읽지 않는다", async (t) => {
  const { app, fake } = await setup(t);
  const request = {
    method: "POST" as const,
    url: "/internal/read_direct_messages",
    payload: { user_id: "U2", from: FROM, to: TO },
  };
  for (const headers of [
    {},
    { authorization: AUTH.authorization },
    { ...AUTH, authorization: "Bearer wrong" },
    { ...AUTH, "x-qm-actor": "other@qm" },
  ])
    assert.equal((await app.inject({ ...request, headers })).statusCode, 401);
  assert.deepEqual(fake.requests, []);
  fake.tokenOwner = "UOTHER";
  const wrongOwner = await app.inject({ ...request, headers: AUTH });
  assert.equal(wrongOwner.statusCode, 403);
  assert.deepEqual(fake.requests, ["auth.test"]);
  assert.equal(
    (await app.inject({ ...request, headers: AUTH, payload: { user_id: "U2", from: TO, to: FROM } }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        ...request,
        headers: AUTH,
        payload: { user_id: "U2", from: FROM, to: "2026-12-01T00:00:00+09:00" },
      })
    ).statusCode,
    400,
  );
  assert.deepEqual(fake.requests, ["auth.test"]);
});

test("기본 설정과 비활성 실데이터 설정에서는 collector와 Slack에 접근하지 않는다", async (t) => {
  const { fake, slack } = await setup(t);
  const defaults = loadConfig({ DATABASE_URL: "postgres://unused" });
  const app = buildCollectorServer(slack, defaults);
  t.after(() => app.close());
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/internal/find_people",
        headers: AUTH,
        payload: { query: "영훈" },
      })
    ).statusCode,
    401,
  );
  let sent = 0;
  const fetcher: typeof fetch = async () => {
    sent++;
    throw new Error("must_not_fetch");
  };
  await assert.rejects(
    createLiveSlackClient(defaults, fetcher).findPeople({ query: "영훈" }),
    /collector_not_configured/,
  );
  await assert.rejects(
    createLiveSlackClient(
      { ...defaults, ORBIT_API_TOKEN: "t", ORBIT_OWNER_PRINCIPAL: "owner", ORBIT_OWNER_USER_ID: "U1" },
      fetcher,
    ).findPeople({ query: "영훈" }),
    /real_data_disabled/,
  );
  assert.equal(sent, 0);
  assert.deepEqual(fake.requests, []);
});

test("이름 검색은 모든 페이지를 읽고 동명이인을 그대로 반환하며 bot과 삭제된 사용자를 제외한다", async (t) => {
  const { fake, client } = await setup(t);
  fake.people.push(
    { id: "U2", name: "younghoon", real_name: "김영훈", profile: { display_name: "영훈" } },
    { id: "U3", name: "another", real_name: "박영훈" },
    { id: "U4", name: "영훈봇", is_bot: true },
    { id: "U5", name: "영훈퇴사", deleted: true },
  );
  const result = await client.findPeople({ query: "영훈" });
  assert.deepEqual(
    result.people.map((p) => p.user_id),
    ["U2", "U3"],
  );
  assert.equal(result.ambiguous, true);
  assert.equal(result.complete, true);
  assert.equal(fake.requests.filter((r) => r === "users.list").length, 4);
  assert.deepEqual((await client.findPeople({ query: "아무도없음" })).people, []);
});

test("기존 1:1 DM만 찾아 한국 날짜 반개구간의 본문과 답글을 모든 페이지에서 읽는다", async (t) => {
  const { fake, client } = await setup(t);
  fake.directs.push({ id: "DOTHER", user: "U3", is_im: true }, { id: "D2", user: "U2", is_im: true });
  fake.add("DOTHER", { ts: ts(1), user: "U3", text: "unrelated-secret" });
  fake.add("D2", { ts: ts(-1000), user: "U2", text: "어제 스레드" });
  fake.add("D2", { ts: ts(1000), thread_ts: ts(-1000), user: "U1", text: "이전 스레드의 오늘 답글" });
  fake.add("D2", { ts: ts(0), user: "U1", text: "오늘 자정" });
  fake.add("D2", { ts: ts(2000), thread_ts: ts(0), user: "U2", text: "오늘 답글 1" });
  fake.add("D2", { ts: ts(3000), thread_ts: ts(0), user: "U1", text: "오늘 답글 2" });
  fake.add("D2", { ts: ts(4000), user: "U2", text: "오늘 새 메시지" });
  fake.add("D2", { ts: ts(86_400_000), user: "U2", text: "다음 자정 제외" });
  const result = await client.readDirectMessages({ user_id: "U2", from: FROM, to: TO });
  assert.equal(result.channel_id, "D2");
  assert.deepEqual(
    result.messages.map((m) => m.text),
    ["오늘 자정", "오늘 답글 1", "오늘 답글 2", "오늘 새 메시지"],
  );
  assert.equal(result.pagination.complete, true);
  assert.equal(result.coverage.complete, false);
  assert.ok(result.coverage.limitations[0]?.includes("기간 이전"));
  assert.ok(fake.requests.filter((r) => r === "conversations.history").length > 1);
  assert.ok(fake.requests.filter((r) => r === "conversations.replies").length > 1);
  assert.ok(
    fake.calls.filter((c) => c.method === "users.conversations").every((c) => c.params.get("types") === "im"),
  );
  assert.ok(
    fake.calls
      .filter((c) => c.method.startsWith("conversations."))
      .every((c) => c.params.get("channel") === "D2"),
  );
  assert.ok(!fake.requests.includes("conversations.open"));
  assert.equal(JSON.stringify(result).includes("unrelated-secret"), false);
});

test("없는 DM은 생성하지 않고 조회 오류나 잘못된 페이지를 성공이나 잘린 결과로 바꾸지 않는다", async (t) => {
  const { fake, client } = await setup(t);
  const args = { user_id: "U2", from: FROM, to: TO };
  const empty = await client.readDirectMessages(args);
  assert.equal(empty.channel_id, null);
  assert.deepEqual(empty.messages, []);
  assert.equal(empty.coverage.complete, true);
  assert.ok(!fake.requests.includes("conversations.history"));
  fake.directs.push({ id: "D2", user: "U2", is_im: true });
  fake.errors.set("D2", "CANARY-message-content");
  await assert.rejects(client.readDirectMessages(args), /^Error: collector_read_failed_http_502$/);
  fake.errors.clear();
  for (const [response, code] of [
    [{ ok: true, messages: [], has_more: true }, "invalid_response"],
    [
      { ok: true, messages: [], has_more: true, response_metadata: { next_cursor: "same" } },
      "repeated_cursor",
    ],
    [{ ok: true, messages: [{ ts: "CANARY-message-content", text: "private" }] }, "invalid_response"],
  ] as const) {
    fake.responses.set("conversations.history", response);
    await assert.rejects(client.readDirectMessages(args), {
      message: `collector_read_failed_http_502: ${code}`,
    });
  }
});

test("Slack 권한 오류는 빈 결과와 구분되는 코드만 전달하고 원본 오류 본문은 전달하지 않는다", async (t) => {
  const { fake, app, client } = await setup(t);
  fake.responses.set("users.conversations", {
    ok: false,
    error: "missing_scope",
    needed: "im:read",
    provided: "CANARY-token-fragment",
  });
  const args = { user_id: "U2", from: FROM, to: TO };
  const res = await app.inject({
    method: "POST",
    url: "/internal/read_direct_messages",
    headers: AUTH,
    payload: args,
  });
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.json(), { error: "slack_read_failed", slack_code: "missing_scope" });
  await assert.rejects(client.readDirectMessages(args), {
    message: "collector_read_failed_http_502: missing_scope",
  });
  assert.equal(res.payload.includes("CANARY"), false);
  assert.equal(fake.requests.includes("conversations.history"), false);
});

test("API는 HTTP 오류에서 형식이 검증된 Slack 코드만 보여 준다", async (t) => {
  const { config } = await setup(t);
  for (const body of [{ error: "CANARY-message-content" }, { slack_code: "CANARY-message-content" }]) {
    const client = createLiveSlackClient(config, async () => Response.json(body, { status: 502 }));
    await assert.rejects(client.findPeople({ query: "영훈" }), /^Error: collector_read_failed_http_502$/);
  }
});

test("API는 collector 응답의 스키마와 주인, 대상, 기간을 다시 확인한다", async (t) => {
  const { config, client } = await setup(t);
  const args = { user_id: "U2", from: FROM, to: TO };
  const valid = await client.readDirectMessages(args);
  for (const body of [
    {},
    { ...valid, owner_user_id: "UOTHER" },
    { ...valid, user_id: "UOTHER" },
    { ...valid, coverage: { ...valid.coverage, to: FROM } },
    { ...valid, messages: [{ ts: ts(1), text: "CANARY-message-content" }] },
    { ...valid, channel_id: "D2", messages: [{ ts: ts(86_400_000), text: "CANARY-message-content" }] },
  ]) {
    const bad = createLiveSlackClient(config, async () => Response.json(body));
    await assert.rejects(bad.readDirectMessages(args), /^Error: collector_invalid_response$/);
  }
});
