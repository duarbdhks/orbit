import { createHmac } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { classify } from "./classify.ts";
import type { Config } from "./config.ts";
import { SQL } from "./db/research.ts";
import type { Db } from "./db.ts";
import { modelAllowed, permalink } from "./policy.ts";
import type { Classification, Message } from "./types.ts";

export type Advise = (message: Message, rules: Classification) => Promise<Classification>;

type Pending = Message & {
  is_sample: boolean;
  duplicate: boolean;
  thread_started_by_owner: boolean;
  owner_replied_after: boolean;
};

export async function classifyPass(
  db: Db,
  config: Config,
  deps: { advise?: Advise; fetch?: typeof fetch } = {},
): Promise<void> {
  const owner = config.ORBIT_OWNER_USER_ID;
  const { rows } = await db.query<Pending>(SQL.unclassified, [owner]);
  for (const m of rows) {
    const rules = classify(m, {
      ownerUserId: owner,
      duplicate: m.duplicate,
      threadStartedByOwner: m.thread_started_by_owner,
      ownerRepliedAfter: m.owner_replied_after,
    });
    // advise 도 모델 호출이므로 모델 전송이 허용된 채널 원문만 넘기고, 실패하면 규칙 결과를 쓴다.
    const c =
      deps.advise && modelAllowed({ id: m.channel_id, is_sample: m.is_sample }, config)
        ? await deps.advise(m, rules).catch(() => rules)
        : rules;
    await db.query(SQL.insertClassification, [
      m.channel_id,
      m.ts,
      c.work_related,
      c.importance,
      c.urgency,
      c.is_new,
      c.conflicts,
      c.needs_research,
      c.awaits_owner,
      c.route,
      c.reasons,
      isDeepStrictEqual(c, rules) ? "rules" : "jev",
    ]);
  }

  const url = config.ORBIT_QM_WEBHOOK_URL;
  if (!url) return;
  const send = deps.fetch ?? fetch;
  const alerts = await db.query<{ id: number; channel_id: string; ts: string; thread_ts: string | null }>(
    SQL.unsentAlerts,
  );
  for (const a of alerts.rows) {
    const body = JSON.stringify({
      alert_id: a.id,
      permalink: permalink(config, a.channel_id, a.ts, a.thread_ts),
    });
    const signature = createHmac("sha256", config.ORBIT_QM_WEBHOOK_SECRET).update(body).digest("hex");
    const sent = await send(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": `sha256=${signature}` },
      body,
      signal: AbortSignal.timeout(10_000),
    }).then(
      async (res) => {
        await res.body?.cancel();
        return res.ok;
      },
      () => false,
    );
    if (sent) await db.query(SQL.markWebhookSent, [a.id]);
  }
}
