import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export const FAKE_TOKEN = "test-token";

export interface FakeMessage {
  ts: string;
  text: string;
  user?: string;
  thread_ts?: string;
  subtype?: string;
  edited?: { ts: string };
}
type Stored = FakeMessage & { channel: string };

/** Slack Web API 흉내. 페이지를 일부러 작게 잘라 페이지 넘김을 거치게 한다. */
export async function startFakeSlack(pageSize = 3) {
  const channels: { id: string; name: string; is_private: boolean; is_member: boolean }[] = [];
  const messages: Stored[] = [];
  const users = new Map([["U1", "alice"]]);
  const fake = {
    url: "",
    channels,
    messages,
    errors: new Map<string, string>(),
    rateLimit: 0,
    requests: [] as string[],
    add: (channel: string, message: FakeMessage) => {
      messages.push({ channel, ...message });
    },
    edit: (ts: string, text: string, editedTs: string) => {
      for (const m of messages) if (m.ts === ts) Object.assign(m, { text, edited: { ts: editedTs } });
    },
    remove: (ts: string) => {
      const i = messages.findIndex((m) => m.ts === ts);
      if (i >= 0) messages.splice(i, 1);
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };

  function page<T>(items: T[], p: URLSearchParams) {
    const start = Number(p.get("cursor") || 0);
    const end = start + Math.min(Number(p.get("limit") || 100), pageSize);
    const next = end < items.length ? String(end) : "";
    return {
      items: items.slice(start, end),
      has_more: next !== "",
      response_metadata: { next_cursor: next },
    };
  }

  function view({ channel, ...m }: Stored) {
    const replies = messages.filter((r) => r.channel === channel && r.thread_ts === m.ts && r.ts !== m.ts);
    if (replies.length === 0) return m;
    const latest = replies.map((r) => r.ts).sort((a, b) => Number(a) - Number(b));
    return { ...m, thread_ts: m.ts, reply_count: replies.length, latest_reply: latest.at(-1) };
  }

  function handle(method: string, p: URLSearchParams): object {
    const channel = p.get("channel") ?? "";
    const error = fake.errors.get(channel);
    if (error) return { ok: false, error };
    const own = messages.filter((m) => m.channel === channel).sort((a, b) => Number(a.ts) - Number(b.ts));
    switch (method) {
      case "conversations.list": {
        const { items, response_metadata } = page(channels, p);
        return { ok: true, channels: items, response_metadata };
      }
      case "conversations.history": {
        const inclusive = p.get("inclusive") === "true";
        const oldest = Number(p.get("oldest") ?? 0);
        const latest = Number(p.get("latest") ?? Number.POSITIVE_INFINITY);
        const inRange = (ts: number) =>
          inclusive ? ts >= oldest && ts <= latest : ts > oldest && ts < latest;
        const top = own
          .filter((m) => !m.thread_ts || m.thread_ts === m.ts || m.subtype === "thread_broadcast")
          .filter((m) => inRange(Number(m.ts)))
          .reverse();
        const { items, has_more, response_metadata } = page(top.map(view), p);
        return { ok: true, messages: items, has_more, response_metadata };
      }
      case "conversations.replies": {
        const thread = own.filter((m) => m.ts === p.get("ts") || m.thread_ts === p.get("ts"));
        if (thread.length === 0) return { ok: false, error: "thread_not_found" };
        const { items, has_more, response_metadata } = page(thread.map(view), p);
        return { ok: true, messages: items, has_more, response_metadata };
      }
      case "users.info": {
        const name = users.get(p.get("user") ?? "");
        if (!name) return { ok: false, error: "user_not_found" };
        return {
          ok: true,
          user: { id: p.get("user"), name, real_name: name, profile: { display_name: name } },
        };
      }
    }
    return { ok: false, error: "unknown_method" };
  }

  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const method = (req.url ?? "").slice(1);
    fake.requests.push(method);
    if (fake.rateLimit > 0) {
      fake.rateLimit--;
      res.writeHead(429, { "retry-after": "0" }).end();
      return;
    }
    const result =
      req.method === "POST" && req.headers.authorization === `Bearer ${FAKE_TOKEN}`
        ? handle(method, new URLSearchParams(body))
        : { ok: false, error: "invalid_auth" };
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return fake;
}
