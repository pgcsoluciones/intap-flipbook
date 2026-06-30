-- Intap Flipbook — D1 Schema completo (actualizado Fase 8A)
-- Para base de datos nueva: wrangler d1 execute intap-flipbook-db --file=apps/api/src/db/schema.sql --remote
-- Para base existente: usar migration_fase8a.sql

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  max_publications INTEGER,      -- NULL = ilimitado
  max_pages_per_pub INTEGER,     -- NULL = ilimitado
  max_storage_mb INTEGER,
  custom_domain INTEGER DEFAULT 0,
  sound_enabled INTEGER DEFAULT 0,
  price_usd REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  plan_id TEXT DEFAULT 'free' REFERENCES plans(id),
  plan_expires_at TEXT,
  grace_period_days INTEGER DEFAULT 3,
  referral_code TEXT UNIQUE,
  referred_by TEXT REFERENCES users(id),
  watermark_override TEXT DEFAULT 'plan', -- 'plan' | 'force_show' | 'force_hide'
  is_admin INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  folder_id TEXT REFERENCES folders(id),
  status TEXT DEFAULT 'draft',
  public_slug TEXT UNIQUE,
  cover_image_url TEXT,
  views_count INTEGER DEFAULT 0,
  sound_enabled INTEGER DEFAULT 0,
  contact_form_enabled INTEGER DEFAULT 0,
  share_buttons_enabled INTEGER DEFAULT 1,
  social_title TEXT,
  social_description TEXT,
  social_image_url TEXT,
  social_image_source_url TEXT,
  social_image_crop_json TEXT,
  social_updated_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id),
  page_number INTEGER NOT NULL,
  image_url TEXT NOT NULL,
  size_bytes INTEGER DEFAULT 0,
  title TEXT,
  description TEXT,
  price TEXT,
  canvas_json TEXT,
  cover_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plan_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  from_plan TEXT,
  to_plan TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plan_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  requested_plan TEXT NOT NULL,
  direction TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  method TEXT NOT NULL,
  gateway TEXT,
  reference TEXT,
  status TEXT DEFAULT 'paid',
  plan_paid TEXT NOT NULL,
  period_days INTEGER DEFAULT 30,
  notes TEXT,
  registered_by TEXT REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payment_gateways (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config_json TEXT,
  instructions TEXT,
  active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  active_globally INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS plan_modules (
  plan_id TEXT NOT NULL,
  module_key TEXT NOT NULL REFERENCES modules(key),
  PRIMARY KEY (plan_id, module_key)
);

CREATE TABLE IF NOT EXISTS tenant_modules (
  user_id TEXT NOT NULL REFERENCES users(id),
  module_key TEXT NOT NULL REFERENCES modules(key),
  enabled INTEGER DEFAULT 1,
  PRIMARY KEY (user_id, module_key)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS publication_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publication_id TEXT NOT NULL REFERENCES publications(id),
  page_number INTEGER,
  device TEXT,
  viewed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  plan_required TEXT DEFAULT 'free',
  cover_url TEXT,
  active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS template_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES templates(id),
  image_url TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  canvas_json TEXT
);

CREATE TABLE IF NOT EXISTS editor_elements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  file_url TEXT NOT NULL,
  plan_required TEXT DEFAULT 'free',
  active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tutorials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  type TEXT NOT NULL,
  url TEXT,
  content TEXT,
  thumbnail_url TEXT,
  sort_order INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tutorial_views (
  user_id TEXT NOT NULL REFERENCES users(id),
  tutorial_id INTEGER NOT NULL REFERENCES tutorials(id),
  viewed_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, tutorial_id)
);

CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  benefit_type TEXT NOT NULL,
  benefit_value TEXT NOT NULL,
  target_plans TEXT NOT NULL,
  cta_text TEXT,
  cta_url TEXT,
  promo_code TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS referral_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  active INTEGER DEFAULT 1,
  reward_type TEXT DEFAULT 'free_days',
  reward_value INTEGER DEFAULT 15,
  activation_condition TEXT DEFAULT 'paid_plan',
  link_validity_days INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id TEXT NOT NULL REFERENCES users(id),
  referred_id TEXT NOT NULL REFERENCES users(id),
  status TEXT DEFAULT 'pending',
  reward_applied INTEGER DEFAULT 0,
  reject_reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS watermark_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  text TEXT DEFAULT 'Creado con Intap Flipbook',
  logo_url TEXT,
  link_url TEXT DEFAULT 'https://intapflipbook.com',
  position TEXT DEFAULT 'bottom-right',
  opacity INTEGER DEFAULT 80
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_publications_user_id ON publications(user_id);
CREATE INDEX IF NOT EXISTS idx_publications_slug ON publications(public_slug);
CREATE INDEX IF NOT EXISTS idx_pages_publication_id ON pages(publication_id);
CREATE INDEX IF NOT EXISTS idx_pages_order ON pages(publication_id, page_number);
CREATE INDEX IF NOT EXISTS idx_plan_history_user ON plan_history(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_requests_user ON plan_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_requests_status ON plan_requests(status);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_pub_views_pub ON publication_views(publication_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);

-- Seeds: Planes
INSERT OR IGNORE INTO plans VALUES ('free',  'Free',  1,    10,   50,   0, 0, 0);
INSERT OR IGNORE INTO plans VALUES ('basic', 'Basic', 5,    50,   500,  0, 1, 9.99);
INSERT OR IGNORE INTO plans VALUES ('pro',   'Pro',   NULL, NULL, 5120, 1, 1, 29.99);

-- Seeds: Categorías
INSERT OR IGNORE INTO categories (name, slug) VALUES
  ('Catálogo',   'catalogo'),
  ('Menú',       'menu'),
  ('Portafolio', 'portafolio'),
  ('Revista',    'revista'),
  ('Folleto',    'folleto'),
  ('Otro',       'otro');

-- Seeds: Marca de agua
INSERT OR IGNORE INTO watermark_config (id, text, link_url, position, opacity)
  VALUES (1, 'Creado con Intap Flipbook', 'https://intapflipbook.com', 'bottom-right', 80);

-- Seeds: Referidos
INSERT OR IGNORE INTO referral_config (id, active, reward_type, reward_value, activation_condition, link_validity_days)
  VALUES (1, 1, 'free_days', 15, 'paid_plan', 0);

-- Seeds: Módulos
INSERT OR IGNORE INTO modules (key, name, description) VALUES
  ('sound',           'Sonido al voltear',       'Efecto de sonido al pasar páginas'),
  ('editor',          'Editor en línea',          'Edición de elementos sobre el canvas'),
  ('links',           'Links activos',            'Botones y enlaces clicables en el flipbook'),
  ('contact_form',    'Formulario de contacto',   'Formulario flotante en el viewer'),
  ('qr',              'Código QR',                'QR descargable del flipbook'),
  ('share_buttons',   'Botones de compartir',     'Compartir en redes sociales'),
  ('stats_advanced',  'Estadísticas avanzadas',   'Vistas por página y dispositivo'),
  ('custom_domain',   'Dominio personalizado',    'URL propia para el viewer'),
  ('watermark_hide',  'Ocultar marca de agua',    'Ocultar la marca de Intap'),
  ('templates_basic', 'Plantillas Basic',         'Plantillas del plan Basic'),
  ('templates_pro',   'Plantillas Pro',           'Plantillas del plan Pro');

-- Seeds: Módulos por plan
INSERT OR IGNORE INTO plan_modules (plan_id, module_key) VALUES
  ('free',  'share_buttons'),
  ('free',  'qr'),
  ('basic', 'sound'),('basic', 'editor'),('basic', 'links'),('basic', 'contact_form'),
  ('basic', 'qr'),('basic', 'share_buttons'),('basic', 'stats_advanced'),
  ('basic', 'watermark_hide'),('basic', 'templates_basic'),
  ('pro',   'sound'),('pro', 'editor'),('pro', 'links'),('pro', 'contact_form'),
  ('pro',   'qr'),('pro', 'share_buttons'),('pro', 'stats_advanced'),
  ('pro',   'custom_domain'),('pro', 'watermark_hide'),
  ('pro',   'templates_basic'),('pro', 'templates_pro');
