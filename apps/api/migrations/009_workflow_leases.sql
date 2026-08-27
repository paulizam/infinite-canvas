ALTER TABLE workflow_executions
  ADD COLUMN worker_id text,
  ADD COLUMN lease_until timestamptz,
  ADD COLUMN last_heartbeat_at timestamptz,
  ADD COLUMN next_run_at timestamptz;

UPDATE workflow_executions SET next_run_at=updated_at WHERE next_run_at IS NULL;
ALTER TABLE workflow_executions ALTER COLUMN next_run_at SET NOT NULL;

DROP INDEX workflow_executions_claim_idx;
CREATE INDEX workflow_executions_claim_idx ON workflow_executions(next_run_at, id)
  WHERE status IN ('queued','running','waiting','cancel_requested');
