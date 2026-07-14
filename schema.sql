CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY,
  channel_name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  overlay_token TEXT UNIQUE NOT NULL,
  session_token_hash TEXT UNIQUE NOT NULL,
  kick_user_id TEXT UNIQUE,
  kick_access_token TEXT,
  kick_refresh_token TEXT,
  kick_token_expires_at BIGINT,
  settings JSONB NOT NULL DEFAULT '{}',
  jackpot INTEGER NOT NULL DEFAULT 250,
  community_progress INTEGER NOT NULL DEFAULT 0,
  community_completions INTEGER NOT NULL DEFAULT 0,
  double_points_until BIGINT NOT NULL DEFAULT 0,
  next_round_at BIGINT,
  overlay_last_connected_at BIGINT NOT NULL DEFAULT 0,
  scoreboard_last_connected_at BIGINT NOT NULL DEFAULT 0,
  kick_subscription_checked_at BIGINT NOT NULL DEFAULT 0,
  last_webhook_at BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS kick_user_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS community_progress INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS community_completions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS double_points_until BIGINT NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS overlay_last_connected_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS scoreboard_last_connected_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS kick_subscription_checked_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS last_webhook_at BIGINT NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_kick_user_id_unique ON tenants(kick_user_id) WHERE kick_user_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS scores (
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_key TEXT NOT NULL,
  username TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  wrong INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(tenant_id,user_key)
);
CREATE TABLE IF NOT EXISTS score_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_key TEXT NOT NULL,
  username TEXT NOT NULL,
  points INTEGER NOT NULL,
  placement INTEGER NOT NULL,
  streak INTEGER NOT NULL DEFAULT 1,
  response_ms INTEGER,
  difficulty TEXT,
  wrong_guesses INTEGER NOT NULL DEFAULT 0,
  jackpot_win BOOLEAN NOT NULL DEFAULT FALSE,
  won_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE score_events ADD COLUMN IF NOT EXISTS streak INTEGER NOT NULL DEFAULT 1;
ALTER TABLE score_events ADD COLUMN IF NOT EXISTS response_ms INTEGER;
ALTER TABLE score_events ADD COLUMN IF NOT EXISTS difficulty TEXT;
ALTER TABLE score_events ADD COLUMN IF NOT EXISTS wrong_guesses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE score_events ADD COLUMN IF NOT EXISTS jackpot_win BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS score_events_tenant_time ON score_events(tenant_id,won_at DESC);
CREATE INDEX IF NOT EXISTS score_events_tenant_user_time ON score_events(tenant_id,user_key,won_at DESC);
CREATE TABLE IF NOT EXISTS user_badges (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_key TEXT NOT NULL,
  badge_key TEXT NOT NULL,
  username TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(tenant_id,user_key,badge_key)
);
CREATE INDEX IF NOT EXISTS user_badges_tenant_user ON user_badges(tenant_id,user_key,unlocked_at DESC);
CREATE TABLE IF NOT EXISTS round_history (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  runtime_round_id UUID,
  puzzle_id TEXT NOT NULL,
  category TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  emojis TEXT NOT NULL,
  answer TEXT NOT NULL,
  winner_username TEXT,
  response_ms INTEGER,
  participants INTEGER NOT NULL DEFAULT 0,
  jackpot BOOLEAN NOT NULL DEFAULT FALSE,
  solved BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE round_history ADD COLUMN IF NOT EXISTS runtime_round_id UUID;
CREATE INDEX IF NOT EXISTS round_history_tenant_time ON round_history(tenant_id,finished_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS round_history_tenant_runtime_unique ON round_history(tenant_id,runtime_round_id);
CREATE TABLE IF NOT EXISTS active_rounds (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  round_id UUID UNIQUE NOT NULL,
  state JSONB NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS active_rounds_ends_at ON active_rounds(ends_at);
CREATE TABLE IF NOT EXISTS webhook_messages (
  message_id TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS webhook_messages_received_at ON webhook_messages(received_at);
CREATE TABLE IF NOT EXISTS guest_sessions (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  access_token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  settings JSONB NOT NULL DEFAULT '{}',
  scores JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS guest_sessions_tenant ON guest_sessions(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS guest_sessions_expiry ON guest_sessions(expires_at) WHERE revoked_at IS NULL;
