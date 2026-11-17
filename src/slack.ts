import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";

const Channel = z.object({
  id: z.string(),
  name: z.string(),
  is_private: z.boolean(),
  is_member: z.boolean().default(false),
});
const Message = z.object({
  ts: z.string(),
  thread_ts: z.string().optional(),
  user: z.string().optional(),
  text: z.string().default(""),
  subtype: z.string().optional(),
  edited: z.object({ ts: z.string() }).optional(),
  reply_count: z.number().int().default(0),
  latest_reply: z.string().optional(),
});
export type SlackChannel = z.infer<typeof Channel>;
export type SlackMessage = z.infer<typeof Message>;

const Ok = z.object({ ok: z.boolean(), error: z.string().optional() });
const Cursor = z.object({ next_cursor: z.string() }).optional();
const ChannelInfo = z.object({ channel: Channel }).transform((b) => b.channel);
const Messages = z
  .object({ messages: z.array(Message), response_metadata: Cursor })
  .transform((b) => ({ items: b.messages, cursor: b.response_metadata?.next_cursor }));
const User = z.object({
  user: z.object({
    name: z.string(),
    real_name: z.string().optional(),
    profile: z.object({ display_name: z.string().optional() }).optional(),
  }),
});

export class SlackError extends Error {
  code: string;
  constructor(method: string, code: string) {
    super(`slack ${method}: ${code}`);
    this.code = code;
  }
}

export interface Slack {
  info(channel: string): Promise<SlackChannel>;
  history(channel: string, oldest: string, latest: string, limit: number): Promise<SlackMessage[]>;
  historyPage(channel: string, latest: string, limit: number): Promise<SlackMessage[]>;
  replies(channel: string, threadTs: string): Promise<SlackMessage[]>;
  userName(userId: string): Promise<string | null>;
  takeStats(): { apiCalls: number; rateLimited: number; maxQueueDepth: number };
}

export function createSlack(options: { token: string; baseUrl: string }): Slack {
  let stats = { apiCalls: 0, rateLimited: 0, maxQueueDepth: 0 };
  let queue: Promise<unknown> = Promise.resolve();
  let depth = 0;
  const names = new Map<string, string | null>();

  async function send<T>(method: string, params: Record<string, string>, schema: z.ZodType<T>): Promise<T> {
    for (;;) {
      stats.apiCalls++;
      const res = await fetch(`${options.baseUrl}/${method}`, {
        method: "POST",
        headers: { authorization: `Bearer ${options.token}` },
        body: new URLSearchParams(params),
        // 응답 없는 연결 하나가 전역 큐 전체를 멈추지 않게 한다.
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429) {
        stats.rateLimited++;
        await res.body?.cancel();
        await sleep(Number(res.headers.get("retry-after") ?? 1) * 1000);
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new SlackError(method, `http_${res.status}`);
      }
      // JSON 파싱 오류 메시지에는 본문 조각이 들어가므로 코드로 바꾼다.
      const json: unknown = await res.json().catch(() => null);
      const head = Ok.safeParse(json);
      if (!head.success) throw new SlackError(method, "invalid_response");
      if (!head.data.ok) throw new SlackError(method, head.data.error ?? "unknown_error");
      const body = schema.safeParse(json);
      if (!body.success) throw new SlackError(method, "invalid_response");
      return body.data;
    }
  }

  function call<T>(method: string, params: Record<string, string>, schema: z.ZodType<T>): Promise<T> {
    depth++;
    stats.maxQueueDepth = Math.max(stats.maxQueueDepth, depth);
    const run = queue.then(() => send(method, params, schema));
    const done = () => {
      depth--;
    };
    queue = run.then(done, done);
    return run;
  }

  async function all<T>(
    method: string,
    params: Record<string, string>,
    schema: z.ZodType<{ items: T[]; cursor?: string }>,
  ): Promise<T[]> {
    const out: T[] = [];
    let cursor = "";
    do {
      const page = await call(method, cursor ? { ...params, cursor } : params, schema);
      out.push(...page.items);
      cursor = page.cursor ?? "";
    } while (cursor);
    return out;
  }

  return {
    // 워크스페이스 전체 목록(conversations.list)은 채널 530개에서 117회 호출, 약 12분이 걸려 수집을 막았다.
    info: (channel) => call("conversations.info", { channel }, ChannelInfo),
    history: (channel, oldest, latest, limit) =>
      all(
        "conversations.history",
        { channel, oldest, latest, limit: String(limit), inclusive: "true" },
        Messages,
      ),
    historyPage: async (channel, latest, limit) =>
      (await call("conversations.history", { channel, latest, limit: String(limit) }, Messages)).items,
    replies: async (channel, threadTs) =>
      (await all("conversations.replies", { channel, ts: threadTs, limit: "200" }, Messages)).filter(
        (m) => m.ts !== threadTs,
      ),
    async userName(userId) {
      if (names.has(userId)) return names.get(userId) ?? null;
      let name: string | null = null;
      try {
        const { user } = await call("users.info", { user: userId }, User);
        name = user.profile?.display_name || user.real_name || user.name;
      } catch (e) {
        // 지워진 외부 사용자 하나 때문에 채널 수집이 계속 실패하지 않게 한다.
        if (!(e instanceof SlackError && e.code === "user_not_found")) throw e;
      }
      names.set(userId, name);
      return name;
    },
    takeStats() {
      const taken = stats;
      stats = { apiCalls: 0, rateLimited: 0, maxQueueDepth: 0 };
      return taken;
    },
  };
}
