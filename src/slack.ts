import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";

const Channel = z.object({
  id: z.string(),
  name: z.string(),
  is_private: z.boolean(),
  is_member: z.boolean().default(false),
});
export const SlackMessageSchema = z.object({
  ts: z
    .string()
    .regex(/^\d+(?:\.\d+)?$/)
    .refine((ts) => Number.isFinite(new Date(Number(ts) * 1000).getTime())),
  thread_ts: z.string().optional(),
  user: z.string().optional(),
  text: z.string().default(""),
  subtype: z.string().optional(),
  edited: z.object({ ts: z.string() }).optional(),
  reply_count: z.number().int().default(0),
  latest_reply: z.string().optional(),
});
export type SlackChannel = z.infer<typeof Channel>;
export type SlackMessage = z.infer<typeof SlackMessageSchema>;
export const PersonSchema = z.object({
  user_id: z.string().min(1),
  username: z.string(),
  real_name: z.string(),
  display_name: z.string(),
});
export type SlackPerson = z.infer<typeof PersonSchema>;

const Ok = z.object({ ok: z.boolean(), error: z.string().optional() });
const Cursor = z.object({ next_cursor: z.string().optional() }).optional();
const ChannelInfo = z.object({ channel: Channel }).transform((b) => b.channel);
const Messages = z
  .object({
    messages: z.array(SlackMessageSchema),
    response_metadata: Cursor,
    has_more: z.boolean().optional(),
  })
  .refine((b) => !b.has_more || Boolean(b.response_metadata?.next_cursor?.trim()))
  .transform((b) => ({ items: b.messages, cursor: b.response_metadata?.next_cursor }));
const User = z.object({
  user: z.object({
    name: z.string(),
    real_name: z.string().optional(),
    profile: z.object({ display_name: z.string().optional() }).optional(),
  }),
});
const People = z
  .object({
    members: z.array(
      User.shape.user.extend({
        id: z.string().min(1),
        deleted: z.boolean().default(false),
        is_bot: z.boolean().default(false),
      }),
    ),
    response_metadata: Cursor,
  })
  .transform((b) => ({ items: b.members, cursor: b.response_metadata?.next_cursor }));
const Directs = z
  .object({
    channels: z.array(
      z.object({
        id: z.string().startsWith("D"),
        user: z.string().min(1),
        is_im: z.literal(true),
        is_mpim: z.literal(false).optional(),
      }),
    ),
    response_metadata: Cursor,
    has_more: z.boolean().optional(),
  })
  .refine((b) => !b.has_more || Boolean(b.response_metadata?.next_cursor?.trim()))
  .transform((b) => ({ items: b.channels, cursor: b.response_metadata?.next_cursor }));

export class SlackError extends Error {
  code: string;
  constructor(method: string, code: string) {
    super(`slack ${method}: ${code}`);
    this.code = code;
  }
}

export interface Slack {
  authUserId(): Promise<string>;
  findPeople(query: string): Promise<SlackPerson[]>;
  directChannel(userId: string): Promise<string | null>;
  info(channel: string): Promise<SlackChannel>;
  history(channel: string, oldest: string, latest: string, limit: number): Promise<SlackMessage[]>;
  historyPage(channel: string, latest: string, limit: number): Promise<SlackMessage[]>;
  replies(channel: string, threadTs: string): Promise<SlackMessage[]>;
  repliesInRange(channel: string, threadTs: string, oldest: string, latest: string): Promise<SlackMessage[]>;
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
    const seen = new Set<string>();
    let cursor = "";
    do {
      const page = await call(method, cursor ? { ...params, cursor } : params, schema);
      out.push(...page.items);
      cursor = page.cursor?.trim() ?? "";
      if (cursor && seen.has(cursor)) throw new SlackError(method, "repeated_cursor");
      seen.add(cursor);
    } while (cursor);
    return out;
  }

  return {
    authUserId: () =>
      call(
        "auth.test",
        {},
        z.object({ user_id: z.string().min(1) }).transform((b) => b.user_id),
      ),
    async findPeople(query) {
      const needle = query.normalize("NFKC").toLocaleLowerCase();
      return (await all("users.list", { limit: "200" }, People))
        .filter(
          (u) =>
            !u.deleted &&
            !u.is_bot &&
            [u.name, u.real_name, u.profile?.display_name].some((name) =>
              name?.normalize("NFKC").toLocaleLowerCase().includes(needle),
            ),
        )
        .map((u) => ({
          user_id: u.id,
          username: u.name,
          real_name: u.real_name ?? "",
          display_name: u.profile?.display_name ?? "",
        }));
    },
    async directChannel(userId) {
      const matches = (await all("users.conversations", { types: "im", limit: "200" }, Directs)).filter(
        (c) => c.user === userId,
      );
      if (matches.length > 1) throw new SlackError("users.conversations", "ambiguous_dm");
      return matches[0]?.id ?? null;
    },
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
    repliesInRange: (channel, threadTs, oldest, latest) =>
      all(
        "conversations.replies",
        { channel, ts: threadTs, oldest, latest, inclusive: "true", limit: "200" },
        Messages,
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
