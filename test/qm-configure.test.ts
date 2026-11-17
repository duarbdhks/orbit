import assert from "node:assert/strict";
import test from "node:test";

const { runtimeRule, collectorEnv, ORG_RUNTIME } = await import(
  new URL("../scripts/qm_configure.mjs", import.meta.url).href
);

test("collector provisioning preserves its Slack token and carries owner authentication without enabling real data", () => {
  const api =
    "ORBIT_API_TOKEN=shared\nORBIT_OWNER_PRINCIPAL=owner\nORBIT_OWNER_USER_ID=U1\nORBIT_ANALYZE_REAL_DATA=false\n";
  const collector = "SLACK_USER_TOKEN=private\nORBIT_API_TOKEN=old\n";
  const updated = collectorEnv(api, collector);
  assert.ok(updated.includes("SLACK_USER_TOKEN=private\n"));
  assert.ok(updated.includes("ORBIT_API_TOKEN=shared\n"));
  assert.ok(updated.includes("ORBIT_OWNER_USER_ID=U1\n"));
  assert.ok(updated.includes("ORBIT_ANALYZE_REAL_DATA=false\n"));
  assert.equal(collectorEnv(api, updated), updated);
});

test("QM rules choose Codex runtimes, keep a working fallback and start in observation", () => {
  const rule = runtimeRule("observe");
  assert.equal(rule.mode, "observe");
  assert.equal(rule.options[rule.onError].runtime.modelId, "gpt-6.1-sol");
  assert.equal(rule.options.simple.runtime.effortLevel, "max");
  assert.equal(ORG_RUNTIME.modelId, "codex/gpt-6.1-sol");
  assert.equal(rule.options.precise.runtime.modelId, "gpt-6.1-terra");
  assert.equal(rule.options.precise.runtime.effortLevel, "max");
  assert.equal(rule.options.extract.runtime.effortLevel, "max");
  assert.equal(runtimeRule("enforce").mode, "enforce");
  assert.throws(() => runtimeRule("active"));
});
