-- Seed seguro para tabla modules y plan_modules
-- Ejecutar: wrangler d1 execute intap-flipbook-db --remote --file=src/db/seed_modules.sql

CREATE TABLE IF NOT EXISTS modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  active_globally INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS plan_modules (
  plan_id TEXT NOT NULL,
  module_key TEXT NOT NULL,
  PRIMARY KEY (plan_id, module_key)
);

INSERT OR IGNORE INTO modules (key, name, description) VALUES
  ('sound',           'Sonido al voltear',       'Efecto de sonido al pasar páginas en el viewer'),
  ('editor',          'Editor en línea',          'Editor visual de páginas con canvas interactivo'),
  ('links',           'Links activos',            'Botones y enlaces clicables dentro del flipbook'),
  ('contact_form',    'Formulario de contacto',   'Formulario de contacto embebido en el viewer'),
  ('qr',              'Código QR',                'Código QR descargable generado automáticamente'),
  ('share_buttons',   'Botones de compartir',     'Botones para compartir en redes sociales'),
  ('stats_advanced',  'Estadísticas avanzadas',   'Métricas detalladas de visualizaciones y clics'),
  ('custom_domain',   'Dominio personalizado',    'URL propia para el viewer del flipbook'),
  ('watermark_hide',  'Ocultar marca de agua',    'Ocultar la marca de agua de Intap en el viewer'),
  ('templates_basic', 'Plantillas Basic',         'Acceso a plantillas del plan Basic'),
  ('templates_pro',   'Plantillas Pro',           'Acceso a plantillas del plan Pro');

INSERT OR IGNORE INTO plan_modules (plan_id, module_key) VALUES
  ('free',  'share_buttons'),
  ('free',  'qr'),
  ('basic', 'sound'),
  ('basic', 'editor'),
  ('basic', 'links'),
  ('basic', 'contact_form'),
  ('basic', 'qr'),
  ('basic', 'share_buttons'),
  ('basic', 'stats_advanced'),
  ('basic', 'watermark_hide'),
  ('basic', 'templates_basic'),
  ('pro',   'sound'),
  ('pro',   'editor'),
  ('pro',   'links'),
  ('pro',   'contact_form'),
  ('pro',   'qr'),
  ('pro',   'share_buttons'),
  ('pro',   'stats_advanced'),
  ('pro',   'custom_domain'),
  ('pro',   'watermark_hide'),
  ('pro',   'templates_basic'),
  ('pro',   'templates_pro');
