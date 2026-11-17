import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const RUNTIMES = {
  simple: { modelId: "gpt-6-luna", effortLevel: "max" },
  extract: { modelId: "gpt-6-luna", effortLevel: "max" },
  standard: { modelId: "gpt-6.1-sol", effortLevel: "medium" },
  precise: { modelId: "gpt-6.1-terra", effortLevel: "max" },
  complex: { modelId: "gpt-6-astra", effortLevel: "high" },
};

export const ORG_RUNTIME = { ...RUNTIMES.standard, modelId: "codex/gpt-6.1-sol" };
const GUIDANCE = "[Orbit 조회 환경] Slack 조회는 orbit MCP로 처리한다. 이 배포에는 명령 실행용 sandbox가 없으므로 대화 조회를 위해 execute나 sandbox 생성을 시도하지 않는다. pagination.complete가 true면 같은 필터를 반복 조회하지 않고 확인한 원문으로 답한다. coverage의 이전 스레드 누락 한계는 재조회로 해소되지 않으므로 최종 요약에 범위를 밝힌다.";

export function runtimeRule(mode) {
  if (!["observe", "enforce", "off"].includes(mode)) throw new Error("Choose observe, enforce or off");
  const descriptions = {
    simple: "인사, 현재 모델과 effort 등 실제 설정값 조회",
    extract: "한 출처에서 근거를 그대로 추출하는 작업",
    standard: "도구로 한 사람이나 한 채널의 대화를 조회하고 요약하는 작업",
    precise: "여러 출처, 사람, 조건과 시간순서를 대조하는 작업",
    complex: "모순된 근거 검증, 장애 원인 또는 중요한 판단",
  };
  return {
    id: "orbit-runtime",
    hook: "turn_start",
    question: "실제 최신 요청의 목적, 근거 범위, 추론 난도와 실수 영향을 판단한다. 턴 설명은 질문 본문이 아니다.",
    options: Object.fromEntries(Object.entries(RUNTIMES).map(([id, runtime]) => [id, {
      description: descriptions[id], action: "use_runtime", runtime: { ...runtime, fastMode: false },
    }])),
    model: { provider: "orbit", model: "runtime" },
    mode,
    onError: "standard",
  };
}

export function collectorEnv(api, collector) {
  const values = Object.fromEntries(api.split("\n").filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
  const keys = ["ORBIT_API_TOKEN", "ORBIT_OWNER_PRINCIPAL", "ORBIT_OWNER_USER_ID", "ORBIT_ANALYZE_REAL_DATA", "ORBIT_SLACK_BASE_URL"];
  return collector.split("\n").filter((line) => !keys.some((key) => line.startsWith(`${key}=`))).join("\n").trimEnd() + "\n" + keys.filter((key) => values[key] !== undefined).map((key) => `${key}=${values[key]}`).join("\n") + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] ?? "observe";
  const rule = runtimeRule(mode);
  const orbitHome = process.env.ORBIT_HOME ?? join(homedir(), "Library/Application Support/Orbit");
  const env = Object.fromEntries(readFileSync(join(orbitHome, "env/orbit.env"), "utf8")
    .split("\n").filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
  if (!env.ORBIT_API_TOKEN || !env.ORBIT_OWNER_PRINCIPAL) throw new Error("Orbit token and owner must be configured");
  const apiPath = join(orbitHome, "env/orbit.env");
  const collectorPath = join(orbitHome, "env/collector.env");
  const apiEnv = readFileSync(apiPath, "utf8");
  writeFileSync(collectorPath, collectorEnv(apiEnv, readFileSync(collectorPath, "utf8")), { mode: 0o600 });
  writeFileSync(apiPath, apiEnv.split("\n").filter((line) => !line.startsWith("ORBIT_DECISION_PORT=")).join("\n").trimEnd() + "\nORBIT_DECISION_PORT=80\n", { mode: 0o600 });
  execFileSync("bash", [fileURLToPath(new URL("./compose.sh", import.meta.url)), "prepare"], { stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("bash", [fileURLToPath(new URL("./compose.sh", import.meta.url)), "up", "-d", "--wait", "--wait-timeout", "120", "orbit-api", "orbit-collector"], { stdio: ["ignore", "pipe", "pipe"] });
  const web = process.env.ORBIT_QM_WEB ?? "http://localhost:18082";
  const output = execFileSync("bash", [fileURLToPath(new URL("./qm.sh", import.meta.url)), "admin-login", "--email", env.ORBIT_OWNER_PRINCIPAL], { encoding: "utf8" });
  const link = output.split(/\s+/).find((word) => word.startsWith(`${web}/`) && word.includes("#token="));
  if (!link) throw new Error("QM administrator login unavailable");
  const login = await fetch(`${web}/auth/admin-login`, {
    method: "POST", redirect: "manual", headers: { origin: web },
    body: new URLSearchParams({ token: link.split("#token=")[1] }),
  });
  const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  if (!cookie || login.status >= 400) throw new Error("QM administrator login failed");
  const api = async (path, body) => {
    const response = await fetch(`${web}/api/admin/${path}`, {
      method: body ? "PUT" : "GET", headers: { cookie, origin: web, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`QM ${path} HTTP ${response.status}`);
    return response.json();
  };
  const scope = "scopes/org%3Aorbit";
  const before = await api(scope);
  const existing = before.serviceCredentials?.find((value) => value.slug === "orbit-decisions");
  await api(`${scope}/service-credentials`, {
    slug: "orbit-decisions", name: "Orbit runtime decisions", host: "orbit-api",
    secret: env.ORBIT_API_TOKEN, delivery: "broker", enabled: true,
    allowedMethods: ["POST"], allowedPathPrefixes: ["/decisions"], grantees: [], deployments: false,
    ...(existing ? { expectedUpdatedAt: existing.updatedAt } : {}),
  });
  await api(`${scope}/decisions`, { provider: { id: "orbit", protocol: "decisions", baseUrl: "http://orbit-api", credential: "orbit-decisions" } });
  await api(`${scope}/runtime`, ORG_RUNTIME);
  await api(`${scope}/subagent-runtime`, RUNTIMES.standard);
  await api(`${scope}/decisions`, { rule });
  await api(`${scope}/ack-emoji`, { names: ["orbit-working"] });
  if (!(before.soul ?? "").includes("[Orbit 조회 환경]"))
    await api(`${scope}/soul`, { content: [before.soul, GUIDANCE].filter(Boolean).join("\n\n"), expectedVersion: before.soulVersion ?? 0 });
  await api(`${scope}/feature-flags`, { featureName: "slack_loading_indicator", scopeId: `personal:${env.ORBIT_OWNER_PRINCIPAL}`, on: true });
  const after = await api(scope);
  console.log(JSON.stringify({ mode: after.decisions.rules.find((value) => value.id === rule.id)?.mode, runtime: after.runtime, subagentRuntime: after.subagentRuntime }));
}
