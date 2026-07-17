-- Fase 4 — Entradas comerciales CRM-ready desde el Viewer.
-- Migracion aditiva e idempotente para Preview.
-- No borra ni altera form_responses; esta tabla conserva snapshots comerciales
-- de solicitudes que luego podran enlazarse a contactos, leads, booking o CRM.

CREATE TABLE IF NOT EXISTS lead_intakes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES users(id),
  publication_id TEXT NOT NULL REFERENCES publications(id),
  marker_id TEXT NOT NULL REFERENCES dynamic_markers(id),
  request_type TEXT NOT NULL DEFAULT 'quote',
  status TEXT NOT NULL DEFAULT 'new',
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  customer_message TEXT,
  marker_snapshot_json TEXT NOT NULL,
  source_url TEXT,
  internal_note TEXT,
  crm_contact_id TEXT,
  crm_lead_id TEXT,
  booking_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  handled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_lead_intakes_tenant_created ON lead_intakes(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_intakes_publication ON lead_intakes(publication_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_intakes_marker ON lead_intakes(marker_id);
CREATE INDEX IF NOT EXISTS idx_lead_intakes_status ON lead_intakes(tenant_id, status, created_at DESC);
