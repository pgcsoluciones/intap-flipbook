-- Etapa 2 — Bandeja central de Solicitudes.
-- Índice aditivo para paginación estable por tenant, fecha e identificador.
-- No aplicar remotamente sin autorización explícita.

CREATE INDEX IF NOT EXISTS idx_lead_intakes_tenant_created_id
ON lead_intakes(tenant_id, created_at DESC, id DESC);
