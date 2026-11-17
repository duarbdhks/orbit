export const SQL = {
  jevSpentToday: "SELECT cost_usd::float8 AS cost_usd FROM jev_usage WHERE day = $1::date",
  addJevUsage: `INSERT INTO jev_usage (day, calls, cost_usd, input_tokens) VALUES ($1::date, 1, $2::numeric, $3::bigint)
    ON CONFLICT (day) DO UPDATE SET calls = jev_usage.calls + 1,
      cost_usd = jev_usage.cost_usd + EXCLUDED.cost_usd,
      input_tokens = jev_usage.input_tokens + EXCLUDED.input_tokens`,
  insertDecision: `INSERT INTO router_decisions
    (kind, mode, source, input_ref, decision, shadow, reasons, latency_ms, cost_usd, input_tokens)
    VALUES ($1::text, $2::text, $3::text, $4::text, $5::jsonb, $6::jsonb, $7::text[], $8::int, $9::numeric, $10::int)`,
  channelIsSample: "SELECT is_sample FROM channels WHERE id = $1::text",
} as const;
