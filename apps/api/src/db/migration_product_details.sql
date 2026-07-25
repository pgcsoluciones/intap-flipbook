CREATE TABLE IF NOT EXISTS product_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES users(id),
  internal_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  price TEXT,
  image_url TEXT,
  accent_color TEXT NOT NULL DEFAULT '#4F46E5',
  cta_type TEXT,
  cta_label TEXT,
  cta_target TEXT,
  status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, internal_name),
  CHECK (length(trim(internal_name)) > 0),
  CHECK (length(trim(title)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_product_details_tenant_updated
  ON product_details(tenant_id, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_product_details_tenant_status_updated
  ON product_details(tenant_id, status, updated_at DESC, id DESC);
