-- ════════════════════════════════════════════════════════════════════════════
-- Fase 1 — Biblioteca central de SVG editables
-- Tablas nuevas. NO toca editor_elements (el panel "Elementos" actual sigue igual).
-- ════════════════════════════════════════════════════════════════════════════

-- Familias: agrupan SVG relacionados (Frutas, Acciones, Redes sociales, etc.)
CREATE TABLE IF NOT EXISTS svg_families (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  category    TEXT,
  sort_order  INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Recursos SVG individuales de la biblioteca global
CREATE TABLE IF NOT EXISTS svg_resources (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  name                   TEXT NOT NULL,
  slug                   TEXT UNIQUE NOT NULL,
  family_id              INTEGER,
  category               TEXT,
  tags                   TEXT,            -- JSON: ["descargar","archivo"]

  -- Disponibilidad
  available_modules      TEXT,            -- JSON: ["canvas_insert_svg","button_icon_picker"]
  plans                  TEXT,            -- JSON: ["free","basic","pro"]
  visible_to_lower_plans INTEGER DEFAULT 1,
  upgrade_message        TEXT,

  -- Capacidades de edición (qué puede tocar el tenant)
  editable_colors        INTEGER DEFAULT 1,
  editable_stroke        INTEGER DEFAULT 1,
  editable_layers        INTEGER DEFAULT 1,
  editable_gradients     INTEGER DEFAULT 0,
  editable_geometry      INTEGER DEFAULT 1,

  -- Alcance
  scope                  TEXT DEFAULT 'global',   -- 'global' | 'tenant'
  tenant_id              TEXT,                    -- solo si scope='tenant'

  -- Fuente (SVG sanitizado guardado en R2)
  svg_url                TEXT NOT NULL,           -- URL pública R2 del SVG sanitizado
  preview_url            TEXT,                    -- opcional, miniatura
  hash                   TEXT,                    -- hash del contenido sanitizado

  version                INTEGER DEFAULT 1,
  status                 TEXT DEFAULT 'active',   -- 'active' | 'draft' | 'archived'
  created_by             TEXT,                    -- user_id del admin que lo creó
  created_at             TEXT DEFAULT (datetime('now')),
  updated_at             TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (family_id) REFERENCES svg_families(id) ON DELETE SET NULL
);

-- Historial de versiones: al reemplazar el SVG fuente se guarda la versión anterior.
-- Permite "Restaurar versión anterior" sin alterar documentos ya creados.
CREATE TABLE IF NOT EXISTS svg_resource_versions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id  INTEGER NOT NULL,
  version      INTEGER NOT NULL,
  svg_url      TEXT NOT NULL,
  hash         TEXT,
  created_at   TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (resource_id) REFERENCES svg_resources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_svg_resources_family  ON svg_resources(family_id);
CREATE INDEX IF NOT EXISTS idx_svg_resources_status  ON svg_resources(status);
CREATE INDEX IF NOT EXISTS idx_svg_resources_scope   ON svg_resources(scope, tenant_id);
CREATE INDEX IF NOT EXISTS idx_svg_versions_resource ON svg_resource_versions(resource_id);
