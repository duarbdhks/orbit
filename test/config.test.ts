import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";

test("기본값은 유료 호출과 실데이터 전송을 모두 끈다", () => {
  const config = loadConfig({ DATABASE_URL: "postgres://x" });
  assert.equal(config.ORBIT_JEV_ENABLED, false);
  assert.equal(config.ORBIT_JEV_DAILY_BUDGET_USD, 0);
  assert.equal(config.ORBIT_ANALYZE_REAL_DATA, false);
  assert.deepEqual(config.ORBIT_COLLECT_CHANNELS, []);
  assert.equal(config.ORBIT_ROUTER_MODE, "shadow");
});

test("잘못된 값은 시작할 때 거부한다", () => {
  assert.throws(() => loadConfig({ DATABASE_URL: "postgres://x", ORBIT_JEV_ENABLED: "yes" }));
  assert.throws(() => loadConfig({ DATABASE_URL: "postgres://x", ORBIT_JEV_DAILY_BUDGET_USD: "-1" }));
  assert.throws(() => loadConfig({}));
});

import { test as t2 } from "node:test";
t2("일부러 깨뜨린 검사", () => { throw new Error("gate must fail"); });
