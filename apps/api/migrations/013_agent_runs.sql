CREATE TABLE agent_sessions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text REFERENCES canvas_projects(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX agent_sessions_workspace_idx ON agent_sessions(workspace_id,updated_at DESC);

CREATE TABLE agent_runs (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id),
  prompt text NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 20000),
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  model_id text,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  skill_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  plan jsonb,
  status text NOT NULL CHECK (status IN ('queued','claimed','running','waiting_approval','succeeded','failed','cancelled')),
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt BETWEEN 1 AND 10),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  worker_id text,
  lease_until timestamptz,
  last_heartbeat_at timestamptz,
  error jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz
);
CREATE INDEX agent_runs_session_idx ON agent_runs(session_id,created_at DESC);
CREATE INDEX agent_runs_claim_idx ON agent_runs(created_at,id) WHERE status IN ('queued','claimed','running');

CREATE TABLE agent_run_events (
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence>0),
  type text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  PRIMARY KEY(run_id,sequence)
);

CREATE TABLE agent_run_subtasks (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  status text NOT NULL CHECK (status IN ('pending','running','succeeded','failed','skipped')),
  input jsonb,
  output jsonb,
  error jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE agent_run_results (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('text','image','video','audio','asset','canvas_operation','drama_item')),
  payload jsonb NOT NULL,
  asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE agent_run_approvals (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('delete','batch_paid_generation','external_access')),
  status text NOT NULL CHECK (status IN ('pending','approved','declined')),
  request jsonb NOT NULL,
  requested_at timestamptz NOT NULL,
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz
);
CREATE UNIQUE INDEX agent_run_pending_approval_idx ON agent_run_approvals(run_id) WHERE status='pending';

COMMENT ON TABLE agent_run_events IS 'Immutable user-visible Agent Run events; private chain-of-thought must never be persisted.';
CREATE FUNCTION reject_agent_run_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'agent run events are immutable'; END; $$;
CREATE TRIGGER agent_run_events_no_update BEFORE UPDATE OR DELETE ON agent_run_events
  FOR EACH ROW EXECUTE FUNCTION reject_agent_run_event_mutation();
