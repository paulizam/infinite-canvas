CREATE TABLE generation_jobs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability text NOT NULL CHECK (capability IN ('text','image','video','audio','agent')),
  logical_model_id text NOT NULL,
  client_request_id text NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  retry_of uuid REFERENCES generation_jobs(id),
  status text NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled','needs_review')),
  phase text NOT NULL CHECK (phase IN ('queued','claimed','submitting','submitted','polling','result_ready','persisting','succeeded','failed','cancel_requested','cancelled','needs_review')),
  input jsonb NOT NULL,
  result jsonb,
  upstream_task_id text,
  provider text,
  channel_id text,
  worker_id text,
  lease_until timestamptz,
  last_heartbeat_at timestamptz,
  next_run_at timestamptz NOT NULL,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(workspace_id, owner_id, client_request_id, attempt)
);
CREATE INDEX generation_jobs_due_idx ON generation_jobs(next_run_at, id)
  WHERE status IN ('queued','running');
CREATE INDEX generation_jobs_workspace_updated_idx ON generation_jobs(workspace_id, updated_at DESC);
CREATE UNIQUE INDEX generation_jobs_upstream_attempt_idx
  ON generation_jobs(channel_id, upstream_task_id)
  WHERE upstream_task_id IS NOT NULL;

CREATE TABLE generation_worker_heartbeats (
  worker_id text PRIMARY KEY,
  last_seen_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
