ALTER TABLE media_assets ADD CONSTRAINT media_assets_id_workspace_unique UNIQUE(id, workspace_id);

CREATE TABLE drama_projects (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id), title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  source_text text NOT NULL DEFAULT '', source_asset_id uuid, revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  UNIQUE(id, workspace_id),
  FOREIGN KEY(source_asset_id, workspace_id) REFERENCES media_assets(id, workspace_id) ON DELETE RESTRICT
);
CREATE INDEX drama_projects_workspace_updated_idx ON drama_projects(workspace_id, updated_at DESC);

CREATE TABLE drama_mutations (
  project_id uuid NOT NULL REFERENCES drama_projects(id) ON DELETE CASCADE, mutation_id text NOT NULL,
  request_hash char(64) NOT NULL, resulting_revision integer NOT NULL, created_at timestamptz NOT NULL,
  PRIMARY KEY(project_id, mutation_id)
);
CREATE TABLE drama_script_versions (
  id uuid PRIMARY KEY, project_id uuid NOT NULL, workspace_id uuid NOT NULL, version integer NOT NULL CHECK(version > 0),
  content text NOT NULL, segments jsonb NOT NULL DEFAULT '[]', analysis jsonb NOT NULL DEFAULT '{}', review_status text NOT NULL DEFAULT 'draft'
    CHECK(review_status IN ('draft','reviewing','approved','rejected')),
  operation text NOT NULL CHECK(operation IN ('import','revision','split','merge','analysis')),
  created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL,
  UNIQUE(project_id, version), FOREIGN KEY(project_id, workspace_id) REFERENCES drama_projects(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX drama_script_versions_project_version_idx ON drama_script_versions(project_id, version DESC);

CREATE TABLE drama_entities (
  id uuid PRIMARY KEY, project_id uuid NOT NULL, workspace_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('character','scene','prop')), name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '', prompt text NOT NULL DEFAULT '', reference_asset_id uuid,
  sort_order integer NOT NULL CHECK(sort_order >= 0), created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  FOREIGN KEY(project_id, workspace_id) REFERENCES drama_projects(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY(reference_asset_id, workspace_id) REFERENCES media_assets(id, workspace_id) ON DELETE RESTRICT
);
CREATE INDEX drama_entities_project_order_idx ON drama_entities(project_id, sort_order, id);

CREATE TABLE drama_shots (
  id uuid PRIMARY KEY, project_id uuid NOT NULL, workspace_id uuid NOT NULL,
  title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 160), prompt text NOT NULL DEFAULT '',
  framing text NOT NULL DEFAULT '', camera_movement text NOT NULL DEFAULT '', duration_ms integer NOT NULL CHECK(duration_ms BETWEEN 100 AND 3600000),
  sort_order integer NOT NULL CHECK(sort_order >= 0), current_version integer NOT NULL DEFAULT 1 CHECK(current_version > 0),
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  FOREIGN KEY(project_id, workspace_id) REFERENCES drama_projects(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX drama_shots_project_order_idx ON drama_shots(project_id, sort_order, id);
CREATE TABLE drama_shot_versions (
  id uuid PRIMARY KEY, shot_id uuid NOT NULL REFERENCES drama_shots(id) ON DELETE CASCADE, version integer NOT NULL CHECK(version > 0),
  snapshot jsonb NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL, UNIQUE(shot_id, version)
);

CREATE OR REPLACE FUNCTION reject_drama_version_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'drama versions are immutable'; END; $$;
CREATE TRIGGER drama_script_versions_no_update BEFORE UPDATE ON drama_script_versions FOR EACH ROW EXECUTE FUNCTION reject_drama_version_update();
CREATE TRIGGER drama_shot_versions_no_update BEFORE UPDATE ON drama_shot_versions FOR EACH ROW EXECUTE FUNCTION reject_drama_version_update();
