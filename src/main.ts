import { loadConfig } from "./config.ts";
import { connect, migrate, pendingMigrations, selfcheck } from "./db.ts";
import { buildServer } from "./server.ts";
import { statements } from "./sql.ts";

const [command, option] = process.argv.slice(2);
const config = loadConfig();
const db = connect(config.DATABASE_URL);

switch (command) {
  case "migrate": {
    const names = option === "--pending" ? await pendingMigrations(db) : await migrate(db);
    for (const name of names) console.log(name);
    await db.end();
    break;
  }
  case "selfcheck":
    await selfcheck(db, statements);
    await db.end();
    break;
  case "api":
    await buildServer(db).listen({ host: "0.0.0.0", port: config.PORT });
    break;
  default:
    console.error("사용법: node src/main.ts migrate [--pending] | selfcheck | api");
    process.exit(2);
}
