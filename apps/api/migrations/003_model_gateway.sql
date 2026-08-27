CREATE TABLE model_protocols (
  id text PRIMARY KEY,
  name text NOT NULL,
  adapter text NOT NULL CHECK (adapter IN ('openai-compatible','gemini','custom')),
  enabled boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE model_channels (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  protocol_id text NOT NULL REFERENCES model_protocols(id),
  base_url text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  secret_ciphertext bytea,
  secret_iv bytea,
  secret_tag bytea,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((secret_ciphertext IS NULL AND secret_iv IS NULL AND secret_tag IS NULL)
      OR (secret_ciphertext IS NOT NULL AND secret_iv IS NOT NULL AND secret_tag IS NOT NULL))
);

CREATE TABLE upstream_models (
  id uuid PRIMARY KEY,
  channel_id uuid NOT NULL REFERENCES model_channels(id) ON DELETE CASCADE,
  model_id text NOT NULL,
  capability text NOT NULL CHECK (capability IN ('text','image','video','audio')),
  enabled boolean NOT NULL DEFAULT true,
  health_state text NOT NULL DEFAULT 'healthy' CHECK (health_state IN ('healthy','degraded','cooldown','disabled')),
  cooldown_until timestamptz,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(channel_id, model_id)
);

CREATE TABLE logical_models (
  id text PRIMARY KEY,
  name text NOT NULL,
  capability text NOT NULL CHECK (capability IN ('text','image','video','audio')),
  enabled boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX logical_models_one_default_per_capability
  ON logical_models(capability) WHERE is_default AND enabled;

CREATE TABLE logical_model_bindings (
  id uuid PRIMARY KEY,
  logical_model_id text NOT NULL REFERENCES logical_models(id) ON DELETE CASCADE,
  upstream_model_id uuid NOT NULL REFERENCES upstream_models(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL CHECK (priority >= 0),
  weight integer NOT NULL DEFAULT 100 CHECK (weight BETWEEN 1 AND 10000),
  capability_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(logical_model_id, upstream_model_id)
);
CREATE INDEX logical_model_bindings_route_idx
  ON logical_model_bindings(logical_model_id, priority, weight DESC) WHERE enabled;
