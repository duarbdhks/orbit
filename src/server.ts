import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { createJev } from "./jev.ts";
import { registerMcp } from "./mcp.ts";
import { registerDecisions } from "./router.ts";

export function buildServer(db: Db, config: Config, jev = createJev(db, config)): FastifyInstance {
  const app = Fastify();
  app.get("/healthz", async () => {
    await db.query("SELECT 1");
    return { ok: true };
  });
  registerMcp(app, db, config);
  registerDecisions(app, db, config, jev);
  return app;
}
