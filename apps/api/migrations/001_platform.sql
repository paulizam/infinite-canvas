CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL, password_hash text NOT NULL, created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','editor','viewer')),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS canvas_projects (
  id text PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id), document jsonb NOT NULL, revision integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS canvas_projects_workspace_updated_idx ON canvas_projects(workspace_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS canvas_project_mutations (
  project_id text NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
  mutation_id text NOT NULL, revision integer NOT NULL, created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, mutation_id)
);
CREATE TABLE IF NOT EXISTS media_assets (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id), storage_key text NOT NULL UNIQUE, sha256 char(64) NOT NULL,
  bytes bigint NOT NULL CHECK (bytes > 0), mime_type text NOT NULL, kind text NOT NULL CHECK (kind IN ('image','video','audio')),
  original_name text NOT NULL, created_at timestamptz NOT NULL,
  UNIQUE(workspace_id, sha256)
);
CREATE INDEX IF NOT EXISTS media_assets_workspace_created_idx ON media_assets(workspace_id, created_at DESC);
CREATE TABLE IF NOT EXISTS media_asset_references (
  asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
  PRIMARY KEY(asset_id, project_id)
);
