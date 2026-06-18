-- Fase 12: slug de tenant (perfil público del usuario) + URLs legibles
-- Cada usuario registra un slug único que identifica su espacio público:
--   https://flip.intaprd.com/{slug-tenant}/{slug-flipbook}
-- En SQLite los NULL se consideran distintos entre sí, así que el índice UNIQUE
-- permite usuarios antiguos sin slug hasta que lo definan en su perfil.

ALTER TABLE users ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_slug ON users(slug);

-- Columnas que faltan en plans para el ciclo de negocio
ALTER TABLE plans ADD COLUMN status TEXT DEFAULT 'active';
ALTER TABLE plans ADD COLUMN period_days INTEGER DEFAULT 30;
