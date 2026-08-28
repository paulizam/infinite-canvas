ALTER TABLE users
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  ADD COLUMN platform_role text NOT NULL DEFAULT 'user' CHECK (platform_role IN ('user','admin')),
  ADD COLUMN updated_at timestamptz;
UPDATE users SET updated_at=created_at WHERE updated_at IS NULL;
ALTER TABLE users ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE sessions
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN revoked_at timestamptz;
CREATE INDEX sessions_active_user_idx ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE admin_audit_events (
  id uuid PRIMARY KEY,
  actor_type text NOT NULL CHECK (actor_type IN ('user','maintenance','system')),
  actor_id text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  request_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);
CREATE INDEX admin_audit_created_idx ON admin_audit_events(created_at DESC, id DESC);
CREATE INDEX admin_audit_resource_idx ON admin_audit_events(resource_type, resource_id, created_at DESC);
CREATE INDEX admin_audit_actor_idx ON admin_audit_events(actor_id, created_at DESC);
CREATE INDEX admin_audit_request_idx ON admin_audit_events(request_id);

CREATE FUNCTION reject_admin_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admin audit events are immutable';
END;
$$;
CREATE TRIGGER admin_audit_no_update
  BEFORE UPDATE OR DELETE ON admin_audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_admin_audit_mutation();

CREATE TABLE platform_settings (
  namespace text NOT NULL,
  key text NOT NULL,
  value jsonb,
  secret_ciphertext bytea,
  secret_iv bytea,
  secret_tag bytea,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY(namespace, key),
  CHECK ((value IS NOT NULL) <> (secret_ciphertext IS NOT NULL)),
  CHECK (secret_ciphertext IS NULL OR (secret_iv IS NOT NULL AND secret_tag IS NOT NULL))
);

CREATE TABLE admin_content_entries (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('announcement','prompt')),
  title text NOT NULL,
  content text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','published','archived')),
  starts_at timestamptz,
  ends_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX admin_content_kind_status_idx ON admin_content_entries(kind, status, updated_at DESC);
