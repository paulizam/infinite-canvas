CREATE TABLE workflow_executions (
  id uuid PRIMARY KEY,
  workflow_id uuid NOT NULL,
  workflow_version integer NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('queued','running','waiting','cancel_requested','succeeded','failed','cancelled')),
  selected_node_ids jsonb NOT NULL,
  layers jsonb NOT NULL,
  initial_inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  FOREIGN KEY (workflow_id, workflow_version) REFERENCES workflow_versions(workflow_id, version)
);

CREATE INDEX workflow_executions_claim_idx ON workflow_executions(status, updated_at, id)
  WHERE status IN ('queued','running','waiting','cancel_requested');
CREATE INDEX workflow_executions_workflow_idx ON workflow_executions(workflow_id, created_at DESC);

CREATE TABLE workflow_node_executions (
  execution_id uuid NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
  node_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','ready','running','waiting','succeeded','failed','skipped','cancelled')),
  attempt integer NOT NULL CHECK (attempt >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts > 0),
  input_snapshot jsonb,
  output_snapshot jsonb,
  error jsonb,
  skip_reason text,
  steps jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  wake_at timestamptz,
  event_key text,
  PRIMARY KEY (execution_id, node_id)
);

CREATE INDEX workflow_nodes_ready_idx ON workflow_node_executions(status, wake_at, execution_id)
  WHERE status IN ('ready','running','waiting');

CREATE TABLE workflow_execution_events (
  execution_id uuid NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
  sequence bigint NOT NULL CHECK (sequence > 0),
  event_type text NOT NULL,
  node_id text,
  step_key text,
  data jsonb,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (execution_id, sequence)
);

COMMENT ON TABLE workflow_execution_events IS 'Immutable monotonic Workflow timeline. Rows are append-only.';

CREATE FUNCTION reject_workflow_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'workflow execution events are immutable';
END;
$$;
CREATE TRIGGER workflow_events_no_update
  BEFORE UPDATE OR DELETE ON workflow_execution_events
  FOR EACH ROW EXECUTE FUNCTION reject_workflow_event_mutation();
