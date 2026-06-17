-- Fase 13 — Inline limits por tenant + módulos por tenant + carpetas

-- Límites personalizados por tenant (sobreescriben los del plan)
ALTER TABLE users ADD COLUMN custom_max_publications INTEGER;
ALTER TABLE users ADD COLUMN custom_max_pages INTEGER;
ALTER TABLE users ADD COLUMN custom_max_storage_mb INTEGER;

-- Tabla tenant_modules para overrides de módulos por tenant
CREATE TABLE IF NOT EXISTS tenant_modules (
  user_id TEXT NOT NULL,
  module_key TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  PRIMARY KEY (user_id, module_key)
);

-- Tabla folders para carpetas de publicaciones
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Columna folder_id en publications (si no existe)
ALTER TABLE publications ADD COLUMN folder_id TEXT REFERENCES folders(id);
