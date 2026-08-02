-- Migration 002: allow publication-scoped dynamic markers without initial page/object linkage
-- Run: wrangler d1 migrations apply pgc-landing-saas-db --remote --env preview --config apps/api/wrangler.toml

PRAGMA defer_foreign_keys = ON;

CREATE TABLE dynamic_markers_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  publication_id TEXT NOT NULL REFERENCES publications(id),
  page_id TEXT REFERENCES pages(id),
  target_object_id TEXT,
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
  custom_fields_json TEXT NOT NULL DEFAULT '[]',
  cloned_from_marker_id TEXT REFERENCES dynamic_markers(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  colors_json TEXT NOT NULL DEFAULT '[]',
  materials_json TEXT NOT NULL DEFAULT '[]',
  sizes_json TEXT NOT NULL DEFAULT '[]',
  measurements_json TEXT NOT NULL DEFAULT '[]',
  media_json TEXT NOT NULL DEFAULT '[]',
  actions_json TEXT NOT NULL DEFAULT '{}',
  accent_color TEXT NOT NULL DEFAULT '#F59E0B',
  badge_text TEXT,
  promotion_ends_at TEXT,
  post_promotion_price_minor INTEGER,
  booking_calendar_id TEXT REFERENCES appointment_calendars(id),
  UNIQUE(publication_id, page_id, target_object_id),
  CHECK (status <> 'active' OR (name IS NOT NULL AND length(trim(name)) > 0)),
  CHECK (
    price_minor IS NULL OR
    (typeof(price_minor) = 'integer' AND price_minor >= 0)
  ),
  CHECK (
    previous_price_minor IS NULL OR
    (typeof(previous_price_minor) = 'integer' AND previous_price_minor >= 0)
  ),
  CHECK (currency IS NULL OR length(currency) = 3)
);

INSERT INTO dynamic_markers_new (
  id,
  user_id,
  publication_id,
  page_id,
  target_object_id,
  target_kind,
  status,
  name,
  reference,
  category,
  description,
  price_minor,
  previous_price_minor,
  currency,
  availability,
  promotion_text,
  custom_fields_json,
  cloned_from_marker_id,
  created_at,
  updated_at,
  colors_json,
  materials_json,
  sizes_json,
  measurements_json,
  media_json,
  actions_json,
  accent_color,
  badge_text,
  promotion_ends_at,
  post_promotion_price_minor,
  booking_calendar_id
)
SELECT
  id,
  user_id,
  publication_id,
  page_id,
  target_object_id,
  target_kind,
  status,
  name,
  reference,
  category,
  description,
  price_minor,
  previous_price_minor,
  currency,
  availability,
  promotion_text,
  custom_fields_json,
  cloned_from_marker_id,
  created_at,
  updated_at,
  colors_json,
  materials_json,
  sizes_json,
  measurements_json,
  media_json,
  actions_json,
  accent_color,
  badge_text,
  promotion_ends_at,
  post_promotion_price_minor,
  booking_calendar_id
FROM dynamic_markers;

DROP TABLE dynamic_markers;
ALTER TABLE dynamic_markers_new RENAME TO dynamic_markers;

CREATE INDEX IF NOT EXISTS idx_dynamic_markers_booking_calendar ON dynamic_markers(booking_calendar_id);
CREATE INDEX IF NOT EXISTS idx_dynamic_markers_page ON dynamic_markers(page_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_dynamic_markers_publication ON dynamic_markers(publication_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_dynamic_markers_status ON dynamic_markers(publication_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_dynamic_markers_user_publication_updated ON dynamic_markers(user_id, publication_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_dynamic_markers_user_status_updated ON dynamic_markers(user_id, status, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_dynamic_markers_user_updated ON dynamic_markers(user_id, updated_at DESC, id DESC);

PRAGMA defer_foreign_keys = OFF;
