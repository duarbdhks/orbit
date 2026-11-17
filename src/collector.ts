import type { Config } from "./config.ts";
import { SQL } from "./db/collector.ts";
import type { Db } from "./db.ts";
import { type Slack, SlackError, type SlackMessage } from "./slack.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PAGE = 200;
const LOST = new Set(["not_in_channel", "channel_not_found"]);
// 본문이 있는 subtype만 저장한다. 나머지(channel_join 등)는 시스템 메시지다.
const CONTENT = new Set(["thread_broadcast", "bot_message", "file_share", "me_message"]);

type Source = "backfill" | "incremental" | "reconcile";
interface ChannelState {
  id: string;
  covered_from: Date | null;
  covered_until: Date | null;
}

const ago = (now: Date, ms: number) => new Date(now.getTime() - ms);
const earliest = (...dates: Date[]) => new Date(Math.min(...dates.map((d) => d.getTime())));
const toTs = (d: Date) => (d.getTime() / 1000).toFixed(6);
const kept = (messages: SlackMessage[]) => messages.filter((m) => !m.subtype || CONTENT.has(m.subtype));

export function createCollector(db: Db, slack: Slack, config: Config): { tick(now: Date): Promise<void> } {
  const lastRun = new Map<string, number>();
  const due = (key: string, every: number, now: Date) =>
    now.getTime() - (lastRun.get(key) ?? Number.NEGATIVE_INFINITY) >= every;

  async function upsert(channel: string, messages: SlackMessage[], source: Source) {
    const rows = [];
    for (const m of messages) {
      rows.push({
        ts: m.ts,
        thread_ts: m.thread_ts ?? null,
        user_id: m.user ?? null,
        user_name: m.user ? await slack.userName(m.user) : null,
        text: m.text,
        edited_ts: m.edited?.ts ?? null,
        reply_count: m.reply_count,
        latest_reply: m.latest_reply ?? null,
      });
    }
    await db.query(SQL.upsertMessages, [channel, JSON.stringify(rows), source]);
  }

  /** 메시지와, 답글 수나 마지막 답글이 저장값과 다른 스레드(deep이면 모든 스레드)의 답글을 저장한다. */
  async function save(channel: string, messages: SlackMessage[], source: Source, deep: boolean) {
    const { rows } = await db.query<{ ts: string; reply_count: number; latest_reply: string | null }>(
      SQL.storedThreads,
      [channel, messages.map((m) => m.ts)],
    );
    const stored = new Map(rows.map((r) => [r.ts, r]));
    for (const m of messages) {
      const old = stored.get(m.ts);
      const changed =
        m.reply_count !== (old?.reply_count ?? 0) || (m.latest_reply ?? null) !== (old?.latest_reply ?? null);
      if (!changed && !(deep && m.reply_count > 0)) continue;
      const replies = kept(await slack.replies(channel, m.ts));
      await upsert(channel, replies, source);
      await db.query(SQL.deleteMissingReplies, [channel, m.ts, replies.map((r) => r.ts)]);
    }
    // 부모를 답글 뒤에 저장해야 중간에 실패해도 다음 tick이 바뀐 스레드를 다시 알아본다.
    await upsert(channel, messages, source);
  }

  async function syncChannel(channel: ChannelState, now: Date, daily: boolean, weekly: boolean) {
    try {
      let from = earliest(channel.covered_until ?? now, ago(now, DAY));
      if (daily) from = earliest(from, ago(now, 3 * DAY));
      if (weekly && channel.covered_from) {
        const retained = ago(now, config.ORBIT_RETENTION_DAYS * DAY);
        from = earliest(from, new Date(Math.max(channel.covered_from.getTime(), retained.getTime())));
      }
      const reconcile = daily || weekly;
      const messages = kept(await slack.history(channel.id, toTs(from), toTs(now), PAGE));
      await save(channel.id, messages, reconcile ? "reconcile" : "incremental", reconcile);
      await db.query(SQL.deleteMissingTop, [channel.id, toTs(from), toTs(now), messages.map((m) => m.ts)]);

      let coveredFrom = earliest(from, channel.covered_from ?? from);
      const target = ago(now, config.ORBIT_BACKFILL_DAYS * DAY);
      if (coveredFrom.getTime() > target.getTime()) {
        const page = await slack.historyPage(channel.id, toTs(coveredFrom), PAGE);
        await save(channel.id, kept(page), "backfill", false);
        // shortcut: covered_from이 ms 단위라 같은 ms 안의 더 오래된 메시지는 건너뛸 수 있다, 주간 대조가 메운다
        coveredFrom = page.length ? new Date(Math.min(...page.map((m) => Number(m.ts) * 1000))) : target;
      }
      await db.query(SQL.synced, [channel.id, coveredFrom, now]);
    } catch (e) {
      const code = e instanceof SlackError ? e.code : (e as Error).message;
      if (LOST.has(code)) await db.query(SQL.markLost, [channel.id, now]);
      await db.query(SQL.failed, [channel.id, code]);
    }
  }

  async function discover(now: Date) {
    const channels = await slack.list();
    const rows = channels.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.is_private ? "private" : "public",
      is_member: c.is_member,
    }));
    await db.query(SQL.upsertChannels, [JSON.stringify(rows)]);
    await db.query(SQL.markMissingLost, [channels.map((c) => c.id), now]);
  }

  return {
    async tick(now) {
      const allowed = config.ORBIT_COLLECT_CHANNELS;
      const daily = due("daily", DAY, now);
      try {
        if (allowed.length > 0) {
          if (due("discover", 6 * HOUR, now)) {
            await discover(now);
            lastRun.set("discover", now.getTime());
          }
          const weekly = due("weekly", 7 * DAY, now);
          const { rows } = await db.query<ChannelState>(SQL.activeChannels, [allowed]);
          for (const channel of rows) await syncChannel(channel, now, daily, weekly);
          if (weekly) lastRun.set("weekly", now.getTime());
        }
        await db.query(SQL.purge, [ago(now, 7 * DAY)]);
        if (daily) {
          await db.query(SQL.deleteOldMessages, [ago(now, config.ORBIT_RETENTION_DAYS * DAY)]);
          await db.query(SQL.deleteOrphanKnowledge);
          lastRun.set("daily", now.getTime());
        }
      } finally {
        const s = slack.takeStats();
        const bucket = new Date(Math.floor(now.getTime() / HOUR) * HOUR);
        await db.query(SQL.addStats, [bucket, s.apiCalls, s.rateLimited, s.maxQueueDepth]);
      }
    },
  };
}
