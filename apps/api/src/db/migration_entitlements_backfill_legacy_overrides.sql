-- Backfill de límites y overrides legacy hacia tenant_modules.
--
-- Requiere:
--   migration_entitlements_foundation.sql
--   migration_entitlements_seed_core.sql
--
-- Reglas:
--   1. No elimina ni modifica las columnas legacy de users.
--   2. No reemplaza un value_json nuevo que ya exista.
--   3. watermark_override = 'plan' no crea override.
--   4. force_show se convierte en watermark.enabled = true.
--   5. force_hide se convierte en watermark.enabled = false.

-- ─────────────────────────────────────────────────────────────────────────────
-- Cantidad máxima de publicaciones
-- ─────────────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO tenant_modules (
  user_id,
  module_key,
  enabled,
  value_json,
  reason,
  updated_at
)
SELECT
  id,
  'publications.max_count',
  1,
  CAST(custom_max_publications AS TEXT),
  'legacy_users.custom_max_publications',
  datetime('now')
FROM users
WHERE custom_max_publications IS NOT NULL;

UPDATE tenant_modules
SET value_json = (
      SELECT CAST(u.custom_max_publications AS TEXT)
      FROM users u
      WHERE u.id = tenant_modules.user_id
    ),
    reason = COALESCE(
      reason,
      'legacy_users.custom_max_publications'
    ),
    updated_at = datetime('now')
WHERE module_key = 'publications.max_count'
  AND value_json IS NULL
  AND EXISTS (
    SELECT 1
    FROM users u
    WHERE u.id = tenant_modules.user_id
      AND u.custom_max_publications IS NOT NULL
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Cantidad máxima de páginas por publicación
-- ─────────────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO tenant_modules (
  user_id,
  module_key,
  enabled,
  value_json,
  reason,
  updated_at
)
SELECT
  id,
  'pages.max_per_publication',
  1,
  CAST(custom_max_pages AS TEXT),
  'legacy_users.custom_max_pages',
  datetime('now')
FROM users
WHERE custom_max_pages IS NOT NULL;

UPDATE tenant_modules
SET value_json = (
      SELECT CAST(u.custom_max_pages AS TEXT)
      FROM users u
      WHERE u.id = tenant_modules.user_id
    ),
    reason = COALESCE(
      reason,
      'legacy_users.custom_max_pages'
    ),
    updated_at = datetime('now')
WHERE module_key = 'pages.max_per_publication'
  AND value_json IS NULL
  AND EXISTS (
    SELECT 1
    FROM users u
    WHERE u.id = tenant_modules.user_id
      AND u.custom_max_pages IS NOT NULL
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Almacenamiento máximo
-- ─────────────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO tenant_modules (
  user_id,
  module_key,
  enabled,
  value_json,
  reason,
  updated_at
)
SELECT
  id,
  'storage.max_mb',
  1,
  CAST(custom_max_storage_mb AS TEXT),
  'legacy_users.custom_max_storage_mb',
  datetime('now')
FROM users
WHERE custom_max_storage_mb IS NOT NULL;

UPDATE tenant_modules
SET value_json = (
      SELECT CAST(u.custom_max_storage_mb AS TEXT)
      FROM users u
      WHERE u.id = tenant_modules.user_id
    ),
    reason = COALESCE(
      reason,
      'legacy_users.custom_max_storage_mb'
    ),
    updated_at = datetime('now')
WHERE module_key = 'storage.max_mb'
  AND value_json IS NULL
  AND EXISTS (
    SELECT 1
    FROM users u
    WHERE u.id = tenant_modules.user_id
      AND u.custom_max_storage_mb IS NOT NULL
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Marca de agua
-- ─────────────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO tenant_modules (
  user_id,
  module_key,
  enabled,
  value_json,
  reason,
  updated_at
)
SELECT
  id,
  'watermark.enabled',
  CASE
    WHEN watermark_override = 'force_show' THEN 1
    ELSE 0
  END,
  CASE
    WHEN watermark_override = 'force_show' THEN 'true'
    ELSE 'false'
  END,
  'legacy_users.watermark_override',
  datetime('now')
FROM users
WHERE watermark_override IN (
  'force_show',
  'force_hide'
);

UPDATE tenant_modules
SET enabled = (
      SELECT CASE
        WHEN u.watermark_override = 'force_show' THEN 1
        ELSE 0
      END
      FROM users u
      WHERE u.id = tenant_modules.user_id
    ),
    value_json = (
      SELECT CASE
        WHEN u.watermark_override = 'force_show' THEN 'true'
        ELSE 'false'
      END
      FROM users u
      WHERE u.id = tenant_modules.user_id
    ),
    reason = COALESCE(
      reason,
      'legacy_users.watermark_override'
    ),
    updated_at = datetime('now')
WHERE module_key = 'watermark.enabled'
  AND value_json IS NULL
  AND EXISTS (
    SELECT 1
    FROM users u
    WHERE u.id = tenant_modules.user_id
      AND u.watermark_override IN (
        'force_show',
        'force_hide'
      )
  );
