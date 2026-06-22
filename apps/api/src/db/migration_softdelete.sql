-- Migración K: soft delete (borrado suave) en publications
-- Ejecutar desde Mac de Juan:
--   cd ~/intap-flipbook/apps/api
--   npx wrangler d1 execute intap-flipbook-db --file=src/db/migration_softdelete.sql --remote

-- Columna que marca cuándo se mandó a papelera (NULL = publicación activa)
ALTER TABLE publications ADD COLUMN deleted_at TEXT DEFAULT NULL;

-- Índice para filtrar activas vs. papelera sin escanear toda la tabla
CREATE INDEX IF NOT EXISTS idx_publications_deleted_at ON publications (deleted_at);
