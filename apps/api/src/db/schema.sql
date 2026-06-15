-- Intap Flipbook — D1 Schema
-- Run: wrangler d1 execute intap-flipbook-db --file=apps/api/src/db/schema.sql

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  max_publications INTEGER,
  max_pages_per_pub INTEGER,
  max_storage_mb INTEGER,
  custom_domain INTEGER DEFAULT 0,
  sound_enabled INTEGER DEFAULT 0,
  price_usd REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  plan_id TEXT DEFAULT 'free',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (plan_id) REFERENCES plans(id)
);

CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  status TEXT DEFAULT 'draft',
  public_slug TEXT UNIQUE,
  cover_image_url TEXT,
  sound_enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  image_url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  price TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (publication_id) REFERENCES publications(id)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_publications_user_id ON publications(user_id);
CREATE INDEX IF NOT EXISTS idx_publications_slug ON publications(public_slug);
CREATE INDEX IF NOT EXISTS idx_pages_publication_id ON pages(publication_id);
CREATE INDEX IF NOT EXISTS idx_pages_order ON pages(publication_id, page_number);

-- Seeds: Planes
INSERT OR IGNORE INTO plans VALUES ('free',  'Free',  1,    8,   50,   0, 0, 0);
INSERT OR IGNORE INTO plans VALUES ('basic', 'Basic', 5,    20,  200,  0, 1, 9.99);
INSERT OR IGNORE INTO plans VALUES ('pro',   'Pro',   NULL, 100, 2000, 1, 1, 29.99);
