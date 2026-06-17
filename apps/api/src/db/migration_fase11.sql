-- Fase 11 — Repositorio de respuestas de formularios y cuestionarios
-- Cada vez que un visitante envía un formulario de contacto o responde un
-- cuestionario en el viewer, se guarda aquí para que el dueño (tenant) lo vea.

CREATE TABLE IF NOT EXISTS form_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publication_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,          -- user_id dueño de la publicación
  kind TEXT NOT NULL,              -- 'contact' | 'quiz'
  widget_key TEXT,                 -- identificador del widget dentro de la página
  payload TEXT NOT NULL,           -- JSON con los campos/respuestas
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_form_responses_owner ON form_responses(owner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_form_responses_pub ON form_responses(publication_id);
