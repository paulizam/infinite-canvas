ALTER TABLE canvas_projects
  ADD CONSTRAINT canvas_projects_id_workspace_unique UNIQUE (id, workspace_id);

CREATE TABLE IF NOT EXISTS canvas_project_checkpoints (
  id uuid PRIMARY KEY,
  project_id text NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  source_revision integer NOT NULL CHECK (source_revision >= 0),
  snapshot jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (project_id, workspace_id) REFERENCES canvas_projects(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS canvas_project_checkpoints_project_created_idx
  ON canvas_project_checkpoints(project_id, created_at DESC);

CREATE OR REPLACE FUNCTION reject_checkpoint_update() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'project checkpoints are immutable'; END; $$;
CREATE TRIGGER canvas_project_checkpoints_no_update BEFORE UPDATE ON canvas_project_checkpoints
FOR EACH ROW EXECUTE FUNCTION reject_checkpoint_update();
