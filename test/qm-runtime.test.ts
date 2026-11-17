import assert from "node:assert/strict";
import test from "node:test";

const { withCodexRuntime } = await import(new URL("../scripts/qm_runtime.mjs", import.meta.url).href);

test("QM runtime overlay preserves the pinned deployment and adds only operator Codex settings", () => {
  const original = {
    orgId: "orbit",
    env: { core: { SANDBOX_BACKEND: "local", PRIVATE_NETWORK_ALLOWED_ORIGINS: "http://orbit-api:8787" } },
  };
  assert.equal(withCodexRuntime(original, undefined), original);
  const updated = withCodexRuntime(original, "credential-id");
  assert.equal(original.env.core.PRIVATE_NETWORK_ALLOWED_ORIGINS, "http://orbit-api:8787");
  assert.deepEqual(updated.env.core, {
    SANDBOX_BACKEND: "local",
    PRIVATE_NETWORK_ALLOWED_ORIGINS: "http://orbit-api:8787,http://orbit-api",
    PI_MODEL: "gpt-6.1-sol",
  });
  assert.deepEqual(updated.secretEnv.core, { CODEX_AUTH_CREDENTIAL: "ORBIT_CODEX_AUTH_CREDENTIAL" });
  assert.throws(() => withCodexRuntime(original, "secret\nSECOND=value"));
});
