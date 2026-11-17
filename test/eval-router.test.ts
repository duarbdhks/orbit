import assert from "node:assert/strict";
import { test } from "node:test";
import { evalRouter } from "../scripts/eval_router.ts";

test("규칙 라우터는 라벨 붙은 예시에서 정확도 0.8 이상이고 일부 메시지를 AI 분석에서 뺀다", async () => {
  const result = await evalRouter();
  assert.ok(result.runtime.accuracy >= 0.8, `runtime ${result.runtime.accuracy}`);
  assert.ok(result.classify.accuracy >= 0.8, `classify ${result.classify.accuracy}`);
  assert.ok(result.analysis_skipped > 0 && result.analysis_skipped < 1);
});
