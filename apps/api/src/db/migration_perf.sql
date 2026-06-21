-- Migración de rendimiento: índices faltantes en D1
-- Ejecutar desde Mac de Juan:
--   cd ~/intap-flipbook/apps/api
--   npx wrangler d1 execute intap-flipbook-db --file=src/db/migration_perf.sql --remote

-- form_responses: filtros por owner_id (carga de /responses y unread-count)
CREATE INDEX IF NOT EXISTS idx_form_responses_owner_created ON form_responses (owner_id, created_at DESC);

-- publication_views: filtros por publication_id (stats de vistas por flipbook)
CREATE INDEX IF NOT EXISTS idx_pub_views_pub ON publication_views (publication_id, viewed_at DESC);

-- publications: filtros por folder_id y status (catálogo del tenant)
CREATE INDEX IF NOT EXISTS idx_publications_folder ON publications (folder_id);
CREATE INDEX IF NOT EXISTS idx_publications_status ON publications (status);

-- payments: ORDER BY created_at en panel admin
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments (created_at DESC);

-- notifications: ORDER BY created_at en panel admin y notificaciones tenant
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at DESC);

-- page_events: filtros por publication_id (si la tabla existe)
CREATE INDEX IF NOT EXISTS idx_page_events_pub ON page_events (publication_id);
