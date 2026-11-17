import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

pg.types.setTypeParser(pg.types.builtins.INT8, Number);

export type Db = pg.Pool;

export const connect = (url: string): Db => new pg.Pool({ connectionString: url, max: 5 });

const MIGRATIONS = new URL("../migrations/", import.meta.url);

async function migrationFiles(dir: URL): Promise<string[]> {
  return (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
}

export async function pendingMigrations(db: Db, dir: URL = MIGRATIONS): Promise<string[]> {
  const exists = await db.query("SELECT to_regclass('schema_migrations') AS t");
  const done = exists.rows[0].t
    ? new Set((await db.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name))
    : new Set();
  return (await migrationFiles(dir)).filter((f) => !done.has(f));
}

/** 대기 중인 마이그레이션 전부를 트랜잭션 하나로 적용한다. 하나라도 실패하면 아무것도 남지 않는다. */
export async function migrate(db: Db, dir: URL = MIGRATIONS): Promise<string[]> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(727271)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    const pending = (await migrationFiles(dir)).filter((f) => !done.has(f));
    for (const name of pending) {
      await client.query(await readFile(new URL(name, dir), "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
    }
    await client.query("COMMIT");
    return pending;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** 이 코드가 쓰는 모든 SQL 문장이 지금 스키마에서 준비되는지 확인한다. 배포 전에 구버전 코드로도 돌린다. */
export async function selfcheck(db: Db, statements: Record<string, string>): Promise<void> {
  const client = await db.connect();
  try {
    for (const [name, sql] of Object.entries(statements)) {
      try {
        await client.query(`PREPARE selfcheck AS ${sql}`);
        await client.query("DEALLOCATE selfcheck");
      } catch (e) {
        throw new Error(`selfcheck ${name}: ${(e as Error).message}`);
      }
    }
  } finally {
    client.release();
  }
}
