import { SQL as collector } from "./db/collector.ts";
import { SQL as research } from "./db/research.ts";
import { SQL as router } from "./db/router.ts";

const named = (module: string, sql: Record<string, string>) =>
  Object.fromEntries(Object.entries(sql).map(([name, text]) => [`${module}.${name}`, text]));

/** selfcheck 가 준비해 볼 모든 SQL 문장. */
export const statements: Record<string, string> = {
  ...named("collector", collector),
  ...named("research", research),
  ...named("router", router),
};
