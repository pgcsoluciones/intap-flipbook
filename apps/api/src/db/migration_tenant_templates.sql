-- Propuestas de plantilla enviadas por tenants
CREATE TABLE IF NOT EXISTS template_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  publication_id TEXT NOT NULL REFERENCES publications(id),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  cover_url TEXT,
  status TEXT DEFAULT 'pending',   -- pending | approved | rejected
  admin_notes TEXT,
  resolved_by TEXT REFERENCES users(id),
  resolved_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_template_proposals_user ON template_proposals(user_id);
CREATE INDEX IF NOT EXISTS idx_template_proposals_status ON template_proposals(status);
