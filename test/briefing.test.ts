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

test("답장 대기 건수는 초안 유무와 관계없이 awaits_owner인 항목만 센다", () => {
  const text = composeBriefing({
    kind: "daily",
    status: "수집 상태: 정상",
    items: [
      item({ awaits_owner: true }),
      item({ awaits_owner: true, suggested_reply: "답장 초안" }),
      item({ suggested_reply: "초안만 있는 항목" }),
      item({}),
    ],
  });
  assert.equal(text.split("\n")[0], "📬 이번 일간 브리핑에서 답장을 기다리는 항목은 2건이에요.");
});

test("답장 대기가 없는 일간 브리핑은 항목 수로 시작하고 빈 절은 내지 않는다", () => {
  const text = composeBriefing({
    kind: "daily",
    status: "수집 상태: 정상",
    items: [item({ suggested_reply: "제안은 남겨 둔다." })],
  });
  assert.equal(
    text,
    [
      "📋 이번 일간 브리핑에 담을 항목은 1건이에요.",
      "",
      "## 💬 내 스레드",
      "- 제목: 요약 https://example.slack.com/archives/C1/p1",
      "  답장 초안: 제안은 남겨 둔다.",
      "",
      "## 📡 수집 상태",
      "수집 상태: 정상",
    ].join("\n"),
  );
});

test("빈 주간 브리핑은 제목 없이 같은 문단에 수집 실패 상태를 남긴다", () => {
  const text = composeBriefing({
    kind: "weekly",
    status: "수집 상태: 실패, 오류 채널 2개",
    items: [],
  });
  assert.equal(text, "📭 이번 주간 브리핑에 담을 항목이 없어요. 수집 상태: 실패, 오류 채널 2개");
});

test("주간 브리핑은 정해진 절 순서와 결정 상태, 원문, 모든 링크와 초안을 보존한다", () => {
  const text = composeBriefing({
    kind: "weekly",
    status: "수집 상태: 정상",
    items: [
      item({
        kind: "risk",
        title: "답할 것",
        summary: "승인 여부를 알려 달라.",
        awaits_owner: true,
        suggested_reply: "원문 그대로 답장.\n둘째 줄도 유지.",
      }),
      item({ kind: "open_question", title: "질문" }),
      item({ kind: "decision", decision_state: "discussing", title: "논의 중인 결정" }),
      item({ kind: "progress", title: "진척" }),
      item({ kind: "policy_change", title: "정책 변경" }),
      item({ kind: "schedule_change", title: "일정 변경" }),
      item({
        kind: "incident",
        title: "장애",
        summary: "**원문** 그대로.\n다음 줄.",
        permalinks: [
          "https://example.slack.com/archives/C2/p2",
          "https://example.slack.com/archives/C2/p3?thread_ts=2&cid=C2",
        ],
      }),
      item({ kind: "decision", decision_state: "withdrawn", title: "철회된 결정" }),
      item({ kind: "decision", decision_state: "changed", title: "변경된 결정" }),
      item({ kind: "decision", decision_state: "confirmed", title: "확정된 결정" }),
    ],
  });
  assert.equal(
    text,
    [
      "📬 이번 주간 브리핑에서 답장을 기다리는 항목은 1건이에요.",
      "",
      "## ✅ 결론",
      "- [철회] 철회된 결정: 요약 https://example.slack.com/archives/C1/p1",
      "- [변경] 변경된 결정: 요약 https://example.slack.com/archives/C1/p1",
      "- [확정] 확정된 결정: 요약 https://example.slack.com/archives/C1/p1",
      "",
      "## ⚠️ 장애와 리스크",
      "- 장애: **원문** 그대로.",
      "다음 줄. https://example.slack.com/archives/C2/p2 https://example.slack.com/archives/C2/p3?thread_ts=2&cid=C2",
      "",
      "## 🗓️ 일정과 정책 변경",
      "- 정책 변경: 요약 https://example.slack.com/archives/C1/p1",
      "- 일정 변경: 요약 https://example.slack.com/archives/C1/p1",
      "",
      "## 📈 진행",
      "- 진척: 요약 https://example.slack.com/archives/C1/p1",
      "",
      "## ❓ 미해결 질문",
      "- 질문: 요약 https://example.slack.com/archives/C1/p1",
      "- [논의 중] 논의 중인 결정: 요약 https://example.slack.com/archives/C1/p1",
      "",
      "## 💬 내 스레드",
      "- 답할 것: 승인 여부를 알려 달라. https://example.slack.com/archives/C1/p1",
      "  답장 초안: 원문 그대로 답장.",
      "둘째 줄도 유지.",
      "",
      "## 📡 수집 상태",
      "수집 상태: 정상",
    ].join("\n"),
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
  assert.equal(briefing.split("\n")[0], "📬 이번 일간 브리핑에서 답장을 기다리는 항목은 1건이에요.");
  assert.match(briefing, /\n\n## 📡 수집 상태\n수집 상태: /);
  assert.ok(briefing.includes("## ✅ 결론\n- [변경] 결제 화면 개편안을 A안에서 B안으로 변경"));
  assert.ok(briefing.includes("https://example.slack.com/archives/CSAMPLE2/p1794788400000200"));
  const mine = briefing.slice(briefing.indexOf("## 💬 내 스레드"));
  assert.ok(briefing.includes("## 💬 내 스레드"));
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
