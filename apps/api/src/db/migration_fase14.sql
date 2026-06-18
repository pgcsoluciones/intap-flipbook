-- Fase 14 — Analíticas avanzadas: tiempo por página + clics en botones dinámicos
--
-- Tabla "bitácora" de eventos del visor. Cada fila es un acontecimiento:
--   * type = 'page_time' → cuánto tiempo (duration_ms) estuvo el visitante en page_number
--   * type = 'click'     → hizo clic en un botón/enlace/widget identificado por label
-- Se llena de forma anónima desde el visor público (sin login).

CREATE TABLE IF NOT EXISTS page_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publication_id TEXT NOT NULL REFERENCES publications(id),
  type TEXT NOT NULL,            -- 'page_time' | 'click'
  page_number INTEGER,          -- página donde ocurrió (1-based)
  label TEXT,                   -- etiqueta del botón / tipo de acción (solo clicks)
  action_type TEXT,             -- 'link' | 'whatsapp' | 'call' | 'widget' | ... (solo clicks)
  duration_ms INTEGER,          -- milisegundos en la página (solo page_time)
  device TEXT,                  -- 'desktop' | 'tablet' | 'mobile'
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_page_events_pub ON page_events(publication_id);
CREATE INDEX IF NOT EXISTS idx_page_events_type ON page_events(publication_id, type);
