// 배포된 orbit-api 안에서 샘플 데이터의 분류, 분석 제출, 브리핑을 MCP 로 끝까지 돌려 본다.
// 사용법: docker exec orbit-api node src/main.ts sample && sleep 35 &&
//         docker exec -i orbit-api node --input-type=module - < scripts/probe/sample_e2e.mjs
// 모델 대신 fixtures/ai-responses.json 의 정상 모의 응답을 제출한다. 샘플 채널만 건드린다.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const headers = {
  "content-type": "application/json",
  authorization: `Bearer ${process.env.ORBIT_API_TOKEN}`,
  "x-qm-actor": process.env.ORBIT_OWNER_PRINCIPAL,
};
let id = 0;
async function call(name, args = {}) {
  const res = await fetch("http://127.0.0.1:8787/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }),
  });
  assert.equal(res.status, 200, `${name} HTTP ${res.status}`);
  const { result } = await res.json();
  assert.ok(!result.isError, `${name}: ${result.content[0].text}`);
  return JSON.parse(result.content[0].text);
}

const { messages } = await call("claim_unanalyzed", { limit: 30 });
console.log(`분석 대기 메시지 ${messages.length}건 (hold 는 제외됨)`);
assert.ok(messages.length > 0, "샘플을 넣고 30초 뒤에 실행하세요");
assert.ok(
  messages.every((m) => typeof m.message.untrusted_slack_content === "string"),
  "샘플 원문은 모델로 나갈 수 있다",
);

const responses = JSON.parse(await readFile("/app/fixtures/ai-responses.json", "utf8"));
const submitted = await call("submit_analysis", responses.valid);
console.log(`지식 항목 ${submitted.item_ids.length}건 저장`);

const knowledge = await call("list_knowledge", { unbriefed_only: true });
assert.match(knowledge.briefing, /archives\/CSAMPLE/, "브리핑에 permalink 가 있어야 한다");
console.log(knowledge.briefing);

const status = await call("collector_status");
console.log(`수집 상태: ${JSON.stringify(status).slice(0, 200)}`);
