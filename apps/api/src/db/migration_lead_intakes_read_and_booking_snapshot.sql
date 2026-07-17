-- Solicitudes centralizadas: lectura independiente y snapshot operativo de cada cita.
-- Aplicar sólo después de validar localmente y con autorización expresa.
-- No ejecutar remotamente por este script.

ALTER TABLE lead_intakes ADD COLUMN read_at TEXT;

CREATE INDEX IF NOT EXISTS idx_lead_intakes_tenant_read_created_id
ON lead_intakes(tenant_id, read_at, created_at DESC, id DESC);
