CREATE TABLE community_works (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, owner_id uuid NOT NULL REFERENCES users(id), source_project_id text,
 title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 160), description text NOT NULL DEFAULT '' CHECK(char_length(description)<=10000),
 cover_asset_id uuid, tags text[] NOT NULL DEFAULT '{}', visibility text NOT NULL CHECK(visibility IN ('public','unlisted','private')),
 status text NOT NULL CHECK(status IN ('draft','pending','published','rejected','taken_down')), revision integer NOT NULL DEFAULT 0,
 draft_snapshot jsonb NOT NULL, moderation_reason text NOT NULL DEFAULT '', created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 UNIQUE(id,workspace_id), FOREIGN KEY(source_project_id,workspace_id) REFERENCES canvas_projects(id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(cover_asset_id,workspace_id) REFERENCES media_assets(id,workspace_id) ON DELETE RESTRICT
);
CREATE INDEX community_works_owner_updated_idx ON community_works(owner_id,updated_at DESC);
CREATE INDEX community_works_feed_idx ON community_works(updated_at DESC) WHERE status='published' AND visibility='public';
CREATE INDEX community_works_tags_idx ON community_works USING gin(tags);
CREATE TABLE community_work_mutations(project_id uuid NOT NULL REFERENCES community_works(id) ON DELETE CASCADE,mutation_id text NOT NULL,request_hash char(64) NOT NULL,resulting_revision integer NOT NULL,created_at timestamptz NOT NULL,PRIMARY KEY(project_id,mutation_id));
CREATE TABLE community_work_versions(id uuid PRIMARY KEY,work_id uuid NOT NULL,workspace_id uuid NOT NULL,version integer NOT NULL,snapshot jsonb NOT NULL,reviewed_by uuid REFERENCES users(id),published_at timestamptz NOT NULL,UNIQUE(work_id,version),FOREIGN KEY(work_id,workspace_id) REFERENCES community_works(id,workspace_id) ON DELETE CASCADE);
CREATE TABLE community_likes(work_id uuid NOT NULL REFERENCES community_works(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at timestamptz NOT NULL,PRIMARY KEY(work_id,user_id));
CREATE TABLE community_follows(follower_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at timestamptz NOT NULL,CHECK(follower_id<>author_id),PRIMARY KEY(follower_id,author_id));
CREATE TABLE community_reports(id uuid PRIMARY KEY,work_id uuid NOT NULL REFERENCES community_works(id) ON DELETE CASCADE,reporter_id uuid NOT NULL REFERENCES users(id),reason_code text NOT NULL,detail text NOT NULL DEFAULT '',status text NOT NULL CHECK(status IN ('open','resolved','dismissed')),created_at timestamptz NOT NULL,resolved_at timestamptz,UNIQUE(work_id,reporter_id,reason_code));
CREATE TABLE community_audit_log(id bigserial PRIMARY KEY,actor_id uuid REFERENCES users(id),actor_kind text NOT NULL,action text NOT NULL,resource_type text NOT NULL,resource_id text NOT NULL,reason text NOT NULL DEFAULT '',request_id text NOT NULL,metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL);
CREATE INDEX community_audit_resource_idx ON community_audit_log(resource_type,resource_id,created_at DESC);
CREATE UNIQUE INDEX community_audit_request_idx ON community_audit_log(actor_kind,action,resource_type,resource_id,request_id);
CREATE OR REPLACE FUNCTION reject_community_version_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'community versions are immutable'; END; $$;
CREATE TRIGGER community_work_versions_no_update BEFORE UPDATE ON community_work_versions FOR EACH ROW EXECUTE FUNCTION reject_community_version_update();
