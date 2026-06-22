-- Tabla de unidades para vertical inmobiliaria/construcción
CREATE TABLE IF NOT EXISTS units (
  id          TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id),
  page_id     TEXT REFERENCES pages(id),
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','reserved','sold')),
  price       REAL,
  area_m2     REAL,
  bedrooms    INTEGER,
  bathrooms   INTEGER,
  description TEXT,
  floor       INTEGER,
  unit_number TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_units_publication ON units(publication_id);
CREATE INDEX IF NOT EXISTS idx_units_status ON units(status);
