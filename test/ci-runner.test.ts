import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const image =
  "ghcr.io/actions/actions-runner@sha256:759a1d94a15b05941aba5196974ff43fe15b4cbba29b694b35cbc32a1166b232";
const token = "mock-registration-token";
const composeSource = readFileSync(new URL("../compose.ci.yaml", import.meta.url), "utf8");

type Container = {
  project: string;
  service: string;
  state: string;
  configured: boolean;
  image: string;
  mounts: number;
};
type MockState = {
  private: boolean;
  approval: string;
  container: Container | null;
  runner: { id: number; busy: boolean; status: string } | null;
  calls: { cli: string; args: string[]; tokenEnv?: string }[];
  creates: number;
  removes: number;
  registrations: number;
  deletions: number;
  tokens: number;
  failList?: boolean;
  failToken?: boolean;
  busyOnToken?: boolean;
  runnerRow?: string;
};

const mockCli = String.raw`
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { readFileSync, writeFileSync } = require("node:fs");
const { basename, join } = require("node:path");
const file = process.env.MOCK_STATE;
const s = JSON.parse(readFileSync(file, "utf8"));
const cli = basename(process.argv[1]);
const args = process.argv.slice(2);
const output = (value) => process.stdout.write(String(value) + "\n");
const idle = () => assert.notEqual(s.runner?.busy, true, "busy runner must not change");
s.calls.push({ cli, args, tokenEnv: process.env.RUNNER_TOKEN });
try {
  if (cli === "gh") {
    assert.equal(args[0], "api");
    const endpoint = args.find((a) => a.startsWith("repos/"));
    if (endpoint === "repos/example/orbit") output(s.private);
    else if (endpoint.endsWith("/fork-pr-contributor-approval")) output(s.approval);
    else if (endpoint.endsWith("/registration-token")) {
      assert.equal(s.container?.state, "running", "create before requesting token");
      assert.ok(args.includes("POST"));
      if (s.failToken) throw Error("token API unavailable");
      s.tokens++;
      if (s.busyOnToken && s.runner) s.runner.busy = true;
      output("mock-registration-token");
    } else if (args.includes("DELETE")) {
      idle();
      assert.equal(endpoint, "repos/example/orbit/actions/runners/" + s.runner.id);
      s.runner = null;
      s.deletions++;
    } else if (endpoint === "repos/example/orbit/actions/runners") {
      if (s.failList) throw Error("runner API unavailable");
      if (s.runnerRow !== undefined) output(s.runnerRow);
      else if (s.runner) output([s.runner.id, s.runner.busy, s.runner.status].join("\t"));
    } else throw Error("unexpected GitHub request");
  } else if (cli === "docker") {
    if (args[0] === "compose") {
      assert.deepEqual(args.slice(1, 5), ["--project-name", "orbit-ci", "-f", join(process.env.MOCK_ROOT, "compose.ci.yaml")]);
      assert.equal(process.env.RUNNER_TOKEN, undefined);
      const source = readFileSync(args[4], "utf8");
      assert.doesNotMatch(source, /RUNNER_TOKEN|mock-registration-token/);
      const action = args[5];
      if (action === "config") output(source.match(/image: (\S+)/)[1]);
      else if (action === "up") {
        assert.ok(args.includes("--no-recreate"));
        if (!s.container) {
          idle();
          s.creates++;
          s.container = { project: "orbit-ci", service: "runner", state: "running", configured: false,
            image: source.match(/image: (\S+)/)[1], mounts: 0 };
        }
        s.container.state = "running";
      } else if (action === "rm" || action === "down") {
        idle();
        if (s.container) {
          assert.equal(s.container.project, "orbit-ci");
          s.container = null;
          s.removes++;
        }
      } else throw Error("unexpected Compose action");
    } else if (args[0] === "container" && args[1] === "ls") {
      assert.ok(args.includes("name=^/orbit-runner$"));
      if (s.container) output([s.container.project, s.container.service, s.container.state].join("|"));
    } else if (args[0] === "container" && args[1] === "inspect") {
      assert.ok(s.container);
      output(s.container.image + "|" + s.container.mounts);
    } else if (args[0] === "exec") {
      assert.equal(s.container?.state, "running");
      if (args.some((a) => a.includes("./config.sh"))) {
        idle();
        assert.equal(s.container.configured, false);
        assert.ok(args.includes("-i"));
        assert.ok(args.includes("https://github.com/example/orbit"));
        assert.ok(args.includes("orbit-ci-mac"));
        const input = readFileSync(0, "utf8");
        assert.equal(input, "mock-registration-token\n");
        assert.doesNotMatch(args.join(" "), /mock-registration-token/);
        const configured = spawnSync("/bin/bash", args.slice(args.indexOf("bash") + 1), {
          cwd: join(process.env.MOCK_ROOT, "runner"), input, encoding: "utf8",
          env: { PATH: "/usr/bin:/bin" }
        });
        assert.equal(configured.status, 0, configured.stderr);
        s.registrations++;
        s.container.configured = true;
        s.runner = { id: 100 + s.registrations, status: "online", busy: false };
      } else output(s.container.configured ? "yes" : "no");
    } else if (args[0] === "rm") {
      idle();
      assert.equal(s.container.project, "");
      s.container = null;
      s.removes++;
    } else throw Error("unexpected Docker command");
  } else throw Error("unexpected CLI");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  writeFileSync(file, JSON.stringify(s));
}
`;

function container(overrides: Partial<Container> = {}): Container {
  return {
    project: "orbit-ci",
    service: "runner",
    state: "running",
    configured: true,
    image,
    mounts: 0,
    ...overrides,
  };
}

function fixture(t: { after: (fn: () => void) => void }, overrides: Partial<MockState> = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "orbit-ci-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  mkdirSync(bin);
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "runner"));
  writeFileSync(
    join(root, "runner/config.sh"),
    `#!${process.execPath}\n` +
      'const assert = require("node:assert/strict");\n' +
      "assert.equal(process.env.RUNNER_TOKEN, undefined);\n" +
      'assert.deepEqual(process.argv.slice(2), ["--unattended", "--url", "https://github.com/example/orbit", "--token", "mock-registration-token", "--name", "orbit-ci-mac", "--labels", "orbit-ci-mac", "--replace"]);\n',
    { mode: 0o755 },
  );
  copyFileSync(new URL("../scripts/ci_runner.sh", import.meta.url), join(root, "scripts/ci_runner.sh"));
  writeFileSync(join(root, "compose.ci.yaml"), composeSource);
  const file = join(root, "state.json");
  writeFileSync(
    file,
    JSON.stringify({
      private: true,
      approval: "first_time_contributors",
      container: null,
      runner: null,
      calls: [],
      creates: 0,
      removes: 0,
      registrations: 0,
      deletions: 0,
      tokens: 0,
      ...overrides,
    }),
  );
  for (const cli of ["docker", "gh"])
    writeFileSync(join(bin, cli), `#!${process.execPath}\n${mockCli}`, { mode: 0o755 });
  const read = (): MockState => JSON.parse(readFileSync(file, "utf8"));
  return {
    read,
    update(patch: Partial<MockState>) {
      writeFileSync(file, JSON.stringify({ ...read(), ...patch }));
    },
    run(action: string) {
      return spawnSync("/bin/bash", [join(root, "scripts/ci_runner.sh"), action], {
        cwd: tmpdir(),
        encoding: "utf8",
        timeout: 20_000,
        env: {
          PATH: `${bin}:/usr/bin:/bin`,
          MOCK_ROOT: root,
          MOCK_STATE: file,
          RUNNER_TOKEN: token,
          ORBIT_REPO: "example/orbit",
        },
      });
    },
  };
}

function success(result: ReturnType<typeof spawnSync>) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error ?? ""}`);
}

function unchanged(before: MockState, after: MockState) {
  assert.deepEqual({ ...after, calls: [] }, { ...before, calls: [] });
  assert.ok(
    after.calls
      .slice(before.calls.length)
      .every(
        ({ cli, args }) =>
          ((cli === "gh" && !args.includes("POST") && !args.includes("DELETE")) ||
            (cli === "docker" && (args[0] === "container" || args[0] === "exec"))) &&
          !args.some((arg) => arg.includes("./config.sh")),
      ),
  );
}

test("CI Compose는 고정 이미지와 자원 한도를 쓰고 토큰·볼륨·호스트 권한을 갖지 않는다", () => {
  assert.match(composeSource, /^name: orbit-ci$/m);
  assert.ok(composeSource.includes(`image: ${image}`));
  assert.match(composeSource, /container_name: orbit-runner/);
  assert.match(composeSource, /cpus: 3\n\s+mem_limit: 3g/);
  assert.match(composeSource, /networks: \[default\]/);
  assert.doesNotMatch(
    composeSource,
    /RUNNER_TOKEN|environment:|env_file:|volumes:|network_mode:|privileged:|external:|docker\.sock/,
  );
});

test("runner 시작 명령은 .runner가 생긴 뒤 run.sh를 실행한다", (t) => {
  const root = mkdtempSync(join(tmpdir(), "orbit-ci-wait-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const command = JSON.parse(composeSource.match(/command: (\[.+\])/m)?.[1] ?? "null") as string[];
  writeFileSync(join(root, "run.sh"), "#!/bin/sh\nprintf ran > started\n", { mode: 0o755 });
  writeFileSync(
    join(root, "sleep"),
    "#!/bin/sh\n[ ! -f started ] || exit 1\nprintf waited > waited\n: > .runner\n",
    { mode: 0o755 },
  );
  success(
    spawnSync("/bin/bash", command.slice(1), {
      cwd: root,
      env: { PATH: `${root}:/usr/bin:/bin` },
      timeout: 5_000,
    }),
  );
  assert.equal(readFileSync(join(root, "waited"), "utf8"), "waited");
  assert.equal(readFileSync(join(root, "started"), "utf8"), "ran");
});

test("새 runner는 토큰을 exec 표준입력으로만 받고 반복 up과 정지 후 up에도 한 번만 등록한다", (t) => {
  const f = fixture(t);
  success(f.run("up"));
  assert.equal(f.read().registrations, 1);
  assert.equal(f.read().tokens, 1);
  const first = f.read();
  success(f.run("up"));
  unchanged(first, f.read());
  f.update({ container: container({ state: "exited" }) });
  success(f.run("up"));
  assert.equal(f.read().container?.state, "running");
  assert.equal(f.read().creates, 1);
  assert.equal(f.read().removes, 0);
  assert.equal(f.read().registrations, 1);
  assert.equal(f.read().tokens, 1);
  assert.ok(
    f
      .read()
      .calls.filter(({ args }) => args[0] === "compose")
      .every(({ tokenEnv }) => tokenEnv === undefined),
  );
  assert.ok(f.read().calls.every(({ args }) => !args.join(" ").includes(token)));
});

test("토큰 발급 실패 뒤 up을 다시 실행하면 생성된 컨테이너에서 등록을 마친다", (t) => {
  const f = fixture(t, { failToken: true });
  assert.notEqual(f.run("up").status, 0);
  assert.equal(f.read().container?.configured, false);
  f.update({ failToken: false });
  success(f.run("up"));
  assert.equal(f.read().creates, 1);
  assert.equal(f.read().removes, 0);
  assert.equal(f.read().registrations, 1);
});

test(".runner만 남고 GitHub 등록이 사라진 runner는 재생성하고 한 번 등록한다", (t) => {
  const f = fixture(t, { container: container() });
  success(f.run("up"));
  assert.equal(f.read().removes, 1);
  assert.equal(f.read().creates, 1);
  assert.equal(f.read().registrations, 1);
  const before = f.read();
  success(f.run("up"));
  unchanged(before, f.read());
});

test("정상 실행 중인 busy runner에 반복 up은 아무것도 바꾸지 않는다", (t) => {
  const f = fixture(t, { container: container(), runner: { id: 1, status: "online", busy: true } });
  const before = f.read();
  success(f.run("up"));
  unchanged(before, f.read());
});

test("토큰을 받는 사이 작업이 시작되면 등록을 변경하지 않는다", (t) => {
  const f = fixture(t, {
    container: container({ configured: false }),
    runner: { id: 1, status: "online", busy: false },
    busyOnToken: true,
  });
  const result = f.run("up");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /busy=true/);
  assert.equal(f.read().registrations, 0);
  assert.equal(f.read().removes, 0);
  assert.equal(f.read().runner?.id, 1);
  assert.equal(f.read().container?.configured, false);
});

for (const current of [
  null,
  container({ configured: false }),
  container({ state: "exited" }),
  container({ project: "", service: "" }),
]) {
  for (const action of ["up", "down"]) {
    test(`busy runner는 ${current ? `${current.project || "standalone"}/${current.state}/${current.configured}` : "컨테이너 없음"}에서 ${action} 변경을 막는다`, (t) => {
      const f = fixture(t, { container: current, runner: { id: 1, status: "online", busy: true } });
      const before = f.read();
      const result = f.run(action);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /busy=true/);
      unchanged(before, f.read());
    });
  }
}

test("standalone runner는 자동 채택하지 않고 명시적 down 뒤 up으로만 전환한다", (t) => {
  const f = fixture(t, {
    container: container({ project: "", service: "" }),
    runner: { id: 1, busy: false, status: "online" },
  });
  const before = f.read();
  const result = f.run("up");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /자동 채택하지 않습니다/);
  unchanged(before, f.read());
  success(f.run("down"));
  assert.equal(f.read().container, null);
  assert.equal(f.read().runner, null);
  success(f.run("up"));
  assert.equal(f.read().container?.project, "orbit-ci");
  assert.equal(f.read().deletions, 1);
  assert.equal(f.read().registrations, 1);
});

for (const patch of [{ mounts: 1 }, { image: "unrelated-image" }]) {
  test(`백업 불필요를 확인할 수 없는 runner는 재생성하지 않는다 ${JSON.stringify(patch)}`, (t) => {
    const f = fixture(t, { container: container(patch) });
    const before = f.read();
    const result = f.run("up");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /백업 불필요/);
    assert.equal(f.read().removes, 0);
    assert.equal(f.read().registrations, 0);
    assert.deepEqual(f.read().container, before.container);
  });
}

test("down은 컨테이너와 GitHub 등록을 제거하고 반복해도 안전하다", (t) => {
  const f = fixture(t, { container: container(), runner: { id: 1, busy: false, status: "online" } });
  success(f.run("down"));
  assert.equal(f.read().container, null);
  assert.equal(f.read().runner, null);
  assert.equal(f.read().deletions, 1);
  assert.equal(f.read().removes, 1);
  success(f.run("down"));
  assert.equal(f.read().deletions, 1);
  assert.equal(f.read().removes, 1);
});

test("status는 컨테이너·등록·busy와 없는 상태를 표시하고 변경하지 않는다", (t) => {
  const f = fixture(t, { container: container(), runner: { id: 1, busy: true, status: "online" } });
  const before = f.read();
  const result = f.run("status");
  success(result);
  assert.match(result.stdout, /orbit-runner running compose=orbit-ci/);
  assert.match(result.stdout, /orbit-ci-mac online busy=true/);
  unchanged(before, f.read());
  f.update({ container: null, runner: null });
  const absent = f.run("status");
  success(absent);
  assert.match(absent.stdout, /컨테이너 없음/);
  assert.match(absent.stdout, /GitHub 등록 없음/);
});

test("공개 저장소는 모든 외부 기여자의 승인 정책이 있어야 up을 허용한다", (t) => {
  const f = fixture(t, { private: false });
  const before = f.read();
  const result = f.run("up");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /all_external_contributors/);
  unchanged(before, f.read());
  f.update({ approval: "all_external_contributors" });
  success(f.run("up"));
  assert.equal(f.read().registrations, 1);
});

for (const patch of [
  { failList: true },
  { runnerRow: "1\tunknown\tonline" },
  { runnerRow: "1\tfalse\tonline\n2\ttrue\tonline" },
]) {
  test(`GitHub 상태를 확정할 수 없으면 변경하지 않는다 ${JSON.stringify(patch)}`, (t) => {
    const f = fixture(t, { container: container(), ...patch });
    for (const action of ["up", "down"]) {
      const before = f.read();
      assert.notEqual(f.run(action).status, 0);
      unchanged(before, f.read());
    }
  });
}
