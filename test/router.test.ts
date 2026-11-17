import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "../src/config.ts";
import type { Db } from "../src/db.ts";
import { createJev } from "../src/jev.ts";
import { createAdvise, tierOf } from "../src/router.ts";
import { buildServer } from "../src/server.ts";
import type { Classification, Message } from "../src/types.ts";
import { testDb } from "./helpers.ts";

const BASE = {
  DATABASE_URL: "postgres://x",
  ORBIT_API_TOKEN: "orbit-token",
  ORBIT_JEV_ENABLED: "true",
  ORBIT_JEV_DAILY_BUDGET_USD: "1",
  OPENROUTER_API_KEY: "test-key",
};
const COMPLEX_INPUT = "지난주 결제 장애 원인 분석해줘";
const TIER_CHOICES = [
  { value: "simple", description: "바로 답한다" },
  { value: "standard", description: "보통 작업" },
  { value: "complex", description: "깊은 조사" },
];
const RUNTIME_CHOICES = [
  { value: "simple", description: "상태와 설정 확인" },
  { value: "extract", description: "근거 추출" },
  { value: "standard", description: "요약과 작성" },
  { value: "precise", description: "오류 영향이 큰 근거 처리" },
  { value: "complex", description: "원인과 충돌 조사" },
];
const SETTINGS_INPUT = "지금 너는 어떤 AI 모델을 쓰고 있고 effort는 어떻게 설정되어 있어?";
const qmInput = (request: string) =>
  `Turn context:\nRequested runtime: codex\nRequested model: investigation\nRequested effort: high\n${"Context detail. ".repeat(20)}\nLatest message:\n${request}`;

function jevSays(name: string, probabilities: Record<string, number>) {
  const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]?.[0];
  return Response.json({
    answers: { [name]: { type: "choice", choice, probabilities } },
    usage: { cost: 0.001, input_tokens: 200 },
  });
}

const AXIS_CHOICES = {
  intent: ["chat_status", "extraction", "summary", "investigation"],
  evidence: ["none", "single", "multiple"],
  depth: ["lookup", "synthesis", "causal_conflict"],
  impact: ["low", "high"],
};
const SUMMARY_AXES = { intent: "summary", evidence: "single", depth: "synthesis", impact: "low" };
const COMPLEX_AXES = {
  intent: "investigation",
  evidence: "multiple",
  depth: "causal_conflict",
  impact: "high",
};

function axesSays(axes = SUMMARY_AXES, uncertain?: string) {
  return Response.json({
    answers: Object.fromEntries(
      Object.entries(AXIS_CHOICES).map(([name, values]) => {
        const choice = axes[name as keyof typeof axes];
        const probability = uncertain === name ? 0.5 : 0.875;
        return [
          name,
          {
            type: "choice",
            choice,
            probabilities: Object.fromEntries(
              values.map((value) => [
                value,
                value === choice ? probability : (1 - probability) / (values.length - 1),
              ]),
            ),
          },
        ];
      }),
    ),
    usage: { cost: 0.001, input_tokens: 200 },
  });
}

async function setup(env: Record<string, string>, respond: () => Response = () => new Response(null)) {
  const { db } = await testDb();
  const config = loadConfig({ ...BASE, ...env });
  const sent: { state: unknown; questions: unknown }[] = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return respond();
  }) as typeof fetch;
  const jev = createJev(db, config, fetchImpl);
  const app = buildServer(db, config, jev);
  return { db, app, sent, advise: createAdvise(db, config, jev) };
}

function ask(app: FastifyInstance, input: string, choices = TIER_CHOICES, token = "orbit-token") {
  return app.inject({
    method: "POST",
    url: "/decisions",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload: {
      model: "qm",
      input,
      questions: [{ type: "choice", name: "tier", instructions: "경로", choices }],
    },
  });
}

async function decisions(db: Db) {
  const r = await db.query(
    `SELECT kind, mode, source, input_ref, decision, shadow, reasons, cost_usd::float8 AS cost_usd, input_tokens
     FROM router_decisions ORDER BY id`,
  );
  return r.rows;
}

test("/decisions 는 QM 문맥을 제외한 30자 초과 설정 질문에 simple 로 답하고 Jev 를 생략한다", async () => {
  const { db, app, sent } = await setup({ ORBIT_ROUTER_MODE: "active" });
  try {
    assert.ok(SETTINGS_INPUT.length > 30);
    for (const input of [SETTINGS_INPUT, qmInput(SETTINGS_INPUT), qmInput("안녕하세요")]) {
      const res = await ask(app, input, RUNTIME_CHOICES);
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().answers[0].choice, "simple");
    }
    assert.equal(sent.length, 0);
    for (const row of await decisions(db)) {
      assert.equal(row.source, "rules");
      assert.equal(row.decision.tier, "simple");
      assert.deepEqual(row.decision.flags, NO_FLAGS);
      assert.ok(row.reasons.includes("explicit_status"));
      assert.doesNotMatch(JSON.stringify(row), /어떤 AI 모델|Context detail/);
    }
  } finally {
    await app.close();
    await db.end();
  }
});

test("/decisions 는 정확한 QM 접두문자만 제거하고 실제 요청 안의 구분 문구는 보존한다", async () => {
  const { db, app, sent } = await setup({ ORBIT_ROUTER_MODE: "active" }, () => axesSays(COMPLEX_AXES));
  try {
    const request = "두 채널에서 일정이 충돌하는 원인을 조사해서 알려줘\nLatest message:\n고마워";
    assert.equal((await ask(app, qmInput(request), RUNTIME_CHOICES)).json().answers[0].choice, "complex");
    assert.deepEqual(sent[0]?.state, { request });
    assert.equal((await ask(app, request, RUNTIME_CHOICES)).json().answers[0].choice, "complex");
    assert.deepEqual(sent[1]?.state, { request });
    assert.doesNotMatch(JSON.stringify(sent), /Context detail|Requested model/);
  } finally {
    await app.close();
    await db.end();
  }
});

test("/decisions 는 추출, 요약, 여러 출처 대조, 높은 오류 영향, 인과 추론을 구분한다", async () => {
  let next = SUMMARY_AXES;
  const { db, app, sent } = await setup({ ORBIT_ROUTER_MODE: "active" }, () => axesSays(next));
  try {
    const cases = [
      {
        axes: { intent: "extraction", evidence: "single", depth: "lookup", impact: "low" },
        choice: "extract",
      },
      {
        axes: { intent: "extraction", evidence: "multiple", depth: "lookup", impact: "low" },
        choice: "precise",
      },
      {
        axes: { intent: "summary", evidence: "multiple", depth: "synthesis", impact: "low" },
        choice: "precise",
      },
      {
        axes: { intent: "extraction", evidence: "multiple", depth: "lookup", impact: "high" },
        choice: "precise",
      },
      {
        axes: { intent: "summary", evidence: "multiple", depth: "causal_conflict", impact: "low" },
        choice: "complex",
      },
    ];
    for (const { axes, choice } of cases) {
      next = axes;
      const response = (await ask(app, "지난 업무 내용을 부탁해", RUNTIME_CHOICES)).json();
      assert.equal(response.answers[0].choice, choice);
      const row = (await decisions(db)).at(-1);
      assert.equal(row.source, "jev");
      assert.equal(row.decision.tier, choice);
      assert.equal(row.decision.runtime, choice);
      assert.deepEqual(row.decision.axes, axes);
      assert.ok(
        Math.abs(
          response.answers[0].probabilities.reduce(
            (sum: number, p: { probability: number }) => sum + p.probability,
            0,
          ) - 1,
        ) < 1e-9,
      );
    }
    assert.equal(sent.length, cases.length);
    next = { intent: "extraction", evidence: "single", depth: "lookup", impact: "low" };
    assert.equal((await ask(app, "지난 업무 내용을 부탁해")).json().answers[0].choice, "standard");
    next = { ...next, impact: "high" };
    assert.equal((await ask(app, "지난 업무 내용을 부탁해")).json().answers[0].choice, "complex");
    assert.ok((await decisions(db)).at(-1).reasons.includes("unsupported_runtime_choice"));
  } finally {
    await app.close();
    await db.end();
  }
});

test("/decisions 는 Jev 가 없을 때도 추출과 실제 충돌 조사를 구분하고 기본값 유료 호출은 0건이다", async () => {
  const { db } = await testDb();
  const config = loadConfig({ DATABASE_URL: "postgres://x", ORBIT_API_TOKEN: "orbit-token" });
  let calls = 0;
  const jev = createJev(db, config, (async () => {
    calls++;
    throw new Error("유료 호출 금지");
  }) as typeof fetch);
  const app = buildServer(db, config, jev);
  try {
    for (const [input, choice] of [
      ["두 채널에서 이번 주 결정된 항목만 목록으로 뽑아줘", "precise"],
      ["두 채널에서 결정된 일정이 충돌하는 이유를 조사해서 알려줘", "complex"],
      ["보안 권한 설정 변경에 필요한 항목만 목록으로 뽑아줘", "precise"],
      ["가".repeat(300), "standard"],
    ]) {
      assert.equal(
        (await ask(app, qmInput(input as string), RUNTIME_CHOICES)).json().answers[0].choice,
        choice,
      );
    }
    assert.equal(calls, 0);
    for (const row of await decisions(db)) assert.ok(row.reasons.includes("jev_unavailable"));
    assert.equal((await db.query("SELECT count(*)::int AS count FROM jev_usage")).rows[0]?.count, 0);
  } finally {
    await app.close();
    await db.end();
  }
});

test("/decisions 는 Jev 가 허용되지 않은 축 값을 주면 규칙으로 대체한다", async () => {
  const { db, app, sent } = await setup({ ORBIT_ROUTER_MODE: "active" }, () =>
    axesSays({ ...SUMMARY_AXES, intent: "unknown" }),
  );
  try {
    assert.equal((await ask(app, COMPLEX_INPUT, RUNTIME_CHOICES)).json().answers[0].choice, "complex");
    assert.equal(sent.length, 1);
    const row = (await decisions(db))[0];
    assert.equal(row.source, "rules");
    assert.equal(row.shadow, null);
    assert.ok(row.reasons.includes("jev_unavailable"));
  } finally {
    await app.close();
    await db.end();
  }
});

const NO_FLAGS = { parallel: false, web_search: false, more_analysis: false, cache_reuse: false };
const RULE_COMPLEX = {
  answers: [
    {
      name: "tier",
      type: "choice",
      choice: "complex",
      probabilities: [
        { value: "simple", probability: 0.05 },
        { value: "standard", probability: 0.05 },
        { value: "complex", probability: 0.9 },
      ],
    },
  ],
};

test("tierOf 는 실제 의도를 사용하고 인사나 조회 표현이 조사를 낮추지 않으며 길이로 승격하지 않는다", () => {
  assert.equal(tierOf("안녕하세요").tier, "simple");
  assert.equal(tierOf("오늘 일정 알려줘").tier, "simple");
  assert.equal(tierOf("어제 회의록 요약해줘").tier, "standard");
  assert.equal(
    tierOf("안녕, 오늘 결제 채널에서 나온 결정 사항을 모아서 브리핑 초안으로 만들어줘").tier,
    "standard",
  );
  assert.equal(tierOf(COMPLEX_INPUT).tier, "complex");
  assert.equal(tierOf("가".repeat(151)).tier, "standard");
  assert.equal(tierOf("장애 원인을 조사해서 알려줘").runtime, "complex");
  const payment = tierOf("두 채널에서 정산 금액을 언제 지급하기로 했는지 알려줘");
  assert.equal(payment.runtime, "precise");
  assert.equal(payment.axes.evidence, "multiple");
  assert.equal(payment.axes.impact, "high");
  const { reasons, flags } = tierOf("웹에서 최신 문서를 각각 찾아 비교해줘");
  assert.deepEqual(reasons, ["investigation"]);
  assert.deepEqual(flags, { parallel: true, web_search: true, more_analysis: false, cache_reuse: false });
});

test("/decisions 는 토큰이 없거나 틀리거나 설정값이 비면 401 이고 기록하지 않는다", async () => {
  const { db, app } = await setup({});
  assert.equal((await ask(app, "안녕", TIER_CHOICES, "")).statusCode, 401);
  assert.equal((await ask(app, "안녕", TIER_CHOICES, "wrong")).statusCode, 401);
  const empty = await setup({ ORBIT_API_TOKEN: "" });
  assert.equal((await ask(empty.app, "안녕", TIER_CHOICES, "")).statusCode, 401);
  assert.equal(
    (
      await empty.app.inject({
        method: "POST",
        url: "/decisions",
        headers: { authorization: "Bearer " },
        payload: {},
      })
    ).statusCode,
    401,
  );
  assert.deepEqual(await decisions(db), []);
  await db.end();
  await empty.db.end();
});

test("/decisions 는 모양이 틀린 요청을 400 으로 거절한다", async () => {
  const { db, app } = await setup({});
  assert.equal((await ask(app, "안녕", [])).statusCode, 400);
  await db.end();
});

test("off 모드는 규칙 결과만 돌려주고 Jev 를 부르지 않으며 원문 대신 해시를 남긴다", async () => {
  const { db, app, sent } = await setup({ ORBIT_ROUTER_MODE: "off" });
  const res = await ask(app, COMPLEX_INPUT);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), RULE_COMPLEX);
  assert.equal(sent.length, 0);
  assert.deepEqual(await decisions(db), [
    {
      kind: "runtime",
      mode: "off",
      source: "rules",
      input_ref: createHash("sha256").update(COMPLEX_INPUT).digest("hex"),
      decision: {
        tier: "complex",
        runtime: "complex",
        choices: { tier: "complex" },
        axes: { ...COMPLEX_AXES, evidence: "none", impact: "low" },
        flags: { ...NO_FLAGS, more_analysis: true },
      },
      shadow: null,
      reasons: ["investigation", "router_off"],
      cost_usd: 0,
      input_tokens: 0,
    },
  ]);
  await db.end();
});

test("shadow 모드는 Jev 답이 달라도 규칙 결과를 돌려주고 Jev 답을 shadow 에 남긴다", async () => {
  const { db, app, sent } = await setup({ ORBIT_ROUTER_MODE: "shadow" }, () => axesSays());
  assert.deepEqual((await ask(app, COMPLEX_INPUT)).json(), RULE_COMPLEX);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]?.state, { request: COMPLEX_INPUT });
  const questions = sent[0]?.questions as Record<string, { criteria: Record<string, string> }>;
  assert.deepEqual(Object.keys(questions), Object.keys(AXIS_CHOICES));
  for (const [axis, values] of Object.entries(AXIS_CHOICES)) {
    assert.deepEqual(Object.keys(questions[axis]?.criteria ?? {}), values);
    assert.ok(Object.values(questions[axis]?.criteria ?? {}).every((meaning) => meaning.length > 10));
  }
  assert.doesNotMatch(JSON.stringify(questions), /luna|astra|terra|\bsol\b|price|\$|gpt-/i);
  const [row] = await decisions(db);
  assert.equal(row.source, "rules");
  assert.deepEqual(Object.keys(row.shadow).sort(), Object.keys(AXIS_CHOICES).sort());
  for (const [axis, choice] of Object.entries(SUMMARY_AXES)) {
    assert.equal(row.shadow[axis].choice, choice);
    assert.equal(row.shadow[axis].probabilities[choice], 0.875);
  }
  assert.equal(row.decision.tier, "complex");
  assert.ok(row.reasons.includes("shadow_mode"));
  assert.equal(row.cost_usd, 0.001);
  assert.equal(row.input_tokens, 200);
  await db.end();
});

test("active 모드는 네 축이 모두 확실할 때 결합하고 한 축이 불확실하거나 실패하면 규칙을 쓴다", async () => {
  const sure = await setup({ ORBIT_ROUTER_MODE: "active" }, () =>
    axesSays({ intent: "chat_status", evidence: "none", depth: "lookup", impact: "low" }),
  );
  assert.deepEqual((await ask(sure.app, COMPLEX_INPUT)).json().answers[0], {
    name: "tier",
    type: "choice",
    choice: "simple",
    probabilities: [
      { value: "simple", probability: 0.9 },
      { value: "standard", probability: 0.05 },
      { value: "complex", probability: 0.05 },
    ],
  });
  assert.equal((await decisions(sure.db))[0].source, "jev");
  assert.equal((await decisions(sure.db))[0].decision.tier, "simple");

  let uncertainAxis = "intent";
  const unsure = await setup({ ORBIT_ROUTER_MODE: "active" }, () => axesSays(SUMMARY_AXES, uncertainAxis));
  for (const axis of Object.keys(AXIS_CHOICES)) {
    uncertainAxis = axis;
    assert.deepEqual((await ask(unsure.app, COMPLEX_INPUT)).json(), RULE_COMPLEX);
  }
  assert.equal((await decisions(unsure.db))[0].source, "rules");
  assert.ok((await decisions(unsure.db))[0].reasons.includes("jev_low_confidence"));

  const broken = await setup({ ORBIT_ROUTER_MODE: "active" }, () => Response.json({}, { status: 500 }));
  assert.deepEqual((await ask(broken.app, COMPLEX_INPUT)).json(), RULE_COMPLEX);
  const [row] = await decisions(broken.db);
  assert.equal(row.source, "rules");
  assert.equal(row.shadow, null);
  assert.ok(row.reasons.includes("jev_unavailable"));
  for (const s of [sure, unsure, broken]) await s.db.end();
});

test("선택지에 tier 이름이 없으면 standard, 그것도 없으면 첫 선택지에 0.9 를 준다", async () => {
  const { db, app } = await setup({ ORBIT_ROUTER_MODE: "off" });
  const probabilities = async (choices: { value: string; description: string }[]) =>
    (await ask(app, COMPLEX_INPUT, choices)).json().answers[0].probabilities;
  assert.deepEqual(await probabilities(TIER_CHOICES.slice(0, 2)), [
    { value: "simple", probability: 0.1 },
    { value: "standard", probability: 0.9 },
  ]);
  assert.deepEqual(
    await probabilities([
      { value: "fast", description: "" },
      { value: "deep", description: "" },
    ]),
    [
      { value: "fast", probability: 0.9 },
      { value: "deep", probability: 0.1 },
    ],
  );
  assert.deepEqual(await probabilities([{ value: "only", description: "" }]), [
    { value: "only", probability: 1 },
  ]);
  await db.end();
});

const RULES: Classification = {
  work_related: true,
  importance: 2,
  urgency: 1,
  is_new: true,
  conflicts: false,
  needs_research: false,
  awaits_owner: false,
  route: "briefing",
  reasons: ["schedule"],
};
const message = (channel_id: string): Message => ({
  channel_id,
  ts: "1763300000.000100",
  thread_ts: null,
  user_id: "U1",
  user_name: "user1",
  text: "결제 서버가 다운됐습니다 CANARY-7f3a",
  posted_at: new Date("2026-11-17T00:00:00Z"),
});

async function channels(db: Db) {
  await db.query(
    `INSERT INTO channels (id, name, kind, is_member, is_sample)
     VALUES ('CSAMPLE1', 'sample', 'public', true, true), ('CREAL1', 'real', 'public', true, false)`,
  );
}

test("advise 는 off 모드에서 규칙 결과 그대로이고 요청도 기록도 없다", async () => {
  const { db, sent, advise } = await setup({ ORBIT_ROUTER_MODE: "off" }, () =>
    jevSays("route", { notify_now: 0.875, briefing: 0.0625, hold: 0.0625 }),
  );
  await channels(db);
  assert.deepEqual(await advise(message("CSAMPLE1"), RULES), RULES);
  assert.equal(sent.length, 0);
  assert.deepEqual(await decisions(db), []);
  await db.end();
});

test("advise 는 shadow 모드에서 규칙 결과를 돌려주고 Jev 의 route 답을 남긴다", async () => {
  const jevProbabilities = { notify_now: 0.875, briefing: 0.0625, hold: 0.0625 };
  const { db, sent, advise } = await setup({ ORBIT_ROUTER_MODE: "shadow" }, () =>
    jevSays("route", jevProbabilities),
  );
  await channels(db);
  assert.deepEqual(await advise(message("CSAMPLE1"), RULES), RULES);
  const [request] = sent as { state: unknown; questions: { route: { criteria: object } } }[];
  assert.deepEqual(request?.state, { channel_id: "CSAMPLE1", text: message("CSAMPLE1").text });
  assert.deepEqual(Object.keys(request?.questions.route.criteria ?? {}), ["notify_now", "briefing", "hold"]);
  assert.deepEqual(await decisions(db), [
    {
      kind: "classify",
      mode: "shadow",
      source: "rules",
      input_ref: "CSAMPLE1:1763300000.000100",
      decision: { route: "briefing" },
      shadow: { choice: "notify_now", probabilities: jevProbabilities },
      reasons: ["schedule"],
      cost_usd: 0.001,
      input_tokens: 200,
    },
  ]);
  await db.end();
});

test("advise 는 active 모드에서 Jev 가 확신할 때만 route 를 바꾸고 reasons 에 jev 를 더한다", async () => {
  const sure = await setup({ ORBIT_ROUTER_MODE: "active" }, () =>
    jevSays("route", { notify_now: 0.75, briefing: 0.125, hold: 0.125 }),
  );
  await channels(sure.db);
  assert.deepEqual(await sure.advise(message("CSAMPLE1"), RULES), {
    ...RULES,
    route: "notify_now",
    reasons: ["schedule", "jev"],
  });
  const [row] = await decisions(sure.db);
  assert.equal(row.source, "jev");
  assert.deepEqual(row.decision, { route: "notify_now" });

  const unsure = await setup({ ORBIT_ROUTER_MODE: "active" }, () =>
    jevSays("route", { notify_now: 0.5, briefing: 0.375, hold: 0.125 }),
  );
  await channels(unsure.db);
  assert.deepEqual(await unsure.advise(message("CSAMPLE1"), RULES), RULES);
  assert.equal((await decisions(unsure.db))[0].source, "rules");
  await sure.db.end();
  await unsure.db.end();
});

test("advise 는 Jev 가 꺼져 있으면 규칙 결과를 돌려주고 shadow 를 비워 기록한다", async () => {
  const { db, sent, advise } = await setup({ ORBIT_ROUTER_MODE: "shadow", ORBIT_JEV_ENABLED: "false" });
  await channels(db);
  assert.deepEqual(await advise(message("CSAMPLE1"), RULES), RULES);
  assert.equal(sent.length, 0);
  const [row] = await decisions(db);
  assert.equal(row.shadow, null);
  assert.equal(row.cost_usd, 0);
  await db.end();
});

test("advise 는 모델 전송이 허용되지 않은 채널의 본문을 Jev 로 보내지 않는다", async () => {
  const respond = () => jevSays("route", { notify_now: 0.75, briefing: 0.125, hold: 0.125 });
  const blocked = await setup({ ORBIT_ROUTER_MODE: "active" }, respond);
  await channels(blocked.db);
  assert.deepEqual(await blocked.advise(message("CREAL1"), RULES), RULES);
  assert.deepEqual(await blocked.advise(message("CUNKNOWN"), RULES), RULES);
  assert.equal(blocked.sent.length, 0);

  const allowed = await setup(
    { ORBIT_ROUTER_MODE: "active", ORBIT_ANALYZE_REAL_DATA: "true", ORBIT_ANALYZE_CHANNELS: "CREAL1" },
    respond,
  );
  await channels(allowed.db);
  assert.equal((await allowed.advise(message("CREAL1"), RULES)).route, "notify_now");
  assert.equal(allowed.sent.length, 1);
  await blocked.db.end();
  await allowed.db.end();
});
