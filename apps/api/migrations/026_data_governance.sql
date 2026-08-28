ALTER TABLE users ADD COLUMN deleted_at timestamptz;

CREATE TABLE account_deletions (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  request_id text NOT NULL,
  requested_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL
);

CREATE TABLE media_blob_gc (
  id uuid PRIMARY KEY,
  asset_id uuid NOT NULL,
  storage_key text NOT NULL UNIQUE,
  state text NOT NULL CHECK(state IN ('pending','deleted','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  last_error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX media_blob_gc_pending_idx ON media_blob_gc(state,updated_at,id)
  WHERE state IN ('pending','failed');

CREATE TABLE data_retention_runs (
  id uuid PRIMARY KEY,
  request_id text NOT NULL,
  cutoff_at timestamptz NOT NULL,
  expired_sessions integer NOT NULL,
  generation_events integer NOT NULL,
  audit_events_preserved bigint NOT NULL,
  created_at timestamptz NOT NULL
);

COMMENT ON TABLE account_deletions IS 'Identity tombstones; business, billing and immutable audit records retain pseudonymous user IDs.';
COMMENT ON TABLE media_blob_gc IS 'Blob deletion outbox created only after the media_assets row is removed.';
COMMENT ON TABLE data_retention_runs IS 'Retention evidence; admin audit remains append-only and is never deleted by retention.';
