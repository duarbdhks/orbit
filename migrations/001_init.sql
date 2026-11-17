CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE channels (
  id text PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('public', 'private')),
  is_member boolean NOT NULL,
  is_sample boolean NOT NULL DEFAULT false,
  access_state text NOT NULL DEFAULT 'active' CHECK (access_state IN ('active', 'lost', 'purged')),
  access_lost_at timestamptz,
  discovered_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  channel_id text NOT NULL REFERENCES channels (id),
  ts text NOT NULL,
  thread_ts text,
  user_id text,
  user_name text,
  text text NOT NULL,
  edited_ts text,
  reply_count integer NOT NULL DEFAULT 0,
  latest_reply text,
  posted_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('backfill', 'incremental', 'reconcile', 'sample')),
  PRIMARY KEY (channel_id, ts)
);
CREATE INDEX messages_posted_at ON messages (posted_at);
CREATE INDEX messages_thread ON messages (channel_id, thread_ts);
CREATE INDEX messages_text_trgm ON messages USING gin (text gin_trgm_ops);

-- 채널마다 수집이 끝난 구간 하나. 두 끝 사이에는 빈틈이 없다.
CREATE TABLE sync_state (
  channel_id text PRIMARY KEY REFERENCES channels (id),
  covered_from timestamptz,
  covered_until timestamptz,
  last_success_at timestamptz,
  last_error text
);

CREATE TABLE classifications (
  channel_id text NOT NULL,
  ts text NOT NULL,
  work_related boolean NOT NULL,
  importance smallint NOT NULL CHECK (importance BETWEEN 0 AND 3),
  urgency smallint NOT NULL CHECK (urgency BETWEEN 0 AND 3),
  is_new boolean NOT NULL,
  conflicts boolean NOT NULL,
  needs_research boolean NOT NULL,
  awaits_owner boolean NOT NULL,
  route text NOT NULL CHECK (route IN ('notify_now', 'briefing', 'hold')),
  reasons text[] NOT NULL,
  source text NOT NULL CHECK (source IN ('rules', 'jev')),
  classified_at timestamptz NOT NULL DEFAULT now(),
  analyzed_at timestamptz,
  PRIMARY KEY (channel_id, ts),
  FOREIGN KEY (channel_id, ts) REFERENCES messages (channel_id, ts) ON DELETE CASCADE
);
CREATE INDEX classifications_pending ON classifications (classified_at) WHERE analyzed_at IS NULL;

CREATE TABLE knowledge_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (
    kind IN ('progress', 'decision', 'schedule_change', 'policy_change', 'incident', 'open_question', 'risk')
  ),
  decision_state text CHECK (decision_state IN ('discussing', 'confirmed', 'changed', 'withdrawn')),
  title text NOT NULL,
  summary text NOT NULL,
  project text,
  owner text,
  suggested_reply text,
  supersedes bigint REFERENCES knowledge_items (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  briefed_at timestamptz,
  CHECK ((kind = 'decision') = (decision_state IS NOT NULL))
);

CREATE TABLE knowledge_evidence (
  item_id bigint NOT NULL REFERENCES knowledge_items (id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  ts text NOT NULL,
  permalink text NOT NULL,
  PRIMARY KEY (item_id, channel_id, ts),
  FOREIGN KEY (channel_id, ts) REFERENCES messages (channel_id, ts) ON DELETE CASCADE
);

CREATE TABLE briefings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('daily', 'weekly', 'alert')),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alerts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel_id text NOT NULL,
  ts text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  webhook_sent_at timestamptz,
  delivered_at timestamptz,
  UNIQUE (channel_id, ts),
  FOREIGN KEY (channel_id, ts) REFERENCES messages (channel_id, ts) ON DELETE CASCADE
);

CREATE TABLE collector_hourly (
  bucket timestamptz PRIMARY KEY,
  api_calls integer NOT NULL DEFAULT 0,
  rate_limited integer NOT NULL DEFAULT 0,
  max_queue_depth integer NOT NULL DEFAULT 0
);

CREATE TABLE router_decisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('classify', 'runtime')),
  mode text NOT NULL CHECK (mode IN ('off', 'shadow', 'active')),
  source text NOT NULL CHECK (source IN ('rules', 'jev')),
  input_ref text NOT NULL,
  decision jsonb NOT NULL,
  shadow jsonb,
  reasons text[] NOT NULL,
  latency_ms integer NOT NULL,
  cost_usd numeric(12, 8) NOT NULL DEFAULT 0,
  input_tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jev_usage (
  day date PRIMARY KEY,
  calls integer NOT NULL DEFAULT 0,
  cost_usd numeric(12, 8) NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0
);
