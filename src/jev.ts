import { z } from "zod";
import type { Config } from "./config.ts";
import { SQL } from "./db/router.ts";
import type { Db } from "./db.ts";

export const JEV_URL = "https://openrouter.ai/api/alpha/decisions";
export const JEV_MODEL = "typesafe/jev-1.14";

export type JevQuestions = Record<
  string,
  { type: "choice"; instructions: string; criteria: Record<string, string> }
>;
export interface JevResult {
  answers: Record<string, { choice: string; probabilities: Record<string, number> }>;
  costUsd: number;
  inputTokens: number;
}

const USD_PER_INPUT_TOKEN = 0.042e-6;

const Usage = z.object({
  usage: z.object({
    cost: z.number().nonnegative().optional(),
    input_tokens: z.number().int().nonnegative().optional(),
  }),
});
const Answers = z.object({
  answers: z.record(
    z.string(),
    z
      .object({
        type: z.literal("choice"),
        choice: z.string(),
        probabilities: z.record(z.string(), z.number().min(0).max(1)),
      })
      .transform(({ choice, probabilities }) => ({ choice, probabilities })),
  ),
});

const sameKeys = (a: string[], b: string[]) => a.length === b.length && a.every((k) => b.includes(k));

function matches(questions: JevQuestions, answers: JevResult["answers"]): boolean {
  const ids = Object.keys(questions);
  if (!sameKeys(ids, Object.keys(answers))) return false;
  return ids.every((id) => {
    const { choice, probabilities } = answers[id] as JevResult["answers"][string];
    const values = Object.values(probabilities);
    const sum = values.reduce((s, v) => s + v, 0);
    return (
      sameKeys(Object.keys(questions[id]?.criteria ?? {}), Object.keys(probabilities)) &&
      Math.abs(sum - 1) <= 0.05 &&
      probabilities[choice] === Math.max(...values)
    );
  });
}

const kstDay = (now: Date): string => new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

/** 1위 확률이 0.6 이상이고 2위보다 0.2 이상 앞서야 Jev 답을 믿는다. */
export function confident(probabilities: Record<string, number>): boolean {
  const [first = 0, second = 0] = Object.values(probabilities).sort((a, b) => b - a);
  // 0.6 - 0.4 같은 경계가 부동소수 오차로 떨어지지 않게 한다.
  return first >= 0.6 - 1e-9 && first - second >= 0.2 - 1e-9;
}

export function createJev(db: Db, config: Config, fetchImpl: typeof fetch = fetch) {
  return {
    async decide(state: unknown, questions: JevQuestions, now = new Date()): Promise<JevResult | null> {
      const budget = config.ORBIT_JEV_DAILY_BUDGET_USD;
      if (!config.ORBIT_JEV_ENABLED || budget <= 0 || !config.OPENROUTER_API_KEY) return null;
      const day = kstDay(now);
      // shortcut: 동시에 나간 요청끼리는 예산을 나눠 보지 않아 진행 중인 건수만큼 넘을 수 있다, 동시 호출이 잦아지면 행 잠금으로 예약한다.
      const spent = (await db.query(SQL.jevSpentToday, [day])).rows[0]?.cost_usd ?? 0;
      if (spent >= budget) return null;

      let res: Response;
      try {
        res = await fetchImpl(JEV_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ model: JEV_MODEL, state, questions }),
          redirect: "manual",
          signal: AbortSignal.timeout(3_500),
        });
      } catch {
        return null;
      }
      const body: unknown = await res.json().catch(() => null);
      const usage = Usage.safeParse(body).data?.usage;
      const inputTokens = usage?.input_tokens ?? 0;
      const costUsd = usage?.cost ?? inputTokens * USD_PER_INPUT_TOKEN;
      await db.query(SQL.addJevUsage, [day, costUsd, inputTokens]);

      if (!res.ok) return null;
      const parsed = Answers.safeParse(body);
      if (!parsed.success || !matches(questions, parsed.data.answers)) return null;
      return { answers: parsed.data.answers, costUsd, inputTokens };
    },
  };
}
