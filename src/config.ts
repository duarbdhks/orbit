import { z } from "zod";
import { ROUTER_MODES } from "./types.ts";

const flag = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");
const list = z
  .string()
  .default("")
  .transform((v) =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().default(8787),
  ORBIT_API_TOKEN: z.string().default(""),
  ORBIT_OWNER_PRINCIPAL: z.string().default(""),
  ORBIT_OWNER_USER_ID: z.string().default(""),
  SLACK_USER_TOKEN: z.string().default(""),
  SLACK_API_BASE: z.string().default("https://slack.com/api"),
  ORBIT_SLACK_BASE_URL: z.string().default("https://slack.com"),
  ORBIT_COLLECT_CHANNELS: list,
  ORBIT_BACKFILL_DAYS: z.coerce.number().int().positive().default(30),
  ORBIT_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
  ORBIT_ANALYZE_REAL_DATA: flag,
  ORBIT_ANALYZE_CHANNELS: list,
  ORBIT_QM_WEBHOOK_URL: z.string().default(""),
  ORBIT_QM_WEBHOOK_SECRET: z.string().default(""),
  ORBIT_ROUTER_MODE: z.enum(ROUTER_MODES).default("shadow"),
  ORBIT_JEV_ENABLED: flag,
  ORBIT_JEV_DAILY_BUDGET_USD: z.coerce.number().min(0).default(0),
  OPENROUTER_API_KEY: z.string().default(""),
});

export type Config = z.infer<typeof Env>;

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => Env.parse(env);
