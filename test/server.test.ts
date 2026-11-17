import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { buildServer } from "../src/server.ts";
import { testDb } from "./helpers.ts";

test("healthz 는 DB 가 살아 있을 때만 200 이다", async () => {
  const { db } = await testDb();
  const app = buildServer(db, loadConfig({ DATABASE_URL: "postgres://unused" }));
  assert.equal((await app.inject("/healthz")).statusCode, 200);
  await db.end();
  assert.equal((await app.inject("/healthz")).statusCode, 500);
});
