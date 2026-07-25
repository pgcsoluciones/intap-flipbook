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

CREATE TABLE IF NOT EXISTS media_folders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES users(id),
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES users(id),
  publication_id TEXT NOT NULL REFERENCES publications(id),
  folder_id TEXT REFERENCES media_folders(id) ON DELETE SET NULL,
  storage_bucket TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  public_url TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  original_mime_type TEXT,
  original_size_bytes INTEGER,
  original_width INTEGER,
  original_height INTEGER,
  thumbnail_storage_key TEXT,
  thumbnail_url TEXT,
  thumbnail_mime_type TEXT,
  thumbnail_size_bytes INTEGER,
  thumbnail_width INTEGER,
  thumbnail_height INTEGER,
  optimized_storage_key TEXT,
  optimized_url TEXT,
  optimized_mime_type TEXT,
  optimized_size_bytes INTEGER,
  optimized_width INTEGER,
  optimized_height INTEGER,
  optimization_status TEXT,
  optimization_version TEXT,
  optimized_at TEXT,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
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

CREATE TABLE IF NOT EXISTS dynamic_markers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  target_object_id TEXT NOT NULL,
  target_kind TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'inactive')),
  name TEXT,
  reference TEXT,
  category TEXT,
  description TEXT,
  price_minor INTEGER,
  previous_price_minor INTEGER,
  currency TEXT,
  availability TEXT,
  promotion_text TEXT,
  accent_color TEXT NOT NULL DEFAULT '#F59E0B',
  badge_text TEXT,
  promotion_ends_at TEXT,
  post_promotion_price_minor INTEGER,
  colors_json TEXT NOT NULL DEFAULT '[]',
  materials_json TEXT NOT NULL DEFAULT '[]',
  sizes_json TEXT NOT NULL DEFAULT '[]',
  measurements_json TEXT NOT NULL DEFAULT '[]',
  media_json TEXT NOT NULL DEFAULT '[]',
  actions_json TEXT NOT NULL DEFAULT '{}',
  custom_fields_json TEXT NOT NULL DEFAULT '[]',
  cloned_from_marker_id TEXT REFERENCES dynamic_markers(id),
  booking_calendar_id TEXT REFERENCES appointment_calendars(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(publication_id, page_id, target_object_id)
);

CREATE TABLE IF NOT EXISTS product_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES users(id),
  internal_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  price TEXT,
  image_url TEXT,
  accent_color TEXT NOT NULL DEFAULT '#4F46E5',
  cta_type TEXT,
  cta_label TEXT,
  cta_target TEXT,
  status TEXT NOT NULL DEFAULT 'inactive'
    CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, internal_name),
  CHECK (length(trim(internal_name)) > 0),
  CHECK (length(trim(title)) > 0)
);

CREATE TABLE IF NOT EXISTS appointment_calendars (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Santo_Domingo',
  slot_interval_minutes INTEGER NOT NULL DEFAULT 30,
  default_duration_minutes INTEGER NOT NULL DEFAULT 60,
  default_buffer_minutes INTEGER NOT NULL DEFAULT 0,
  max_per_slot INTEGER NOT NULL DEFAULT 1,
  max_per_day INTEGER NOT NULL DEFAULT 8,
  min_notice_minutes INTEGER NOT NULL DEFAULT 120,
  booking_horizon_days INTEGER NOT NULL DEFAULT 30,
  hold_expires_after_minutes INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (slot_interval_minutes BETWEEN 5 AND 240),
  CHECK (default_duration_minutes BETWEEN 5 AND 1440),
  CHECK (default_buffer_minutes BETWEEN 0 AND 1440),
  CHECK (max_per_slot BETWEEN 1 AND 999),
  CHECK (max_per_day BETWEEN 1 AND 999),
  CHECK (min_notice_minutes BETWEEN 0 AND 525600),
  CHECK (booking_horizon_days BETWEEN 1 AND 730),
  CHECK (hold_expires_after_minutes BETWEEN 1 AND 10080)
);

CREATE TABLE IF NOT EXISTS appointment_calendar_weekly_windows (
  id TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL REFERENCES appointment_calendars(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (weekday BETWEEN 0 AND 6),
  CHECK (start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  CHECK (end_time GLOB '[0-2][0-9]:[0-5][0-9]')
);

CREATE TABLE IF NOT EXISTS appointment_calendar_exceptions (
  id TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL REFERENCES appointment_calendars(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('blocked_full', 'blocked_partial', 'extra')),
  start_time TEXT,
  end_time TEXT,
  max_per_slot_override INTEGER,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  CHECK (start_time IS NULL OR start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  CHECK (end_time IS NULL OR end_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  CHECK (max_per_slot_override IS NULL OR max_per_slot_override BETWEEN 1 AND 999)
);

CREATE TABLE IF NOT EXISTS appointment_calendar_types (
  id TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL REFERENCES appointment_calendars(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  duration_minutes INTEGER,
  buffer_minutes INTEGER,
  max_per_slot INTEGER,
  delivery_mode TEXT NOT NULL DEFAULT 'in_person'
    CHECK (delivery_mode IN ('in_person', 'video_call', 'phone_call', 'other')),
  location_text TEXT,
  meeting_url TEXT,
  customer_instructions TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 5 AND 1440),
  CHECK (buffer_minutes IS NULL OR buffer_minutes BETWEEN 0 AND 1440),
  CHECK (max_per_slot IS NULL OR max_per_slot BETWEEN 1 AND 999)
);

CREATE TABLE IF NOT EXISTS appointment_calendar_bookings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  publication_id TEXT NOT NULL REFERENCES publications(id),
  marker_id TEXT NOT NULL REFERENCES dynamic_markers(id),
  calendar_id TEXT NOT NULL REFERENCES appointment_calendars(id),
  appointment_type TEXT NOT NULL,
  starts_at_utc TEXT NOT NULL,
  ends_at_utc TEXT NOT NULL,
  local_date TEXT NOT NULL,
  local_time TEXT NOT NULL,
  timezone TEXT NOT NULL,
  delivery_mode_snapshot TEXT,
  location_snapshot TEXT,
  customer_instructions_snapshot TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'rejected', 'expired')),
  hold_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS appointment_slot_allocations (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES appointment_calendar_bookings(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL REFERENCES appointment_calendars(id),
  slot_start_utc TEXT NOT NULL,
  capacity_unit INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(calendar_id, slot_start_utc, capacity_unit)
);

CREATE TABLE IF NOT EXISTS lead_intakes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES users(id),
  publication_id TEXT NOT NULL REFERENCES publications(id),
  marker_id TEXT NOT NULL REFERENCES dynamic_markers(id),
  request_type TEXT NOT NULL DEFAULT 'quote',
  status TEXT NOT NULL DEFAULT 'new',
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  customer_message TEXT,
  marker_snapshot_json TEXT NOT NULL,
  selection_json TEXT,
  source_url TEXT,
  internal_note TEXT,
  crm_contact_id TEXT,
  crm_lead_id TEXT,
  booking_id TEXT,
  read_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  handled_at TEXT
);

CREATE TABLE IF NOT EXISTS lead_intake_customer_messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES users(id),
  lead_intake_id TEXT NOT NULL REFERENCES lead_intakes(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'quote_sent',
    'booking_confirmed',
    'booking_rejected',
    'booking_cancelled',
    'booking_rescheduled'
  )),
  channel TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp')),
  message_text TEXT NOT NULL,
  note_text TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'opened', 'sent')),
  opened_at TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lead_intake_customer_message_attachments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES users(id),
  lead_intake_id TEXT NOT NULL REFERENCES lead_intakes(id) ON DELETE CASCADE,
  customer_message_id TEXT NOT NULL UNIQUE REFERENCES lead_intake_customer_messages(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  download_token_hash TEXT UNIQUE,
  download_expires_at TEXT,
  downloaded_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_assets_dedup ON media_assets(tenant_id, publication_id, storage_bucket, sha256);
CREATE INDEX IF NOT EXISTS idx_media_assets_publication_recent ON media_assets(tenant_id, publication_id, storage_bucket, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_media_assets_publication_name ON media_assets(tenant_id, publication_id, original_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_folders_publication_name ON media_folders(tenant_id, publication_id, name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_media_folders_publication_created ON media_folders(tenant_id, publication_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_media_assets_folder_recent ON media_assets(tenant_id, publication_id, folder_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_dynamic_markers_publication ON dynamic_markers(publication_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_dynamic_markers_page ON dynamic_markers(page_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_dynamic_markers_status ON dynamic_markers(publication_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_dynamic_markers_user_updated ON dynamic_markers(user_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_dynamic_markers_user_status_updated ON dynamic_markers(user_id, status, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_dynamic_markers_user_publication_updated ON dynamic_markers(user_id, publication_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_dynamic_markers_booking_calendar ON dynamic_markers(booking_calendar_id);
CREATE INDEX IF NOT EXISTS idx_appointment_calendars_user ON appointment_calendars(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointment_windows_calendar ON appointment_calendar_weekly_windows(calendar_id, weekday, sort_order);
CREATE INDEX IF NOT EXISTS idx_appointment_exceptions_calendar ON appointment_calendar_exceptions(calendar_id, date);
CREATE INDEX IF NOT EXISTS idx_appointment_types_calendar ON appointment_calendar_types(calendar_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_appointment_calendar_bookings_calendar_time ON appointment_calendar_bookings(calendar_id, starts_at_utc);
CREATE INDEX IF NOT EXISTS idx_appointment_calendar_bookings_calendar_local_date ON appointment_calendar_bookings(calendar_id, local_date, starts_at_utc);
CREATE INDEX IF NOT EXISTS idx_appointment_calendar_bookings_user_local_date ON appointment_calendar_bookings(user_id, local_date, starts_at_utc);
CREATE INDEX IF NOT EXISTS idx_appointment_calendar_bookings_marker ON appointment_calendar_bookings(marker_id, starts_at_utc);
CREATE INDEX IF NOT EXISTS idx_appointment_calendar_bookings_status ON appointment_calendar_bookings(calendar_id, status, starts_at_utc);
CREATE INDEX IF NOT EXISTS idx_appointment_allocations_booking ON appointment_slot_allocations(booking_id);
CREATE INDEX IF NOT EXISTS idx_lead_intakes_tenant_created ON lead_intakes(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_intakes_publication ON lead_intakes(publication_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_intakes_marker ON lead_intakes(marker_id);
CREATE INDEX IF NOT EXISTS idx_lead_intakes_status ON lead_intakes(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_intakes_tenant_created_id ON lead_intakes(tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_lead_intakes_tenant_status_request_type ON lead_intakes(tenant_id, status, request_type);
CREATE INDEX IF NOT EXISTS idx_lead_intakes_tenant_read_created_id ON lead_intakes(tenant_id, read_at, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_lead_intake_customer_messages_lead ON lead_intake_customer_messages(tenant_id, lead_intake_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_intake_customer_message_attachments_message ON lead_intake_customer_message_attachments(tenant_id, lead_intake_id, customer_message_id);
CREATE INDEX IF NOT EXISTS idx_lead_intake_customer_message_attachments_token ON lead_intake_customer_message_attachments(download_token_hash);

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

CREATE INDEX IF NOT EXISTS idx_product_details_tenant_updated
  ON product_details(tenant_id, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_product_details_tenant_status_updated
  ON product_details(tenant_id, status, updated_at DESC, id DESC);
