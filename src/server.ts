import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { registerMcp } from "./mcp.ts";

export function buildServer(db: Db, config: Config): FastifyInstance {
  const app = Fastify();
  app.get("/healthz", async () => {
    await db.query("SELECT 1");
    return { ok: true };
  });
  registerMcp(app, db, config);
  return app;
}
