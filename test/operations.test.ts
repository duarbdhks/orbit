import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";

function sandbox(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-ops-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "bin");
  const home = join(dir, "orbit");
  mkdirSync(bin);
  mkdirSync(join(home, "env"), { recursive: true });
  mkdirSync(join(home, "state/orbit.git"), { recursive: true });
  writeFileSync(join(home, "state/current"), "deployed\n");
  writeFileSync(join(home, "env/orbit.env"), "ORBIT_PG_PASSWORD=test\n");
  const calls = join(dir, "calls");
  writeFileSync(calls, "");
  writeFileSync(
    join(bin, "docker"),
    `#!/bin/bash
echo "$*" >> "$CALLS"
case "$*" in
  'volume inspect '*) [ "\${VOLUMES:-all}" = all ] ;;
  inspect*) echo "\${RUNNING:-true}" ;;
  'ps -q '*) [ "\${RUNNING:-true}" != true ] || echo running ;;
esac
`,
    { mode: 0o755 },
  );
  writeFileSync(join(bin, "git"), '#!/bin/bash\necho "unexpected git" >&2\nexit 91\n', { mode: 0o755 });
  writeFileSync(join(bin, "gh"), '#!/bin/bash\necho "unexpected gh" >&2\nexit 92\n', { mode: 0o755 });
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    ORBIT_HOME: home,
    XDG_CONFIG_HOME: join(dir, "config"),
    CALLS: calls,
  };
  const secretNames = [
    "CORE_SIGNING_SECRET",
    "AUTH_CLIENT_SECRET",
    "AUTH_SIGNING_JWK",
    "AUTH_TOKEN_SECRET",
    "CAPABILITY_SECRET",
    "CONNECTOR_SECRET_KEY",
    "PORTAL_IDENTITY_SECRET",
    "PORTAL_SESSION_SECRET",
    "SKILL_SIGNING_SECRET",
  ];
  writeFileSync(
    join(home, "env/qm.env"),
    `${secretNames.map((k) => `${k}=${k === "AUTH_SIGNING_JWK" ? '{"kty":"oct"}' : "ab".repeat(32)}`).join("\n")}\nADMIN_GRANTS=test@example.com:org_admin\nAUTH_ALLOWED_EMAILS=test@example.com\nPUBLIC_API_URL=http://localhost:18080\n`,
  );
  mkdirSync(join(dir, "config/qm/deployments/orbit"), { recursive: true });
  writeFileSync(
    join(dir, "config/qm/deployments/orbit/state.json"),
    JSON.stringify({ pgPassword: "test-password" }),
  );
  return { dir, home, calls, env };
}

test("QM 환경은 원래 계약의 별칭을 보존하고 셸의 모델 키를 가져오지 않는다", (t) => {
  const s = sandbox(t);
  const out = join(s.dir, "runtime");
  const run = () =>
    spawnSync(process.execPath, ["scripts/qm_env.mjs", out], {
      env: {
        ...s.env,
        OPENROUTER_API_KEY: "shell-key-must-not-leak",
        ANTHROPIC_API_KEY: "shell-key-must-not-leak",
      },
      encoding: "utf8",
    });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const text = readFileSync(join(out, "core.env"), "utf8");
  assert.match(text, new RegExp(`OIDC_CLIENT_SECRET=${"ab".repeat(32)}`));
  assert.match(text, /DATABASE_URL=postgres:\/\/postgres:test-password@pg:5432\/qm/);
  assert.match(text, /PRIVATE_NETWORK_ALLOWED_ORIGINS=http:\/\/orbit-api:8787/);
  assert.match(text, /AUTH_SIGNING_JWK=\{"kty":"oct"\}/);
  assert.doesNotMatch(text, /shell-key-must-not-leak/);
  assert.equal(run().status, 0);
  assert.equal(readFileSync(join(out, "core.env"), "utf8"), text);
});

test("기존 볼륨이 없으면 QM 환경 준비가 빈 DB를 만들지 않는다", (t) => {
  const s = sandbox(t);
  const run = spawnSync(process.execPath, ["scripts/qm_env.mjs", join(s.dir, "runtime")], {
    env: { ...s.env, VOLUMES: "missing" },
    encoding: "utf8",
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /기존 데이터 볼륨 또는 QM DB 비밀번호/);
  assert.doesNotMatch(readFileSync(s.calls, "utf8"), /volume create/);
});

test("공백이 있는 실제 릴리스 경로에서도 QM 설정을 읽는다", (t) => {
  const s = sandbox(t);
  const release = join(s.dir, "Release With Spaces");
  mkdirSync(join(release, "scripts"), { recursive: true });
  mkdirSync(join(release, "qm"));
  copyFileSync("scripts/qm_env.mjs", join(release, "scripts/qm_env.mjs"));
  copyFileSync("qm/qm.config.jsonc", join(release, "qm/qm.config.jsonc"));
  symlinkSync(resolve("qm/node_modules"), join(release, "qm/node_modules"));
  const run = spawnSync(process.execPath, [join(release, "scripts/qm_env.mjs"), join(s.dir, "runtime")], {
    env: s.env,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
});

test("초기 설치만 새 QM 비밀번호와 외부 볼륨을 준비한다", (t) => {
  const s = sandbox(t);
  const statePath = join(s.dir, "config/qm/deployments/orbit/state.json");
  rmSync(statePath);
  const out = join(s.dir, "runtime");
  const run = spawnSync(process.execPath, ["scripts/qm_env.mjs", out, "--init"], {
    env: { ...s.env, VOLUMES: "missing" },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).pgPassword.length, 32);
  assert.equal((readFileSync(s.calls, "utf8").match(/^volume create /gm) ?? []).length, 3);
  assert.equal(statSync(join(out, "core.env")).mode & 0o777, 0o600);
});

test("운영 그룹 전체 중지 시 자동 배포는 fetch와 기동 전에 끝난다", (t) => {
  const s = sandbox(t);
  const run = spawnSync("bash", ["scripts/deploy.sh", "--auto"], {
    env: { ...s.env, RUNNING: "false" },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(readFileSync(s.calls, "utf8"), /^(start|compose|run) /m);
  assert.equal(existsSync(join(s.home, "state/deploy.lock")), false);
});

test("중지된 DB의 자동 백업은 기존 백업을 보존한다", (t) => {
  const s = sandbox(t);
  const old = join(s.home, "backups/20260101-000000");
  mkdirSync(old, { recursive: true });
  writeFileSync(join(old, "orbit.dump"), "preserve");
  const run = spawnSync("bash", ["scripts/backup.sh", "--auto"], {
    env: { ...s.env, RUNNING: "false" },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(readFileSync(join(old, "orbit.dump"), "utf8"), "preserve");
  assert.doesNotMatch(readFileSync(s.calls, "utf8"), /exec|run /);
});

test("QM down --purge는 볼륨이나 컨테이너에 접근하지 않고 거절한다", () => {
  const run = spawnSync("bash", [resolve("scripts/qm.sh"), "down", "--purge"], { encoding: "utf8" });
  assert.equal(run.status, 2);
});
