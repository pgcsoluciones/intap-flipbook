-- Fase 3 Paso 2 — Plantilla predefinida "Inmobiliaria / Construcción"
-- Ejecutar: npx wrangler d1 execute intap-flipbook-db --file=src/db/migration_fase3_inmobiliaria_template.sql --remote
--
-- IMPORTANTE: Esta migración también crea la tabla `units` si no existe.
-- La tabla units guarda las unidades (departamentos, locales, etc.) de un proyecto inmobiliario,
-- con estado disponible/reservada/vendida, precio, superficie en m² y otras características.

-- ── Tabla units ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS units (
  id           TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id),
  page_id      TEXT REFERENCES pages(id),      -- página del plano donde aparece la unidad (opcional)
  name         TEXT NOT NULL,                   -- ej. "Depto 3A", "Local 101"
  status       TEXT DEFAULT 'available'         -- available | reserved | sold
                CHECK (status IN ('available', 'reserved', 'sold')),
  price        REAL,                            -- precio de venta/alquiler
  area_m2      REAL,                            -- superficie en metros cuadrados
  bedrooms     INTEGER,                         -- dormitorios
  bathrooms    INTEGER,                         -- baños
  floor        INTEGER,                         -- piso (número)
  unit_number  TEXT,                            -- número o letra de la unidad (ej. "3A")
  description  TEXT,                            -- notas adicionales
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_units_publication ON units(publication_id);
CREATE INDEX IF NOT EXISTS idx_units_status      ON units(publication_id, status);

-- ── Categoría "Inmobiliaria" ──────────────────────────────────────────────────
-- Agrega la categoría solo si no existe (INSERT OR IGNORE requiere que slug sea UNIQUE,
-- lo cual está definido en el schema).
INSERT OR IGNORE INTO categories (name, slug) VALUES ('Inmobiliaria', 'inmobiliaria');

-- ── Plantilla inmobiliaria ────────────────────────────────────────────────────
-- Usamos una variable temporal via WITH para obtener el category_id recién insertado.
-- SQLite no soporta variables de sesión, por lo que referenciamos por subconsulta.
INSERT OR IGNORE INTO templates (name, category_id, plan_required, cover_url, active, sort_order)
SELECT
  'Proyecto Inmobiliario',
  (SELECT id FROM categories WHERE slug = 'inmobiliaria'),
  'free',
  NULL,
  1,
  10
WHERE NOT EXISTS (
  SELECT 1 FROM templates WHERE name = 'Proyecto Inmobiliario'
);

-- ── Páginas tipo de la plantilla ─────────────────────────────────────────────
-- canvas_json contiene un JSON mínimo descriptivo como placeholder.
-- En producción, el editor reemplaza este contenido con el diseño real.

-- Página 1 — Portada del proyecto
INSERT OR IGNORE INTO template_pages (template_id, image_url, page_number, canvas_json)
SELECT
  (SELECT id FROM templates WHERE name = 'Proyecto Inmobiliario'),
  '',   -- sin imagen placeholder por defecto
  1,
  '{"version":"5.3.0","objects":[],"_meta":{"title":"Portada del proyecto","description":"Nombre del proyecto, imagen hero y logo del desarrollador"}}'
WHERE NOT EXISTS (
  SELECT 1 FROM template_pages
  WHERE template_id = (SELECT id FROM templates WHERE name = 'Proyecto Inmobiliario')
    AND page_number = 1
);

-- Página 2 — Ubicación / Mapa
INSERT OR IGNORE INTO template_pages (template_id, image_url, page_number, canvas_json)
SELECT
  (SELECT id FROM templates WHERE name = 'Proyecto Inmobiliario'),
  '',
  2,
  '{"version":"5.3.0","objects":[],"_meta":{"title":"Ubicación y mapa","description":"Dirección, mapa interactivo y puntos de interés cercanos (escuelas, transporte, comercios)"}}'
WHERE NOT EXISTS (
  SELECT 1 FROM template_pages
  WHERE template_id = (SELECT id FROM templates WHERE name = 'Proyecto Inmobiliario')
    AND page_number = 2
);

-- Página 3 — Fachada y exteriores
INSERT OR IGNORE INTO template_pages (template_id, image_url, page_number, canvas_json)
SELECT
  (SELECT id FROM templates WHERE name = 'Proyecto Inmobiliario'),
  '',
  3,
  '{"version":"5.3.0","objects":[],"_meta":{"title":"Fachada y exteriores","description":"Galería de imágenes de la fachada y vistas exteriores del edificio o desarrollo"}}'
WHERE NOT EXISTS (
  SELECT 1 FROM template_pages
  WHERE template_id = (SELECT id FROM templates WHERE name = 'Proyecto Inmobiliario')
    AND page_number = 3
);

-- Página 4 — Plantas y unidades
INSERT OR IGNORE INTO template_pages (template_id, image_url, page_number, canvas_json)
SELECT
  (SELECT id FROM templates WHERE name = 'Proyecto Inmobiliario'),
  '',
  4,
  '{"version":"5.3.0","objects":[],"_meta":{"title":"Plantas y unidades","description":"Plano de planta con tabla de unidades: disponible / reservada / vendida, precio, m² y ambientes"}}'
WHERE NOT EXISTS (
  SELECT 1 FROM template_pages
  WHERE template_id = (SELECT id FROM templates WHERE name = 'Proyecto Inmobiliario')
    AND page_number = 4
);

-- Página 5 — Amenidades
INSERT OR IGNORE INTO template_pages (template_id, image_url, page_number, canvas_json)
SELECT
  (SELECT id FROM templates WHERE name = 'Proyecto Inmobiliario'),
  '',
  5,
  '{"version":"5.3.0","objects":[],"_meta":{"title":"Amenidades","description":"Galería de amenidades del proyecto: pileta, gimnasio, SUM, terrazas, jardines, cocheras"}}'
WHERE NOT EXISTS (
  SELECT 1 FROM template_pages
  WHERE template_id = (SELECT id FROM templates WHERE name = 'Proyecto Inmobiliario')
    AND page_number = 5
);

-- Página 6 — Financiamiento
INSERT OR IGNORE INTO template_pages (template_id, image_url, page_number, canvas_json)
SELECT
  (SELECT id FROM templates WHERE name = 'Proyecto Inmobiliario'),
  '',
  6,
  '{"version":"5.3.0","objects":[],"_meta":{"title":"Financiamiento","description":"Condiciones de pago, cuotas, planes de financiación y datos de contacto del banco o fiduciaria"}}'
WHERE NOT EXISTS (
  SELECT 1 FROM template_pages
  WHERE template_id = (SELECT id FROM templates WHERE name = 'Proyecto Inmobiliario')
    AND page_number = 6
);

-- Página 7 — Contacto final
INSERT OR IGNORE INTO template_pages (template_id, image_url, page_number, canvas_json)
SELECT
  (SELECT id FROM templates WHERE name = 'Proyecto Inmobiliario'),
  '',
  7,
  '{"version":"5.3.0","objects":[],"_meta":{"title":"Contacto","description":"Formulario de contacto, botón de WhatsApp, dirección y datos de la desarrolladora o inmobiliaria"}}'
WHERE NOT EXISTS (
  SELECT 1 FROM template_pages
  WHERE template_id = (SELECT id FROM templates WHERE name = 'Proyecto Inmobiliario')
    AND page_number = 7
);
