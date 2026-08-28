CREATE TABLE media_asset_variants (
  asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('preview')),
  storage_provider text NOT NULL CHECK (length(btrim(storage_provider)) > 0),
  storage_key text NOT NULL UNIQUE,
  bytes bigint NOT NULL CHECK (bytes > 0),
  mime_type text NOT NULL,
  sha256 char(64) NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY(asset_id, kind)
);

COMMENT ON TABLE media_asset_variants IS 'Derived blobs; original media_assets storage_key remains immutable and authoritative.';
