CREATE TABLE workflows (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL UNIQUE REFERENCES canvas_projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  current_version integer NOT NULL CHECK (current_version > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX workflows_workspace_updated_idx ON workflows(workspace_id, updated_at DESC);

CREATE TABLE workflow_versions (
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  project_revision integer NOT NULL CHECK (project_revision >= 0),
  publication_id text NOT NULL,
  definition jsonb NOT NULL,
  source_mapping jsonb NOT NULL,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  published_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (workflow_id, version),
  UNIQUE (workflow_id, project_revision),
  UNIQUE (workflow_id, publication_id)
);

COMMENT ON TABLE workflow_versions IS 'Immutable published Workflow definitions. Rollback publishes a new version; rows are never updated.';
