CREATE TABLE drama_render_jobs (
 id uuid PRIMARY KEY, project_id uuid NOT NULL, workspace_id uuid NOT NULL, owner_id uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK(kind IN ('ffmpeg','jianying')), status text NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
 progress integer NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100), attempt integer NOT NULL DEFAULT 1 CHECK(attempt > 0), retry_of uuid REFERENCES drama_render_jobs(id),
 input jsonb NOT NULL, output_asset_id uuid, error_code text, error_message text, worker_id text, lease_until timestamptz,
 mutation_id text NOT NULL, request_hash char(64) NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 UNIQUE(project_id, mutation_id), FOREIGN KEY(project_id, workspace_id) REFERENCES drama_projects(id, workspace_id) ON DELETE CASCADE,
 FOREIGN KEY(output_asset_id, workspace_id) REFERENCES media_assets(id, workspace_id) ON DELETE RESTRICT
);
CREATE INDEX drama_render_jobs_claim_idx ON drama_render_jobs(status, created_at) WHERE status='queued';
CREATE TABLE drama_render_versions (
 id uuid PRIMARY KEY, project_id uuid NOT NULL, workspace_id uuid NOT NULL, render_job_id uuid NOT NULL UNIQUE REFERENCES drama_render_jobs(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version > 0), kind text NOT NULL CHECK(kind IN ('ffmpeg','jianying')), asset_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL, UNIQUE(project_id,kind,version),
 FOREIGN KEY(project_id,workspace_id) REFERENCES drama_projects(id,workspace_id) ON DELETE CASCADE,
 FOREIGN KEY(asset_id,workspace_id) REFERENCES media_assets(id,workspace_id) ON DELETE RESTRICT
);
CREATE OR REPLACE FUNCTION reject_drama_render_version_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'drama render versions are immutable'; END; $$;
CREATE TRIGGER drama_render_versions_no_update BEFORE UPDATE ON drama_render_versions FOR EACH ROW EXECUTE FUNCTION reject_drama_render_version_update();
