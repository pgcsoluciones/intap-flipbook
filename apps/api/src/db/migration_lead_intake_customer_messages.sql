-- Respuestas persistentes al cliente para Solicitudes.
-- Crea borradores e historial de WhatsApp; no envía mensajes automáticamente.
-- Aplicar una vez en D1 sólo con autorización explícita.

CREATE TABLE IF NOT EXISTS lead_intake_customer_messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES users(id),
  lead_intake_id TEXT NOT NULL REFERENCES lead_intakes(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'quote_sent',
    'booking_confirmed',
    'booking_rejected',
    'booking_cancelled',
    'booking_rescheduled'
  )),
  channel TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp')),
  message_text TEXT NOT NULL,
  note_text TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'opened', 'sent')),
  opened_at TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lead_intake_customer_messages_lead
ON lead_intake_customer_messages(tenant_id, lead_intake_id, status, created_at DESC);
