import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { migrate, pendingMigrations, selfcheck } from "../src/db.ts";
import { testDb } from "./helpers.ts";

function migrationDir(files: Record<string, string>): URL {
  const dir = mkdtempSync(join(tmpdir(), "orbit-mig-"));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return pathToFileURL(`${dir}/`);
}

test("마이그레이션은 한 번만 적용되고 다시 돌리면 할 일이 없다", async () => {
  const { db } = await testDb({ migrate: false });
  assert.deepEqual(await pendingMigrations(db), ["001_init.sql"]);
  assert.deepEqual(await migrate(db), ["001_init.sql"]);
  assert.deepEqual(await migrate(db), []);
  assert.deepEqual(await pendingMigrations(db), []);
  await db.query("INSERT INTO channels (id, name, kind, is_member) VALUES ('C1', 'general', 'public', true)");
  await db.end();
});

test("대기 마이그레이션 중 하나가 실패하면 앞선 것도 남지 않는다", async () => {
  const { db } = await testDb({ migrate: false });
  const dir = migrationDir({
    "001_ok.sql": "CREATE TABLE a (id int)",
    "002_bad.sql": "CREATE TABLE b (id nope)",
  });
  await assert.rejects(migrate(db, dir));
  const left = await db.query("SELECT to_regclass('a') AS a, to_regclass('schema_migrations') AS m");
  assert.deepEqual(left.rows[0], { a: null, m: null });
  await db.end();
});

test("selfcheck 는 스키마와 맞지 않는 문장의 이름을 알려 준다", async () => {
  const { db } = await testDb();
  await selfcheck(db, { ok: "SELECT name FROM channels WHERE id = $1" });
  await assert.rejects(selfcheck(db, { broken: "SELECT missing FROM channels" }), /selfcheck broken/);
  await db.end();
});
