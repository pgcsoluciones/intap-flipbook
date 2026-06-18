-- Fix: agrega watermark_override si no existe (corrección de migración fase8a fallida)
-- Ejecutar cada comando por separado (pueden fallar si la columna ya existe — eso es normal):
--
--   npx wrangler d1 execute intap-flipbook-db --remote --command="ALTER TABLE users ADD COLUMN watermark_override TEXT DEFAULT 'plan'"
--   npx wrangler d1 execute intap-flipbook-db --remote --command="ALTER TABLE users ADD COLUMN custom_max_publications INTEGER"
--   npx wrangler d1 execute intap-flipbook-db --remote --command="ALTER TABLE users ADD COLUMN custom_max_pages INTEGER"
--   npx wrangler d1 execute intap-flipbook-db --remote --command="ALTER TABLE users ADD COLUMN custom_max_storage_mb INTEGER"

ALTER TABLE users ADD COLUMN watermark_override TEXT DEFAULT 'plan';
ALTER TABLE users ADD COLUMN custom_max_publications INTEGER;
ALTER TABLE users ADD COLUMN custom_max_pages INTEGER;
ALTER TABLE users ADD COLUMN custom_max_storage_mb INTEGER;
