-- Intap Flipbook — Migración Fase 8B
-- Ejecutar: wrangler d1 execute intap-flipbook-db --file=apps/api/src/db/migration_fase8b.sql --remote

-- Columna status en users (active | suspended | degraded)
ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active';

-- Columna status en plans (active | hidden)
ALTER TABLE plans ADD COLUMN status TEXT DEFAULT 'active';

-- Columna notify_channel en notifications (para registro de historial)
ALTER TABLE notifications ADD COLUMN channel TEXT DEFAULT 'in_app';
ALTER TABLE notifications ADD COLUMN scheduled_at TEXT;
ALTER TABLE notifications ADD COLUMN sent_at TEXT;
