import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const dir = mkdtempSync(join(tmpdir(), "orbit-pg-"));
const port = 20000 + Math.floor(Math.random() * 20000);
const postgres = new EmbeddedPostgres({
  databaseDir: join(dir, "data"),
  user: "postgres",
  password: "postgres",
  port,
  persistent: false,
  onLog: () => {},
});

process.exitCode = 1;
try {
  await postgres.initialise();
  await postgres.start();
  const files = process.argv.slice(2);
  const run = spawnSync(process.execPath, ["--test", ...(files.length ? files : ["test/*.test.ts"])], {
    stdio: "inherit",
    env: { ...process.env, TEST_DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${port}/postgres` },
  });
  process.exitCode = run.status ?? 1;
} finally {
  await postgres.stop();
  rmSync(dir, { recursive: true, force: true });
}
