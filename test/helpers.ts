import { randomBytes } from "node:crypto";
import pg from "pg";
import { connect, type Db, migrate } from "../src/db.ts";

/** 이 테스트만 쓰는 데이터베이스를 만든다. Postgres 자체를 테스트 끝에 버리므로 지우지 않는다. */
export async function testDb(options = { migrate: true }): Promise<{ db: Db; url: string }> {
  const admin = process.env.TEST_DATABASE_URL;
  if (!admin) throw new Error("TEST_DATABASE_URL 이 없습니다. npm test 로 실행하세요.");
  const name = `t_${randomBytes(6).toString("hex")}`;
  const root = new pg.Client({ connectionString: admin });
  await root.connect();
  await root.query(`CREATE DATABASE ${name}`);
  await root.end();
  const url = new URL(admin);
  url.pathname = `/${name}`;
  const db = connect(url.toString());
  if (options.migrate) await migrate(db);
  return { db, url: url.toString() };
}
