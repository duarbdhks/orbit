import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfigAt, securityScreenEnv } from "../qm/node_modules/@yc-software/qm/dist/src/config.js";
import { dockerServiceEnv } from "../qm/node_modules/@yc-software/qm/dist/src/backends/docker.js";
import { manifestRef } from "../qm/node_modules/@yc-software/qm/dist/src/manifest.js";
import { missingRequiredSecrets, computedSecrets, secretsForService, runtimeSecretNames } from "../qm/node_modules/@yc-software/qm/dist/src/secrets.js";
import { hostedServiceEnv, virtualServiceEnv } from "../qm/node_modules/@yc-software/qm/dist/src/services.js";
import { readEnvFile } from "../qm/node_modules/@yc-software/qm/dist/src/util.js";

const orbitHome = process.env.ORBIT_HOME ?? join(homedir(), "Library/Application Support/Orbit");
const output = resolve(process.argv[2]);
const initialize = process.argv.includes("--init");
const { config } = loadConfigAt(fileURLToPath(new URL("../qm/qm.config.jsonc", import.meta.url)));
const secrets = readEnvFile(join(orbitHome, "env/qm.env"));
const lookup = (name) => secrets.get(name)?.trim() ? secrets.get(name) : undefined;
const statePath = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "qm/deployments/orbit/state.json");
const existingState = existsSync(statePath);
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const volumeExists = (name) => {
  try { docker("volume", "inspect", name); return true; } catch { return false; }
};

try {
  let state = {};
  if (existingState) {
    try { state = JSON.parse(readFileSync(statePath, "utf8")); }
    catch { throw new Error("QM 상태 파일을 읽을 수 없습니다. 백업을 확인하세요."); }
  }
  // shortcut: QM 0.1.18의 배포 계약을 재사용한다. 버전 변경 시 환경 동일성 검사를 갱신한다.
  if (config.orgId !== "orbit" || config.target !== "docker" || config.basePort !== 18080 || config.publicUrl !== "http://localhost:18082" || config.sandbox || config.plugins.length || config.skills.length || config.model || config.modelProvider) {
    throw new Error("현재 Orbit Compose가 지원하지 않는 QM 설정입니다.");
  }
  const missing = missingRequiredSecrets(computedSecrets(config), lookup);
  if (missing.length) throw new Error(`QM 필수 비밀값 누락: ${missing.join(", ")}`);
  docker("version", "-f", "{{.Server.Version}}");
  let password = state.pgPassword;
  const volumes = ["orbit-pgdata", "qm-orbit-pgdata", "qm-orbit-coredata"];
  const present = volumes.map(volumeExists);
  if (initialize && !present.some(Boolean) && !password) {
    password = randomBytes(16).toString("hex");
    mkdirSync(resolve(statePath, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(statePath, JSON.stringify({ orgId: "orbit", network: "qm-orbit", pgPassword: password }), { mode: 0o600 });
  }
  if (!password || (existingState && !present.some(Boolean)) || (present.some(Boolean) && !present.every(Boolean)) || (!initialize && !present.every(Boolean))) {
    throw new Error("기존 데이터 볼륨 또는 QM DB 비밀번호가 없습니다. 백업과 QM 상태를 확인하세요.");
  }
  const core = {
    ...dockerServiceEnv(config, "core"),
    DATA_DIR: "/data",
    ...virtualServiceEnv(config.services, config.env),
    ...hostedServiceEnv(config.services, config.env, "core"),
    ...securityScreenEnv(config),
  };
  for (const secret of secretsForService(config, "core")) {
    const value = lookup(secret.name);
    if (value !== undefined) for (const key of runtimeSecretNames("core", secret)) core[key] = value;
  }
  if (lookup("CORE_SIGNING_SECRET")) core.CORE_SIGNING_SECRET = lookup("CORE_SIGNING_SECRET");
  core.DATABASE_URL = `postgres://postgres:${password}@pg:5432/qm`;
  const files = {
    "core.env": core,
    "pg.env": { POSTGRES_PASSWORD: password, POSTGRES_DB: "qm" },
    "compose.env": { QM_CORE_IMAGE: config.imageOverrides.core ?? manifestRef("core") },
  };
  mkdirSync(output, { recursive: true, mode: 0o700 });
  for (const [file, values] of Object.entries(files)) {
    for (const [key, value] of Object.entries(values)) {
      if (/[\r\n]/.test(value)) throw new Error(`QM 환경값 ${key}에 줄바꿈이 있습니다.`);
    }
    const path = join(output, file);
    const text = Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n";
    if (!existsSync(path) || readFileSync(path, "utf8") !== text) {
      writeFileSync(`${path}.tmp`, text, { mode: 0o600 });
      renameSync(`${path}.tmp`, path);
    }
    chmodSync(path, 0o600);
  }
  if (initialize) for (const name of volumes) docker("volume", "create", name);
} catch (error) {
  console.error(`qm_env: ${error.message}`);
  process.exitCode = 1;
}
