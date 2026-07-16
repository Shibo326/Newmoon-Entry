-- =============================================================================
-- NightScore Adaptive Agents: Database Schema Migration
-- =============================================================================
-- Creates all agent-related tables with constraints, indexes, and RLS policies.
-- Supabase-compatible PostgreSQL migration.
-- =============================================================================

-- Function to count JSONB keys (used by behavior_profiles constraint)
CREATE OR REPLACE FUNCTION jsonb_object_keys_count(j JSONB)
RETURNS INTEGER AS $$
  SELECT count(*)::INTEGER FROM jsonb_object_keys(j);
$$ LANGUAGE SQL IMMUTABLE;

-- =============================================================================
-- Behavior Profiles table
-- =============================================================================
CREATE TABLE behavior_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  parameters JSONB NOT NULL,
  parameter_schema JSONB NOT NULL,
  last_modified TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(agent_id, version)
);

-- Limit 50 keys per profile
ALTER TABLE behavior_profiles
  ADD CONSTRAINT max_profile_keys
  CHECK (jsonb_object_keys_count(parameters) <= 50);

CREATE INDEX idx_profiles_agent_active ON behavior_profiles(agent_id, is_active);
CREATE INDEX idx_profiles_agent_version ON behavior_profiles(agent_id, version DESC);

-- =============================================================================
-- Adaptation Log table
-- =============================================================================
CREATE TABLE adaptation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('metric', 'config-change', 'feedback', 'anomaly')),
  agent_id TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL,
  correlation_id TEXT,
  status TEXT CHECK (status IN ('complete', 'incomplete')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Payload size constraint (64KB)
ALTER TABLE adaptation_log
  ADD CONSTRAINT max_payload_size
  CHECK (octet_length(payload::TEXT) <= 65536);

CREATE INDEX idx_adaptation_agent ON adaptation_log(agent_id, timestamp DESC);
CREATE INDEX idx_adaptation_type ON adaptation_log(entry_type, timestamp DESC);
CREATE INDEX idx_adaptation_correlation ON adaptation_log(correlation_id);

-- =============================================================================
-- Level Gate configuration (singleton table)
-- =============================================================================
CREATE TABLE level_gate_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  current_level INTEGER NOT NULL DEFAULT 1 CHECK (current_level BETWEEN 1 AND 6),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO level_gate_config (current_level) VALUES (1);

-- =============================================================================
-- Agent registry state (persistence across cold starts)
-- =============================================================================
CREATE TABLE agent_registry_state (
  agent_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  capabilities JSONB NOT NULL DEFAULT '[]',
  lifecycle_state TEXT NOT NULL DEFAULT 'idle'
    CHECK (lifecycle_state IN ('idle', 'active', 'error', 'disabled')),
  profile_id UUID REFERENCES behavior_profiles(id),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Request Cache table (for Cache Agent)
-- =============================================================================
CREATE TABLE request_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  signal_hash TEXT NOT NULL,
  credit_grade TEXT NOT NULL CHECK (credit_grade IN ('AAA', 'AA', 'A', 'BBB', 'BB', 'C')),
  reasoning JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(wallet_address)
);

CREATE INDEX idx_cache_wallet_hash ON request_cache(wallet_address, signal_hash);

-- =============================================================================
-- Row-Level Security (service role only)
-- =============================================================================
ALTER TABLE behavior_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE adaptation_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE level_gate_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_registry_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON behavior_profiles
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role only" ON adaptation_log
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role only" ON level_gate_config
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role only" ON agent_registry_state
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role only" ON request_cache
  FOR ALL USING (auth.role() = 'service_role');
