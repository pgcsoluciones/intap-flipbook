-- Adjuntos privados de cotizaciones en Solicitudes.
-- No reutiliza la ruta pública general /api/upload.
-- Requiere el bucket R2 privado enlazado como PRIVATE_MEDIA.
-- Aplicar una vez en D1 sólo con autorización explícita.

CREATE TABLE IF NOT EXISTS lead_intake_customer_message_attachments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES users(id),
  lead_intake_id TEXT NOT NULL REFERENCES lead_intakes(id) ON DELETE CASCADE,
  customer_message_id TEXT NOT NULL UNIQUE REFERENCES lead_intake_customer_messages(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  download_token_hash TEXT UNIQUE,
  download_expires_at TEXT,
  downloaded_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lead_intake_customer_message_attachments_message
ON lead_intake_customer_message_attachments(tenant_id, lead_intake_id, customer_message_id);

CREATE INDEX IF NOT EXISTS idx_lead_intake_customer_message_attachments_token
ON lead_intake_customer_message_attachments(download_token_hash);
