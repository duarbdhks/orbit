import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { type BriefingItem, composeBriefing } from "../src/briefing.ts";
import { loadConfig } from "../src/config.ts";
import { classifyPass } from "../src/research.ts";
import { loadSample } from "../src/sample.ts";
import { buildServer } from "../src/server.ts";
import { testDb } from "./helpers.ts";

const item = (over: Partial<BriefingItem>): BriefingItem => ({
  kind: "progress",
  decision_state: null,
  title: "제목",
  summary: "요약",
  suggested_reply: null,
  awaits_owner: false,
  permalinks: ["https://example.slack.com/archives/C1/p1"],
  ...over,
});

test("브리핑은 수집 상태 다음에 정해진 절 순서로 항목을 싣고 빈 절은 내지 않는다", () => {
  const text = composeBriefing({
    kind: "daily",
    status: "수집 상태: 정상",
    items: [
      item({ kind: "open_question", title: "질문" }),
      item({ kind: "progress", title: "진척" }),
      item({ kind: "decision", decision_state: "confirmed", title: "확정된 결정" }),
      item({ kind: "incident", title: "장애", permalinks: ["https://example.slack.com/archives/C2/p2"] }),
      item({ kind: "risk", title: "답할 것", awaits_owner: true, suggested_reply: "이렇게 답하세요" }),
    ],
  });
  const lines = text.split("\n");
  assert.equal(lines[0], "[일간 브리핑] 수집 상태: 정상");
  const sections = lines.filter((l) => l.startsWith("*"));
  assert.deepEqual(sections, ["*결론*", "*장애와 리스크*", "*진행*", "*미해결 질문*", "*내 스레드*"]);
  assert.ok(text.includes("- [확정] 확정된 결정: 요약 https://example.slack.com/archives/C1/p1"));
  assert.ok(text.includes("- 장애: 요약 https://example.slack.com/archives/C2/p2"));
  assert.ok(text.includes("  답장 초안: 이렇게 답하세요"));
  assert.equal(
    composeBriefing({ kind: "weekly", status: "수집 상태: 정상", items: [] }),
    "[주간 브리핑] 수집 상태: 정상",
  );
});

test("샘플에 정상 모의 응답을 제출하면 브리핑에 permalink 와 내 스레드 초안이 있다", async () => {
  const { db } = await testDb();
  const config = loadConfig({
    DATABASE_URL: "postgres://unused",
    ORBIT_API_TOKEN: "t".repeat(32),
    ORBIT_OWNER_PRINCIPAL: "owner@qm",
    ORBIT_OWNER_USER_ID: "USAMPLE0",
    ORBIT_SLACK_BASE_URL: "https://example.slack.com",
  });
  await loadSample(db);
  await classifyPass(db, config);
  const app = buildServer(db, config);
  const headers = { authorization: `Bearer ${config.ORBIT_API_TOKEN}`, "x-qm-actor": "owner@qm" };
  const call = async (name: string, args: unknown) => {
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
    });
    return JSON.parse(res.json().result.content[0].text);
  };
  const responses = JSON.parse(
    await readFile(new URL("../fixtures/ai-responses.json", import.meta.url), "utf8"),
  );
  await call("submit_analysis", responses.valid);

  const { briefing } = await call("list_knowledge", { unbriefed_only: true });
  assert.match(briefing, /^\[일간 브리핑\] 수집 상태: /);
  assert.ok(briefing.includes("*결론*\n- [변경] 결제 화면 개편안을 A안에서 B안으로 변경"));
  assert.ok(briefing.includes("https://example.slack.com/archives/CSAMPLE2/p1794788400000200"));
  const mine = briefing.slice(briefing.indexOf("*내 스레드*"));
  assert.ok(briefing.includes("*내 스레드*"));
  assert.ok(
    mine.includes(
      "https://example.slack.com/archives/CSAMPLE1/p1794799200000100?thread_ts=1794798000.000100&cid=CSAMPLE1",
    ),
  );
  assert.ok(mine.includes("답장 초안: 튜토리얼 영상은 2차 범위에 넣어 주세요."));

  const awaiting = await call("list_knowledge", { awaits_owner: true });
  assert.deepEqual(
    awaiting.items.map((i: BriefingItem) => i.title),
    ["온보딩 2차 범위에 튜토리얼 영상을 넣을지"],
  );
  await db.end();
});
