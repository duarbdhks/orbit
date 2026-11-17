import Fastify, { type FastifyInstance } from "fastify";
import type { Db } from "./db.ts";

export function buildServer(db: Db): FastifyInstance {
  const app = Fastify();
  app.get("/healthz", async () => {
    await db.query("SELECT 1");
    return { ok: true };
  });
  return app;
}
