import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { SQL } from "../src/db/router.ts";
import { type Db, selfcheck } from "../src/db.ts";
import { confident, createJev, JEV_MODEL, JEV_URL, type JevQuestions } from "../src/jev.ts";
import { testDb } from "./helpers.ts";

const ON = {
  DATABASE_URL: "postgres://x",
  ORBIT_JEV_ENABLED: "true",
  ORBIT_JEV_DAILY_BUDGET_USD: "1",
  OPENROUTER_API_KEY: "test-key",
};
const QUESTIONS: JevQuestions = {
  route: {
    type: "choice",
    instructions: "고른다",
    criteria: { notify_now: "긴급", briefing: "브리핑", hold: "보류" },
  },
};
const GOOD = { notify_now: 0.125, briefing: 0.75, hold: 0.125 };
// KST 로는 2026-11-17 00:30 이다.
const NOW = new Date("2026-11-16T15:30:00Z");

function jevBody(probabilities: Record<string, number>, choice = "briefing", type = "choice") {
  return { answers: { route: { type, choice, probabilities } }, usage: { cost: 0.002, input_tokens: 400 } };
}

function fakeFetch(responses: (() => Response)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses[Math.min(calls.length, responses.length) - 1];
    if (!next) throw new TypeError("fetch failed");
    return next();
  }) as typeof fetch;
  return { fn, calls };
}

async function usage(db: Db) {
  const r = await db.query(
    "SELECT day::text AS day, calls, cost_usd::float8 AS cost_usd, input_tokens FROM jev_usage ORDER BY day",
  );
  return r.rows;
}

test("기본값, 꺼짐, 예산 0, 키 없음에서는 Jev 요청을 한 건도 보내지 않는다", async () => {
  const { db } = await testDb();
  const fake = fakeFetch([() => Response.json(jevBody(GOOD))]);
  for (const env of [
    { DATABASE_URL: "postgres://x" },
    { ...ON, ORBIT_JEV_ENABLED: "false" },
    { ...ON, ORBIT_JEV_DAILY_BUDGET_USD: "0" },
    { ...ON, OPENROUTER_API_KEY: "" },
  ]) {
    assert.equal(await createJev(db, loadConfig(env), fake.fn).decide({}, QUESTIONS, NOW), null);
  }
  assert.equal(fake.calls.length, 0);
  assert.deepEqual(await usage(db), []);
  await db.end();
});

test("오늘(KST) 쓴 비용이 예산에 닿으면 Jev 요청을 보내지 않는다", async () => {
  const { db } = await testDb();
  await db.query(
    "INSERT INTO jev_usage (day, calls, cost_usd, input_tokens) VALUES ('2026-11-17', 3, 1, 100)",
  );
  const fake = fakeFetch([() => Response.json(jevBody(GOOD))]);
  assert.equal(await createJev(db, loadConfig(ON), fake.fn).decide({}, QUESTIONS, NOW), null);
  assert.equal(fake.calls.length, 0);
  await db.end();
});

test("켜고 예산과 키가 있으면 한 번 보내고 오늘(KST) 사용량에 더한다", async () => {
  const { db } = await testDb();
  // 어제(KST) 예산을 넘긴 기록은 오늘 호출을 막지 않는다.
  await db.query("INSERT INTO jev_usage (day, calls, cost_usd, input_tokens) VALUES ('2026-11-16', 9, 5, 0)");
  const fake = fakeFetch([
    () => Response.json(jevBody(GOOD)),
    () => Response.json({ ...jevBody(GOOD), usage: { input_tokens: 1000 } }),
  ]);
  const jev = createJev(db, loadConfig(ON), fake.fn);

  const result = await jev.decide({ text: "배포가 연기됐다" }, QUESTIONS, NOW);
  assert.deepEqual(result, {
    answers: { route: { choice: "briefing", probabilities: GOOD } },
    costUsd: 0.002,
    inputTokens: 400,
  });
  assert.equal(fake.calls.length, 1);
  const [call] = fake.calls;
  assert.equal(call?.url, JEV_URL);
  assert.equal(call?.init.method, "POST");
  assert.equal(new Headers(call?.init.headers).get("authorization"), "Bearer test-key");
  assert.equal(call?.init.redirect, "manual");
  assert.ok(call?.init.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(String(call?.init.body)), {
    model: JEV_MODEL,
    state: { text: "배포가 연기됐다" },
    questions: QUESTIONS,
  });

  // usage.cost 가 없으면 입력 토큰 단가로 계산한다.
  assert.equal((await jev.decide({}, QUESTIONS, NOW))?.costUsd, 1000 * 0.042e-6);
  assert.deepEqual(await usage(db), [
    { day: "2026-11-16", calls: 9, cost_usd: 5, input_tokens: 0 },
    { day: "2026-11-17", calls: 2, cost_usd: 0.002042, input_tokens: 1400 },
  ]);
  await db.end();
});

test("어긋난 응답은 null 이고 받은 응답은 사용량에 센다", async () => {
  const { db } = await testDb();
  const bad: (() => Response)[] = [
    () => Response.json(jevBody({ notify_now: 0.125, briefing: 0.75, urgent: 0.125 })),
    () => Response.json(jevBody({ briefing: 0.875, hold: 0.125 })),
    () => Response.json(jevBody({ notify_now: 0.5, briefing: 0.5, hold: 0.25 })),
    () => Response.json(jevBody(GOOD, "hold")),
    () => Response.json(jevBody(GOOD, "briefing", "score")),
    () => Response.json(jevBody({ notify_now: -0.25, briefing: 1.5, hold: -0.25 })),
    () => Response.json({ answers: {}, usage: { cost: 0.002 } }),
    () => Response.json({ answers: { ...jevBody(GOOD).answers, extra: jevBody(GOOD).answers.route } }),
    () => Response.json({ error: "upstream" }, { status: 500 }),
    () => new Response(null, { status: 302, headers: { location: "https://example.invalid/" } }),
    () => new Response("not json", { status: 200 }),
  ];
  const fake = fakeFetch(bad);
  const jev = createJev(db, loadConfig(ON), fake.fn);
  for (const _ of bad) assert.equal(await jev.decide({}, QUESTIONS, NOW), null);
  assert.equal(fake.calls.length, bad.length);
  assert.equal((await usage(db))[0]?.calls, bad.length);
  await db.end();
});

test("네트워크 오류는 null 이고 사용량에 세지 않는다", async () => {
  const { db } = await testDb();
  const fake = fakeFetch([]);
  assert.equal(await createJev(db, loadConfig(ON), fake.fn).decide({}, QUESTIONS, NOW), null);
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(await usage(db), []);
  await db.end();
});

test("confident 는 1위 0.6 이상이고 2위와 0.2 이상 차이 날 때만 참이다", () => {
  assert.equal(confident({ a: 0.6, b: 0.4 }), true);
  assert.equal(confident({ a: 0.6, b: 0.2, c: 0.2 }), true);
  assert.equal(confident({ a: 1 }), true);
  assert.equal(confident({ a: 0.59, b: 0.2, c: 0.21 }), false);
  assert.equal(confident({ a: 0.6, b: 0.41 }), false);
  assert.equal(confident({}), false);
});

test("router SQL 은 지금 스키마에서 모두 준비된다", async () => {
  const { db } = await testDb();
  await selfcheck(db, SQL);
  await db.end();
});
