ALTER TABLE media_assets
  ADD COLUMN lineage_root_id uuid,
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
UPDATE media_assets SET lineage_root_id=id WHERE lineage_root_id IS NULL;
ALTER TABLE media_assets ALTER COLUMN lineage_root_id SET NOT NULL;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_lineage_root_fk
  FOREIGN KEY(lineage_root_id) REFERENCES media_assets(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE media_asset_parents (
  asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  parent_asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK(position >= 0),
  PRIMARY KEY(asset_id,parent_asset_id),
  UNIQUE(asset_id,position),
  CHECK(asset_id<>parent_asset_id)
);

CREATE TABLE media_asset_origins (
  id uuid PRIMARY KEY,
  asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK(source_type IN ('upload','generation_job','drama_render','import')),
  source_id text NOT NULL CHECK(length(btrim(source_id)) > 0),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL,
  UNIQUE(asset_id,source_type,source_id)
);
CREATE INDEX media_asset_origins_source_idx ON media_asset_origins(source_type,source_id);
