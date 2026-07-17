-- Fase 4 — Seleccion comercial de solicitudes.
-- Aplicar una sola vez despues de migration_lead_intakes.sql.
-- Aditiva: conserva solicitudes existentes y agrega configuracion generica
-- de color, variantes y cantidad para consumo futuro de CRM.

ALTER TABLE lead_intakes ADD COLUMN selection_json TEXT;
