import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { evaluate } from "../src/eval.ts";
import { tierOf } from "../src/router.ts";

test("evaluate 는 정확도와 라벨별 예측 수를 센다", async () => {
  const examples = [1, 2, 3, 4].map((n) => ({ input: n, expected: n % 2 ? "a" : "b" }));
  const result = await evaluate(examples, (n) => (n <= 3 ? "a" : "b"));
  assert.equal(result.total, 4);
  assert.equal(result.accuracy, 0.75);
  assert.deepEqual(result.by_label, { a: 3, b: 1 });
});

test("evaluate 는 예시마다 걸린 시간으로 p50 과 p95 를 낸다", async () => {
  const examples = [
    { input: 0, expected: "x" },
    { input: 30, expected: "x" },
  ];
  const result = await evaluate(examples, async (ms) => {
    await sleep(ms);
    return "x";
  });
  assert.ok(result.p50_ms < 20, `p50 ${result.p50_ms}`);
  assert.ok(result.p95_ms >= 25, `p95 ${result.p95_ms}`);
});

test("runtime 예시에서 규칙 tierOf 의 정확도는 0.8 이상이다", async () => {
  const fixture: { runtime: { input: string; expected: string }[] } = JSON.parse(
    readFileSync(new URL("../fixtures/router-eval.json", import.meta.url), "utf8"),
  );
  const result = await evaluate(fixture.runtime, (input) => tierOf(input).tier);
  assert.ok(result.total >= 35);
  assert.ok(result.accuracy >= 0.8, `accuracy ${result.accuracy}`);
  assert.deepEqual(Object.keys(result.by_label).sort(), ["complex", "simple", "standard"]);
});
