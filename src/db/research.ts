const MESSAGE =
  "m.channel_id, m.ts, m.thread_ts, m.user_id, m.user_name, m.text, m.posted_at, ch.name AS channel_name, ch.is_sample";
const MESSAGE_FROM = "messages m JOIN channels ch ON ch.id = m.channel_id";

export const SQL = {
  unclassified: `SELECT ${MESSAGE},
      EXISTS (SELECT 1 FROM messages d WHERE d.text = m.text
        AND (d.posted_at, d.channel_id, d.ts) < (m.posted_at, m.channel_id, m.ts)) AS duplicate,
      EXISTS (SELECT 1 FROM messages p WHERE p.channel_id = m.channel_id AND p.ts = m.thread_ts
        AND p.user_id = $1::text) AS thread_started_by_owner,
      EXISTS (SELECT 1 FROM messages r WHERE r.channel_id = m.channel_id AND r.thread_ts = coalesce(m.thread_ts, m.ts)
        AND r.user_id = $1::text AND r.posted_at > m.posted_at) AS owner_replied_after
    FROM ${MESSAGE_FROM}
    WHERE NOT EXISTS (SELECT 1 FROM classifications c WHERE c.channel_id = m.channel_id AND c.ts = m.ts)
    ORDER BY m.posted_at, m.channel_id, m.ts
    LIMIT 500`,
  insertClassification: `WITH c AS (
      INSERT INTO classifications (channel_id, ts, work_related, importance, urgency, is_new, conflicts,
        needs_research, awaits_owner, route, reasons, source)
      -- 분류하는 사이 수집기가 지운 메시지는 건너뛴다.
      SELECT $1::text, $2::text, $3, $4, $5, $6, $7, $8, $9, $10, $11::text[], $12
      WHERE EXISTS (SELECT 1 FROM messages m WHERE m.channel_id = $1::text AND m.ts = $2::text)
      ON CONFLICT DO NOTHING
      RETURNING channel_id, ts, route)
    INSERT INTO alerts (channel_id, ts)
    SELECT c.channel_id, c.ts FROM c JOIN messages m ON m.channel_id = c.channel_id AND m.ts = c.ts
    WHERE c.route = 'notify_now' AND m.posted_at > now() - interval '1 hour'
    ON CONFLICT DO NOTHING`,
  unsentAlerts: `SELECT a.id, a.channel_id, a.ts, m.thread_ts
    FROM alerts a JOIN messages m ON m.channel_id = a.channel_id AND m.ts = a.ts
    WHERE a.webhook_sent_at IS NULL ORDER BY a.id`,
  markWebhookSent: "UPDATE alerts SET webhook_sent_at = now() WHERE id = $1 AND webhook_sent_at IS NULL",
  channels: `SELECT ch.id, ch.name, ch.is_sample, ch.access_state,
      s.covered_from, s.covered_until, s.last_error
    FROM channels ch LEFT JOIN sync_state s ON s.channel_id = ch.id ORDER BY ch.id`,
  searchMessages: `SELECT ${MESSAGE},
      to_char(m.posted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_posted_at
    FROM ${MESSAGE_FROM}
    WHERE m.channel_id = ANY($1::text[]) AND ($2::text IS NULL OR m.text ILIKE '%' || $2 || '%')
      AND ($3::text IS NULL OR m.channel_id = $3)
      AND ($4::timestamptz IS NULL OR m.posted_at >= $4)
      AND ($5::timestamptz IS NULL OR m.posted_at < $5)
      AND ($7::text IS NULL OR m.user_id = $7)
      AND ($8::text IS NULL OR (
        EXISTS (SELECT 1 FROM messages p WHERE p.channel_id = m.channel_id
          AND (p.ts = coalesce(m.thread_ts, m.ts) OR p.thread_ts = coalesce(m.thread_ts, m.ts)) AND p.user_id = $8
          AND ($5::timestamptz IS NULL OR p.posted_at < $5))
        AND EXISTS (SELECT 1 FROM messages o WHERE o.channel_id = m.channel_id
          AND (o.ts = coalesce(m.thread_ts, m.ts) OR o.thread_ts = coalesce(m.thread_ts, m.ts)) AND o.user_id = $9::text
          AND ($5::timestamptz IS NULL OR o.posted_at < $5))))
      AND ($10::timestamptz IS NULL OR (m.posted_at, m.channel_id, m.ts) < ($10, $11::text, $12::text))
    ORDER BY m.posted_at DESC, m.channel_id DESC, m.ts DESC LIMIT $6::int`,
  thread: `WITH root AS (
      SELECT coalesce((SELECT thread_ts FROM messages WHERE channel_id = $1::text AND ts = $2::text), $2::text) AS ts)
    SELECT ${MESSAGE} FROM ${MESSAGE_FROM} CROSS JOIN root
    WHERE m.channel_id = $1::text AND (m.ts = root.ts OR m.thread_ts = root.ts)
    ORDER BY m.posted_at, m.ts`,
  listKnowledge: `SELECT k.id, k.kind, k.decision_state, k.title, k.summary, k.project, k.owner, k.suggested_reply,
      k.supersedes, k.created_at, k.briefed_at,
      coalesce(array_agg(e.permalink ORDER BY e.channel_id, e.ts) FILTER (WHERE e.permalink IS NOT NULL), '{}')
        AS permalinks,
      coalesce(bool_or(c.awaits_owner), false) AS awaits_owner
    FROM knowledge_items k
    LEFT JOIN knowledge_evidence e ON e.item_id = k.id
    LEFT JOIN classifications c ON c.channel_id = e.channel_id AND c.ts = e.ts
    WHERE ($1::text IS NULL OR k.kind = $1) AND ($2::timestamptz IS NULL OR k.created_at >= $2)
      AND ($3::boolean IS NOT TRUE OR k.briefed_at IS NULL)
    GROUP BY k.id
    HAVING ($4::boolean IS NULL OR coalesce(bool_or(c.awaits_owner), false) = $4)
    ORDER BY k.created_at DESC, k.id DESC
    LIMIT 200`,
  claimUnanalyzed: `SELECT ${MESSAGE}, c.route, c.reasons
    FROM classifications c JOIN ${MESSAGE_FROM} ON m.channel_id = c.channel_id AND m.ts = c.ts
    WHERE c.analyzed_at IS NULL AND c.route <> 'hold' AND c.channel_id = ANY($1::text[])
    ORDER BY c.classified_at, m.posted_at LIMIT $2::int`,
  evidenceMessages: `SELECT channel_id, ts, thread_ts FROM messages
    WHERE (channel_id, ts) IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
  insertItem: `INSERT INTO knowledge_items (kind, decision_state, title, summary, project, owner, suggested_reply, supersedes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
  insertEvidence: `INSERT INTO knowledge_evidence (item_id, channel_id, ts, permalink)
    SELECT $1::bigint, u.c, u.t, u.p FROM unnest($2::text[], $3::text[], $4::text[]) AS u(c, t, p)
    ON CONFLICT DO NOTHING`,
  markAnalyzed: `UPDATE classifications c SET analyzed_at = coalesce(c.analyzed_at, now())
    FROM unnest($1::text[], $2::text[]) AS u(channel_id, ts)
    WHERE c.channel_id = u.channel_id AND c.ts = u.ts`,
  alert: `SELECT a.id AS alert_id, ${MESSAGE}, c.route, c.reasons
    FROM alerts a JOIN ${MESSAGE_FROM} ON m.channel_id = a.channel_id AND m.ts = a.ts
    LEFT JOIN classifications c ON c.channel_id = a.channel_id AND c.ts = a.ts
    WHERE a.id = $1`,
  insertBriefing: "INSERT INTO briefings (kind, body) VALUES ($1, $2) RETURNING id",
  markItemsBriefed:
    "UPDATE knowledge_items SET briefed_at = now() WHERE id = ANY($1::bigint[]) AND briefed_at IS NULL",
  markAlertsDelivered:
    "UPDATE alerts SET delivered_at = now() WHERE id = ANY($1::bigint[]) AND delivered_at IS NULL",
  collectorStatus: `SELECT
      (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM ingested_at - posted_at)::float8)
        FROM messages WHERE source = 'incremental' AND ingested_at > now() - interval '24 hours')
        AS ingest_lag_p95_seconds,
      (SELECT coalesce(sum(rate_limited), 0)::int FROM collector_hourly WHERE bucket > now() - interval '24 hours')
        AS rate_limited_24h,
      (SELECT coalesce(max(max_queue_depth), 0) FROM collector_hourly WHERE bucket > now() - interval '24 hours')
        AS max_queue_depth_24h,
      (SELECT coalesce(json_agg(json_build_object('channel_id', ch.id, 'covered_until', s.covered_until,
          'last_error', s.last_error) ORDER BY ch.id), '[]')
        FROM channels ch JOIN sync_state s ON s.channel_id = ch.id) AS channels`,
  insertSampleChannel: `INSERT INTO channels (id, name, kind, is_member, is_sample) VALUES ($1, $2, 'public', true, true)
    ON CONFLICT (id) DO NOTHING`,
  insertSampleMessage: `INSERT INTO messages (channel_id, ts, thread_ts, user_id, user_name, text, posted_at, source)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'sample') ON CONFLICT (channel_id, ts) DO NOTHING`,
} as const;
