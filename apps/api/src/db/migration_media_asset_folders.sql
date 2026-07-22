CREATE TABLE IF NOT EXISTS media_folders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES users(id),
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

ALTER TABLE media_assets ADD COLUMN folder_id TEXT REFERENCES media_folders(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_folders_publication_name
ON media_folders(tenant_id, publication_id, name COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_media_folders_publication_created
ON media_folders(tenant_id, publication_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_media_assets_folder_recent
ON media_assets(tenant_id, publication_id, folder_id, created_at DESC, id DESC);
