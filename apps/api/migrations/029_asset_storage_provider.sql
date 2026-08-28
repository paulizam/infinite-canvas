ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS storage_provider text;
UPDATE media_assets SET storage_provider = current_setting('app.asset_storage_provider') WHERE storage_provider IS NULL;
ALTER TABLE media_assets ALTER COLUMN storage_provider SET NOT NULL;

ALTER TABLE media_assets
  ADD CONSTRAINT media_assets_storage_provider_not_blank
  CHECK (length(btrim(storage_provider)) > 0) NOT VALID;

ALTER TABLE media_assets VALIDATE CONSTRAINT media_assets_storage_provider_not_blank;

ALTER TABLE media_blob_gc ADD COLUMN IF NOT EXISTS storage_provider text;
UPDATE media_blob_gc SET storage_provider = current_setting('app.asset_storage_provider') WHERE storage_provider IS NULL;
ALTER TABLE media_blob_gc ALTER COLUMN storage_provider SET NOT NULL;
ALTER TABLE media_blob_gc ADD CONSTRAINT media_blob_gc_storage_provider_not_blank CHECK (length(btrim(storage_provider)) > 0) NOT VALID;
ALTER TABLE media_blob_gc VALIDATE CONSTRAINT media_blob_gc_storage_provider_not_blank;
