ALTER TABLE media_assets ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE media_assets ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_media_assets_visible_pub
  ON media_assets (tenant_id, publication_id, storage_bucket, is_hidden, deleted_at, created_at, id);
