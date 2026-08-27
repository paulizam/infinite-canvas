CREATE TABLE drama_shot_generations (
  id uuid PRIMARY KEY, project_id uuid NOT NULL, workspace_id uuid NOT NULL,
  shot_id uuid NOT NULL REFERENCES drama_shots(id) ON DELETE CASCADE,
  generation_job_id uuid NOT NULL REFERENCES generation_jobs(id) ON DELETE RESTRICT,
  capability text NOT NULL CHECK(capability IN ('image','video')), selected_asset_id uuid,
  selected boolean NOT NULL DEFAULT false, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL,
  UNIQUE(project_id, generation_job_id),
  FOREIGN KEY(project_id, workspace_id) REFERENCES drama_projects(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY(selected_asset_id, workspace_id) REFERENCES media_assets(id, workspace_id) ON DELETE RESTRICT
);
CREATE INDEX drama_shot_generations_shot_created_idx ON drama_shot_generations(shot_id, created_at DESC);

CREATE TABLE drama_timeline_items (
  id uuid PRIMARY KEY, project_id uuid NOT NULL, workspace_id uuid NOT NULL, shot_id uuid REFERENCES drama_shots(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('dialogue','voice','bgm','subtitle')),
  text_content text NOT NULL DEFAULT '', voice text NOT NULL DEFAULT '', asset_id uuid,
  start_ms integer NOT NULL CHECK(start_ms >= 0), end_ms integer NOT NULL CHECK(end_ms > start_ms),
  sort_order integer NOT NULL CHECK(sort_order >= 0), created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL,
  FOREIGN KEY(project_id, workspace_id) REFERENCES drama_projects(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY(asset_id, workspace_id) REFERENCES media_assets(id, workspace_id) ON DELETE RESTRICT
);
CREATE INDEX drama_timeline_project_time_idx ON drama_timeline_items(project_id, start_ms, sort_order);

CREATE TABLE drama_shot_reviews (
  id uuid PRIMARY KEY, project_id uuid NOT NULL, workspace_id uuid NOT NULL, shot_id uuid NOT NULL REFERENCES drama_shots(id) ON DELETE CASCADE,
  status text NOT NULL CHECK(status IN ('pending','approved','changes_requested')),
  comment text NOT NULL DEFAULT '' CHECK(char_length(comment) <= 4000), reviewer_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL,
  FOREIGN KEY(project_id, workspace_id) REFERENCES drama_projects(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX drama_shot_reviews_project_created_idx ON drama_shot_reviews(project_id, created_at DESC);
