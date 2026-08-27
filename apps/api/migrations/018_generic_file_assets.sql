ALTER TABLE media_assets DROP CONSTRAINT media_assets_kind_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_kind_check CHECK(kind IN ('image','video','audio','file'));
