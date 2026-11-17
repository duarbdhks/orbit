import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { lintMigration } from "../src/migrations-lint.ts";

test("추가만 하는 마이그레이션은 통과한다", () => {
  assert.deepEqual(lintMigration("ALTER TABLE a ADD COLUMN b text; -- DROP 은 주석이다"), []);
  assert.deepEqual(lintMigration("ALTER TABLE a ADD COLUMN b text NOT NULL DEFAULT ''"), []);
});

test("구버전 코드를 깨뜨리는 변경을 막는다", () => {
  for (const sql of [
    "DROP TABLE a",
    "ALTER TABLE a RENAME COLUMN b TO c",
    "ALTER TABLE a ALTER COLUMN b TYPE bigint",
    "CREATE INDEX CONCURRENTLY i ON a (b)",
    "ALTER TABLE a ADD COLUMN b text NOT NULL",
  ])
    assert.equal(lintMigration(sql).length, 1, sql);
});

test("저장소의 마이그레이션은 모두 lint 를 통과한다", () => {
  const dir = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(dir))
    assert.deepEqual(lintMigration(readFileSync(new URL(name, dir), "utf8")), [], name);
});
