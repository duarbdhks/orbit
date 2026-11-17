import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "./config.ts";
import { authorized, ownerCall } from "./policy.ts";
import { PersonSchema, type Slack, SlackError, SlackMessageSchema } from "./slack.ts";

const Time = z.iso.datetime({ offset: true });
const SlackCode = z.string().regex(/^[a-z][a-z0-9_]{0,99}$/);
export const FindPeopleInput = z.object({ query: z.string().trim().min(1).max(100) });
export const ReadDirectMessagesInput = z
  .object({ user_id: z.string().regex(/^[UW][A-Z0-9]+$/), from: Time, to: Time })
  .refine((a) => Date.parse(a.from) < Date.parse(a.to), "from 은 to 보다 빨라야 합니다")
  .refine((a) => Date.parse(a.to) - Date.parse(a.from) <= 7 * 86_400_000, "한 번에 최대 7일입니다");
const PeopleResult = z.object({
  people: z.array(PersonSchema),
  ambiguous: z.boolean(),
  complete: z.literal(true),
});
const DirectResult = z.object({
  owner_user_id: z.string().min(1),
  user_id: z.string().min(1),
  channel_id: z.string().startsWith("D").nullable(),
  messages: z.array(SlackMessageSchema),
  pagination: z.object({ complete: z.literal(true) }),
  coverage: z.object({
    from: Time,
    to: Time,
    complete: z.boolean(),
    thread_scope: z.literal("roots_in_range"),
    limitations: z.array(z.string()),
  }),
});

export function buildCollectorServer(slack: Slack, config: Config): FastifyInstance {
  const app = Fastify();

  function read<T extends z.ZodType>(path: string, input: T, run: (args: z.output<T>) => Promise<unknown>) {
    app.post(path, async (req, reply) => {
      if (!authorized(req.headers.authorization, config) || !ownerCall(req.headers["x-qm-actor"], config))
        return reply.code(401).send({ error: "unauthorized" });
      const args = input.safeParse(req.body);
      if (!args.success) return reply.code(400).send({ error: "invalid_request" });
      if (!config.ORBIT_OWNER_USER_ID || !config.SLACK_USER_TOKEN)
        return reply.code(503).send({ error: "collector_not_configured" });
      if (!config.ORBIT_ANALYZE_REAL_DATA) return reply.code(403).send({ error: "real_data_disabled" });
      try {
        if ((await slack.authUserId()) !== config.ORBIT_OWNER_USER_ID)
          return reply.code(403).send({ error: "slack_owner_mismatch" });
        return await run(args.data);
      } catch (error) {
        const code = SlackCode.safeParse(error instanceof SlackError ? error.code : undefined);
        return reply.code(502).send({
          error: "slack_read_failed",
          ...(code.success ? { slack_code: code.data } : {}),
        });
      }
    });
  }

  read("/internal/find_people", FindPeopleInput, async ({ query }) => {
    const people = await slack.findPeople(query);
    return PeopleResult.parse({ people, ambiguous: people.length > 1, complete: true });
  });
  read("/internal/read_direct_messages", ReadDirectMessagesInput, async (args) => {
    if (args.user_id === config.ORBIT_OWNER_USER_ID) throw new Error("self_dm_not_supported");
    const channel = await slack.directChannel(args.user_id);
    const from = Date.parse(args.from) / 1000;
    const to = Date.parse(args.to) / 1000;
    const messages = channel ? await slack.history(channel, String(from), String(to), 200) : [];
    const found = new Map(messages.map((m) => [m.ts, m]));
    for (const m of messages) {
      if (!channel || !m.reply_count) continue;
      for (const reply of await slack.repliesInRange(channel, m.ts, String(from), String(to)))
        found.set(reply.ts, reply);
    }
    return DirectResult.parse({
      owner_user_id: config.ORBIT_OWNER_USER_ID,
      user_id: args.user_id,
      channel_id: channel,
      messages: [...found.values()]
        .filter((m) => Number(m.ts) >= from && Number(m.ts) < to)
        .sort((a, b) => Number(a.ts) - Number(b.ts)),
      pagination: { complete: true },
      coverage: {
        from: args.from,
        to: args.to,
        complete: channel === null,
        thread_scope: "roots_in_range",
        limitations: channel
          ? ["기간 이전에 시작된 DM 스레드의 답글은 이 기간 조회로 발견할 수 없습니다."]
          : [],
      },
    });
  });
  return app;
}

export function createLiveSlackClient(config: Config, fetcher: typeof fetch = fetch) {
  async function read<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    if (!config.ORBIT_API_TOKEN || !config.ORBIT_OWNER_PRINCIPAL || !config.ORBIT_OWNER_USER_ID)
      throw new Error("collector_not_configured");
    if (!config.ORBIT_ANALYZE_REAL_DATA) throw new Error("real_data_disabled");
    let response: Response;
    try {
      response = await fetcher(`${config.ORBIT_COLLECTOR_URL.replace(/\/+$/, "")}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.ORBIT_API_TOKEN}`,
          "x-qm-actor": config.ORBIT_OWNER_PRINCIPAL,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new Error("collector_unavailable");
    }
    if (!response.ok) {
      const error = z.object({ slack_code: SlackCode }).safeParse(await response.json().catch(() => null));
      throw new Error(
        `collector_read_failed_http_${response.status}${error.success ? `: ${error.data.slack_code}` : ""}`,
      );
    }
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new Error("collector_invalid_response");
    return parsed.data;
  }

  return {
    findPeople: (args: z.infer<typeof FindPeopleInput>) => read("/internal/find_people", args, PeopleResult),
    async readDirectMessages(args: z.infer<typeof ReadDirectMessagesInput>) {
      const result = await read("/internal/read_direct_messages", args, DirectResult);
      if (
        result.owner_user_id !== config.ORBIT_OWNER_USER_ID ||
        result.user_id !== args.user_id ||
        result.coverage.from !== args.from ||
        result.coverage.to !== args.to ||
        (result.messages.length > 0 && result.channel_id === null) ||
        result.messages.some(
          (m) => Number(m.ts) < Date.parse(args.from) / 1000 || Number(m.ts) >= Date.parse(args.to) / 1000,
        )
      )
        throw new Error("collector_invalid_response");
      return result;
    },
  };
}
