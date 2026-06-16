-- Intap Flipbook — Migración Fase 8A
-- Ejecutar: wrangler d1 execute intap-flipbook-db --file=apps/api/src/db/migration_fase8a.sql --remote
-- Este archivo SOLO agrega lo que falta. No toca lo existente.

-- ─────────────────────────────────────────────
-- 1. CORREGIR LÍMITES DE PLANES
-- (los valores actuales no coinciden con el spec)
-- ─────────────────────────────────────────────
UPDATE plans SET max_pages_per_pub = 10,  max_storage_mb = 50,   price_usd = 0     WHERE id = 'free';
UPDATE plans SET max_pages_per_pub = 50,  max_storage_mb = 500,  price_usd = 9.99  WHERE id = 'basic';
UPDATE plans SET max_pages_per_pub = NULL, max_storage_mb = 5120, price_usd = 29.99 WHERE id = 'pro';

-- ─────────────────────────────────────────────
-- 2. COLUMNAS FALTANTES EN TABLAS EXISTENTES
-- (ALTER TABLE en SQLite/D1 solo permite ADD COLUMN)
-- ─────────────────────────────────────────────

-- users: campos de expiración de plan, referidos y marca de agua
ALTER TABLE users ADD COLUMN plan_expires_at TEXT;
ALTER TABLE users ADD COLUMN grace_period_days INTEGER DEFAULT 3;
ALTER TABLE users ADD COLUMN referral_code TEXT;
ALTER TABLE users ADD COLUMN referred_by TEXT REFERENCES users(id);
ALTER TABLE users ADD COLUMN watermark_override TEXT DEFAULT 'plan';
-- 'plan' = seguir regla del plan | 'force_show' = forzar marca | 'force_hide' = ocultar siempre
ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0;
-- 1 = Super Admin

-- publications: campos faltantes del spec
ALTER TABLE publications ADD COLUMN folder_id TEXT REFERENCES folders(id);
ALTER TABLE publications ADD COLUMN views_count INTEGER DEFAULT 0;
ALTER TABLE publications ADD COLUMN contact_form_enabled INTEGER DEFAULT 0;
ALTER TABLE publications ADD COLUMN share_buttons_enabled INTEGER DEFAULT 1;

-- pages: campo para editor en línea con Fabric.js
ALTER TABLE pages ADD COLUMN canvas_json TEXT;

-- ─────────────────────────────────────────────
-- 3. TABLAS NUEVAS
-- ─────────────────────────────────────────────

-- Categorías de flipbook (usadas en publications y templates)
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Carpetas/colecciones del tenant
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Historial de cambios de plan (auditoría)
CREATE TABLE IF NOT EXISTS plan_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  from_plan TEXT,
  to_plan TEXT NOT NULL,
  changed_by TEXT NOT NULL, -- 'admin' | 'system' | 'user'
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Solicitudes de cambio de plan (el tenant pide, el admin aprueba)
CREATE TABLE IF NOT EXISTS plan_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  requested_plan TEXT NOT NULL,
  direction TEXT NOT NULL, -- 'upgrade' | 'downgrade'
  status TEXT DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by TEXT REFERENCES users(id)
);

-- Registro de pagos (registrados manualmente por el Admin en v1)
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'USD', -- 'USD' | 'DOP'
  method TEXT NOT NULL, -- 'transfer' | 'deposit' | 'paypal' | 'readdy' | 'other'
  gateway TEXT,
  reference TEXT,
  status TEXT DEFAULT 'paid', -- 'paid' | 'pending' | 'expired' | 'refunded'
  plan_paid TEXT NOT NULL,
  period_days INTEGER DEFAULT 30,
  notes TEXT,
  registered_by TEXT REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Pasarelas de pago configurables por el Admin
CREATE TABLE IF NOT EXISTS payment_gateways (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'transfer' | 'deposit' | 'paypal' | 'readdy' | 'custom'
  config_json TEXT,  -- credenciales y configuración como JSON cifrado
  instructions TEXT, -- instrucciones visibles al tenant
  active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);

-- Módulos del sistema (funcionalidades activables por plan)
CREATE TABLE IF NOT EXISTS modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,   -- ej: 'sound', 'editor', 'qr', 'stats_advanced'
  name TEXT NOT NULL,
  description TEXT,
  active_globally INTEGER DEFAULT 1
);

-- Módulos incluidos en cada plan
CREATE TABLE IF NOT EXISTS plan_modules (
  plan_id TEXT NOT NULL,
  module_key TEXT NOT NULL REFERENCES modules(key),
  PRIMARY KEY (plan_id, module_key)
);

-- Excepciones de módulos por tenant (el Admin puede dar o quitar módulos individualmente)
CREATE TABLE IF NOT EXISTS tenant_modules (
  user_id TEXT NOT NULL REFERENCES users(id),
  module_key TEXT NOT NULL REFERENCES modules(key),
  enabled INTEGER DEFAULT 1,
  PRIMARY KEY (user_id, module_key)
);

-- Notificaciones in-app (del Admin a tenants)
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,  -- NULL = broadcast a todos
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Estadísticas de vistas de publicaciones
CREATE TABLE IF NOT EXISTS publication_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publication_id TEXT NOT NULL REFERENCES publications(id),
  page_number INTEGER,
  device TEXT, -- 'desktop' | 'tablet' | 'mobile'
  viewed_at TEXT DEFAULT (datetime('now'))
);

-- Plantillas prediseñadas (el Admin las crea)
CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  plan_required TEXT DEFAULT 'free', -- 'free' | 'basic' | 'pro'
  cover_url TEXT,
  active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Páginas de cada plantilla
CREATE TABLE IF NOT EXISTS template_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES templates(id),
  image_url TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  canvas_json TEXT
);

-- Elementos del editor (íconos, fondos, formas, botones prediseñados)
CREATE TABLE IF NOT EXISTS editor_elements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'icon' | 'background' | 'shape' | 'button'
  file_url TEXT NOT NULL,
  plan_required TEXT DEFAULT 'free',
  active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Tutoriales y guías
CREATE TABLE IF NOT EXISTS tutorials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL, -- 'getting_started' | 'editor' | 'publish' | 'plans'
  type TEXT NOT NULL,      -- 'video' | 'guide'
  url TEXT,                -- URL de YouTube/Vimeo si type = 'video'
  content TEXT,            -- texto HTML si type = 'guide'
  thumbnail_url TEXT,
  sort_order INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Seguimiento de tutoriales vistos por tenant
CREATE TABLE IF NOT EXISTS tutorial_views (
  user_id TEXT NOT NULL REFERENCES users(id),
  tutorial_id INTEGER NOT NULL REFERENCES tutorials(id),
  viewed_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, tutorial_id)
);

-- Promociones (el Admin las crea, aparecen automáticamente según plan del tenant)
CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  benefit_type TEXT NOT NULL,  -- 'discount_percent' | 'free_days' | 'temp_upgrade'
  benefit_value TEXT NOT NULL, -- número de días, % o nombre de plan temporal
  target_plans TEXT NOT NULL,  -- 'all' o JSON: '["free","basic"]'
  cta_text TEXT,
  cta_url TEXT,
  promo_code TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT DEFAULT 'active', -- 'active' | 'paused' | 'scheduled'
  created_at TEXT DEFAULT (datetime('now'))
);

-- Configuración global del programa de referidos
CREATE TABLE IF NOT EXISTS referral_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  active INTEGER DEFAULT 1,
  reward_type TEXT DEFAULT 'free_days',        -- 'free_days' | 'discount_percent'
  reward_value INTEGER DEFAULT 15,             -- días o porcentaje
  activation_condition TEXT DEFAULT 'paid_plan', -- 'registered' | 'paid_plan'
  link_validity_days INTEGER DEFAULT 0         -- 0 = sin límite
);

-- Referidos entre tenants
CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id TEXT NOT NULL REFERENCES users(id),
  referred_id TEXT NOT NULL REFERENCES users(id),
  status TEXT DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  reward_applied INTEGER DEFAULT 0,
  reject_reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by TEXT REFERENCES users(id)
);

-- Configuración de marca de agua global
CREATE TABLE IF NOT EXISTS watermark_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  text TEXT DEFAULT 'Creado con Intap Flipbook',
  logo_url TEXT,
  link_url TEXT DEFAULT 'https://intapflipbook.com',
  position TEXT DEFAULT 'bottom-right', -- 'bottom-right' | 'bottom-left' | 'bottom-center'
  opacity INTEGER DEFAULT 80            -- 10 a 100
);

-- ─────────────────────────────────────────────
-- 4. ÍNDICES NUEVOS
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_plan_history_user ON plan_history(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_requests_user ON plan_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_requests_status ON plan_requests(status);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_pub_views_pub ON publication_views(publication_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL;

-- ─────────────────────────────────────────────
-- 5. SEEDS INICIALES
-- ─────────────────────────────────────────────

-- Categorías base
INSERT OR IGNORE INTO categories (name, slug) VALUES
  ('Catálogo', 'catalogo'),
  ('Menú', 'menu'),
  ('Portafolio', 'portafolio'),
  ('Revista', 'revista'),
  ('Folleto', 'folleto'),
  ('Otro', 'otro');

-- Configuración inicial de marca de agua
INSERT OR IGNORE INTO watermark_config (id, text, link_url, position, opacity)
  VALUES (1, 'Creado con Intap Flipbook', 'https://intapflipbook.com', 'bottom-right', 80);

-- Configuración inicial del programa de referidos
INSERT OR IGNORE INTO referral_config (id, active, reward_type, reward_value, activation_condition, link_validity_days)
  VALUES (1, 1, 'free_days', 15, 'paid_plan', 0);

-- Módulos del sistema
INSERT OR IGNORE INTO modules (key, name, description) VALUES
  ('sound',           'Sonido al voltear',          'Efecto de sonido al pasar páginas en el viewer'),
  ('editor',          'Editor en línea',             'Edición de elementos sobre el canvas de cada página'),
  ('links',           'Links activos en páginas',    'Botones y enlaces clicables dentro del flipbook'),
  ('contact_form',    'Formulario de contacto',      'Formulario flotante de contacto en el viewer'),
  ('qr',              'Código QR',                   'Generación de QR descargable del flipbook'),
  ('share_buttons',   'Botones de compartir',        'Botones de compartir en redes sociales en el viewer'),
  ('stats_advanced',  'Estadísticas avanzadas',      'Vistas por página, dispositivo y período'),
  ('custom_domain',   'Dominio personalizado',       'URL propia para el viewer del flipbook'),
  ('watermark_hide',  'Ocultar marca de agua',       'Posibilidad de ocultar la marca de agua de Intap'),
  ('templates_basic', 'Plantillas Basic',            'Acceso a plantillas del plan Basic'),
  ('templates_pro',   'Plantillas Pro',              'Acceso a plantillas del plan Pro');

-- Módulos incluidos por plan
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
