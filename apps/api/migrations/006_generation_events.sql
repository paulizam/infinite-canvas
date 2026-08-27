CREATE TABLE generation_events (
  job_id uuid NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  event_id bigint NOT NULL CHECK (event_id > 0),
  event_type text NOT NULL CHECK (event_type IN ('job.snapshot', 'text.delta', 'text.reasoning.delta', 'job.terminal')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, event_id)
);

CREATE INDEX generation_events_created_at_idx ON generation_events(created_at);

COMMENT ON TABLE generation_events IS 'Bounded generation progress events; retention must be applied by operations policy.';
