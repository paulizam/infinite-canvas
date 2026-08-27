CREATE TABLE workflow_api_tokens (
  id uuid PRIMARY KEY,
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  workflow_version integer NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  token_prefix text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL,
  rate_limit_per_minute integer NOT NULL CHECK (rate_limit_per_minute BETWEEN 1 AND 600),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL,
  last_used_at timestamptz,
  FOREIGN KEY (workflow_id,workflow_version) REFERENCES workflow_versions(workflow_id,version),
  CHECK (scopes <@ ARRAY['invoke','read_execution']::text[] AND cardinality(scopes)>0)
);

CREATE INDEX workflow_api_tokens_workflow_idx ON workflow_api_tokens(workflow_id,created_at DESC);

CREATE TABLE workflow_api_invocations (
  id uuid PRIMARY KEY,
  token_id uuid NOT NULL REFERENCES workflow_api_tokens(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  execution_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  UNIQUE(token_id,idempotency_key)
);

CREATE TABLE workflow_api_audit_events (
  id uuid PRIMARY KEY,
  token_id uuid NOT NULL REFERENCES workflow_api_tokens(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('invoke','read_execution')),
  execution_id uuid,
  request_id text,
  created_at timestamptz NOT NULL
);

CREATE INDEX workflow_api_audit_token_idx ON workflow_api_audit_events(token_id,created_at DESC);
COMMENT ON COLUMN workflow_api_tokens.token_hash IS 'SHA-256 only; plaintext token is returned exactly once.';
