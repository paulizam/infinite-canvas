ALTER TABLE workflows ALTER COLUMN project_id DROP NOT NULL;

CREATE TABLE workflow_folders (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(workspace_id,name)
);

CREATE TABLE workflow_library_entries (
  workflow_id uuid PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES workflow_folders(id) ON DELETE SET NULL,
  cover_asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  description text NOT NULL DEFAULT '',
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_template boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL
);

CREATE INDEX workflow_library_folder_idx ON workflow_library_entries(folder_id);
CREATE INDEX workflow_library_template_idx ON workflow_library_entries(is_template,updated_at DESC) WHERE is_template=true;
