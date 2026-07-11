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
  next_round_at BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS kick_user_id TEXT;
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
  won_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS score_events_tenant_time ON score_events(tenant_id,won_at DESC);
CREATE TABLE IF NOT EXISTS webhook_messages (
  message_id TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
