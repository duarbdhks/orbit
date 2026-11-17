export const SQL = {
  upsertChannels: `INSERT INTO channels (id, name, kind, is_member)
    SELECT r.id, r.name, r.kind, r.is_member
    FROM jsonb_to_recordset($1::jsonb) AS r (id text, name text, kind text, is_member boolean)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, is_member = EXCLUDED.is_member`,
  markLost:
    "UPDATE channels SET access_state = 'lost', access_lost_at = $2 WHERE id = $1 AND access_state = 'active'",
  activeChannels: `SELECT c.id, s.covered_from, s.covered_until
    FROM channels c LEFT JOIN sync_state s ON s.channel_id = c.id
    WHERE c.id = ANY($1::text[]) AND c.access_state = 'active' AND NOT c.is_sample
    ORDER BY c.id`,
  storedThreads:
    "SELECT ts, reply_count, latest_reply FROM messages WHERE channel_id = $1 AND ts = ANY($2::text[])",
  upsertMessages: `INSERT INTO messages
      (channel_id, ts, thread_ts, user_id, user_name, text, edited_ts, reply_count, latest_reply, posted_at, source)
    SELECT $1::text, r.ts, r.thread_ts, r.user_id, r.user_name, r.text, r.edited_ts, r.reply_count, r.latest_reply,
      to_timestamp(r.ts::float8), $3::text
    FROM jsonb_to_recordset($2::jsonb) AS r (
      ts text, thread_ts text, user_id text, user_name text, text text, edited_ts text, reply_count int, latest_reply text
    )
    ON CONFLICT (channel_id, ts) DO UPDATE SET text = EXCLUDED.text, edited_ts = EXCLUDED.edited_ts,
      reply_count = EXCLUDED.reply_count, latest_reply = EXCLUDED.latest_reply, user_name = EXCLUDED.user_name`,
  deleteMissingTop: `DELETE FROM messages
    WHERE channel_id = $1 AND ts::numeric BETWEEN $2::numeric AND $3::numeric
      AND (thread_ts IS NULL OR thread_ts = ts) AND ts <> ALL($4::text[])`,
  deleteMissingReplies: `DELETE FROM messages
    WHERE channel_id = $1 AND thread_ts = $2 AND ts <> thread_ts AND ts <> ALL($3::text[])`,
  synced: `INSERT INTO sync_state (channel_id, covered_from, covered_until, last_success_at) VALUES ($1, $2, $3, $3)
    ON CONFLICT (channel_id) DO UPDATE SET covered_from = EXCLUDED.covered_from, covered_until = EXCLUDED.covered_until,
      last_success_at = EXCLUDED.last_success_at, last_error = NULL`,
  failed: `INSERT INTO sync_state (channel_id, last_error) VALUES ($1, $2)
    ON CONFLICT (channel_id) DO UPDATE SET last_error = EXCLUDED.last_error`,
  purge: `WITH gone AS (
      UPDATE channels SET access_state = 'purged' WHERE access_state = 'lost' AND access_lost_at <= $1 RETURNING id
    ), removed AS (DELETE FROM messages WHERE channel_id IN (SELECT id FROM gone))
    DELETE FROM sync_state WHERE channel_id IN (SELECT id FROM gone)`,
  deleteOldMessages: `DELETE FROM messages m USING channels c
    WHERE c.id = m.channel_id AND NOT c.is_sample AND m.posted_at < $1`,
  deleteOrphanKnowledge: `DELETE FROM knowledge_items k
    WHERE NOT EXISTS (SELECT 1 FROM knowledge_evidence e WHERE e.item_id = k.id)`,
  addStats: `INSERT INTO collector_hourly (bucket, api_calls, rate_limited, max_queue_depth) VALUES ($1, $2, $3, $4)
    ON CONFLICT (bucket) DO UPDATE SET api_calls = collector_hourly.api_calls + EXCLUDED.api_calls,
      rate_limited = collector_hourly.rate_limited + EXCLUDED.rate_limited,
      max_queue_depth = GREATEST(collector_hourly.max_queue_depth, EXCLUDED.max_queue_depth)`,
} as const;
