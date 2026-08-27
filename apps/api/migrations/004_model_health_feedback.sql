ALTER TABLE upstream_models
  ADD COLUMN consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  ADD COLUMN last_success_at timestamptz,
  ADD COLUMN last_failure_at timestamptz;

