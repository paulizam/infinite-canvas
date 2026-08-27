CREATE TABLE workflow_triggers (
  id uuid PRIMARY KEY,
  workflow_id uuid NOT NULL,
  workflow_version integer NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('webhook','form','email','schedule')),
  target_node_id text NOT NULL,
  token_hash text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  next_run_at timestamptz,
  worker_id text,
  lease_until timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (workflow_id,workflow_version) REFERENCES workflow_versions(workflow_id,version),
  CHECK ((kind='schedule' AND token_hash IS NULL AND next_run_at IS NOT NULL) OR (kind<>'schedule' AND token_hash IS NOT NULL AND next_run_at IS NULL))
);

CREATE UNIQUE INDEX workflow_triggers_token_idx ON workflow_triggers(token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX workflow_triggers_workflow_idx ON workflow_triggers(workflow_id,created_at DESC);
CREATE INDEX workflow_triggers_schedule_claim_idx ON workflow_triggers(next_run_at,id)
  WHERE kind='schedule' AND enabled=true;

CREATE TABLE workflow_trigger_invocations (
  id uuid PRIMARY KEY,
  trigger_id uuid NOT NULL REFERENCES workflow_triggers(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  execution_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  UNIQUE(trigger_id,idempotency_key)
);

COMMENT ON TABLE workflow_trigger_invocations IS 'Durable idempotency reservation; execution_id is deterministic and replay-safe.';
