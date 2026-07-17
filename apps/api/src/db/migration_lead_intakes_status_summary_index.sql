-- Índice para acelerar el resumen de solicitudes nuevas por tenant.
CREATE INDEX IF NOT EXISTS idx_lead_intakes_tenant_status_request_type
ON lead_intakes(tenant_id, status, request_type);
