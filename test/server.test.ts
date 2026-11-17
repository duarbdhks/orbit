import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { buildDecisionServer, buildServer } from "../src/server.ts";
import { testDb } from "./helpers.ts";

test("healthz 는 DB 가 살아 있을 때만 200 이다", async () => {
  const { db } = await testDb();
  const app = buildServer(db, loadConfig({ DATABASE_URL: "postgres://unused" }));
  assert.equal((await app.inject("/healthz")).statusCode, 200);
  await db.end();
  assert.equal((await app.inject("/healthz")).statusCode, 500);
});

test("별도 decision 서버는 같은 인증과 DB를 쓰고 MCP와 healthz를 제공하지 않는다", async (t) => {
  const { db } = await testDb();
  const config = loadConfig({ DATABASE_URL: "postgres://unused", ORBIT_API_TOKEN: "test-token" });
  const app = buildDecisionServer(db, config);
  t.after(async () => {
    await app.close();
    await db.end();
  });
  assert.equal((await app.inject({ method: "POST", url: "/decisions", payload: {} })).statusCode, 401);
  const res = await app.inject({
    method: "POST",
    url: "/decisions",
    headers: { authorization: "Bearer test-token" },
    payload: {
      model: "qm",
      input: "안녕",
      questions: [
        {
          type: "choice",
          name: "tier",
          instructions: "경로",
          choices: [{ value: "simple", description: "대화" }],
        },
      ],
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().answers[0].choice, "simple");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM router_decisions")).rows[0].n, 1);
  assert.equal((await app.inject({ method: "POST", url: "/mcp", payload: {} })).statusCode, 404);
  assert.equal((await app.inject("/healthz")).statusCode, 404);
});
