import { SQL as collector } from "./db/collector.ts";

const named = (module: string, sql: Record<string, string>) =>
  Object.fromEntries(Object.entries(sql).map(([name, text]) => [`${module}.${name}`, text]));

/** selfcheck 가 준비해 볼 모든 SQL 문장. */
export const statements: Record<string, string> = { ...named("collector", collector) };
