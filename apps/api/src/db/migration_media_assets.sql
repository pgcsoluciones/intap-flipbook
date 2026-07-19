CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES users(id),
  publication_id TEXT NOT NULL REFERENCES publications(id),
  storage_bucket TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  public_url TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_assets_dedup
ON media_assets(tenant_id, publication_id, storage_bucket, sha256);

CREATE INDEX IF NOT EXISTS idx_media_assets_publication_recent
ON media_assets(tenant_id, publication_id, storage_bucket, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_media_assets_publication_name
ON media_assets(tenant_id, publication_id, original_name);
