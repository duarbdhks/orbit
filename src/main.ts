import { setTimeout as sleep } from "node:timers/promises";
import { createCollector } from "./collector.ts";
import { loadConfig } from "./config.ts";
import { connect, migrate, pendingMigrations, selfcheck } from "./db.ts";
import { createJev } from "./jev.ts";
import { classifyPass } from "./research.ts";
import { createAdvise } from "./router.ts";
import { loadSample } from "./sample.ts";
import { buildServer } from "./server.ts";
import { createSlack, SlackError } from "./slack.ts";
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
  case "api": {
    const jev = createJev(db, config);
    const advise = createAdvise(db, config, jev);
    await buildServer(db, config, jev).listen({ host: "0.0.0.0", port: config.PORT });
    for (;;) {
      try {
        await classifyPass(db, config, { advise });
      } catch (e) {
        console.error(`classify pass 실패: ${(e as { code?: string }).code ?? (e as Error).name}`);
      }
      await sleep(30_000);
    }
  }
  case "sample":
    await loadSample(db);
    await db.end();
    break;
  case "collector": {
    const slack = createSlack({ token: config.SLACK_USER_TOKEN, baseUrl: config.SLACK_API_BASE });
    const collector = createCollector(db, slack, config);
    for (;;) {
      try {
        await collector.tick(new Date());
      } catch (e) {
        // 오류 메시지에는 본문 조각이 섞일 수 있어 코드나 종류만 남긴다.
        console.error(`collector tick 실패: ${e instanceof SlackError ? e.code : (e as Error).name}`);
      }
      await sleep(300_000);
    }
  }
  default:
    console.error("사용법: node src/main.ts migrate [--pending] | selfcheck | api | collector | sample");
    process.exit(2);
}
