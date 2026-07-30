-- Backfill de objetos físicos conocidos hacia storage_objects.
--
-- Requiere:
--   migration_storage_registry.sql
--
-- Fuentes cubiertas:
--   media_assets.storage_key
--   media_assets.optimized_storage_key
--   media_assets.thumbnail_storage_key
--   lead_intake_customer_message_attachments.storage_key
--
-- Reglas:
--   1. Un objeto se identifica por bucket_key + object_key.
--   2. storage_key y optimized_storage_key iguales cuentan una sola vez.
--   3. Cada campo conserva su propia referencia aunque comparta objeto.
--   4. Los registros EXTERNAL no representan objetos físicos en R2.
--   5. original_size_bytes no se contabiliza sin una clave física propia.
--   6. No se eliminan ni modifican registros fuente.

-- ─────────────────────────────────────────────────────────────────────────────
-- Media principal
-- ─────────────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO storage_objects (
  id,
  tenant_id,
  bucket_key,
  object_key,
  size_bytes,
  mime_type,
  category,
  metadata_json,
  lifecycle_state,
  source_created_at,
  created_at,
  updated_at
)
SELECT
  'backfill:media:' || id || ':storage',
  tenant_id,
  storage_bucket,
  storage_key,
  CASE
    WHEN COALESCE(size_bytes, 0) < 0 THEN 0
    ELSE COALESCE(size_bytes, 0)
  END,
  mime_type,
  'media_asset',
  NULL,
  'active',
  created_at,
  datetime('now'),
  datetime('now')
FROM media_assets
WHERE COALESCE(TRIM(storage_key), '') <> ''
  AND UPPER(COALESCE(storage_bucket, '')) NOT IN (
    '',
    'EXTERNAL'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Variante optimizada con clave física independiente
-- ─────────────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO storage_objects (
  id,
  tenant_id,
  bucket_key,
  object_key,
  size_bytes,
  mime_type,
  category,
  metadata_json,
  lifecycle_state,
  source_created_at,
  created_at,
  updated_at
)
SELECT
  'backfill:media:' || id || ':optimized',
  tenant_id,
  storage_bucket,
  optimized_storage_key,
  CASE
    WHEN COALESCE(
      optimized_size_bytes,
      size_bytes,
      0
    ) < 0 THEN 0
    ELSE COALESCE(
      optimized_size_bytes,
      size_bytes,
      0
    )
  END,
  COALESCE(
    optimized_mime_type,
    mime_type
  ),
  'media_display',
  NULL,
  'active',
  created_at,
  datetime('now'),
  datetime('now')
FROM media_assets
WHERE COALESCE(TRIM(optimized_storage_key), '') <> ''
  AND optimized_storage_key <> storage_key
  AND UPPER(COALESCE(storage_bucket, '')) NOT IN (
    '',
    'EXTERNAL'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Miniatura con clave física independiente
-- ─────────────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO storage_objects (
  id,
  tenant_id,
  bucket_key,
  object_key,
  size_bytes,
  mime_type,
  category,
  metadata_json,
  lifecycle_state,
  source_created_at,
  created_at,
  updated_at
)
SELECT
  'backfill:media:' || id || ':thumbnail',
  tenant_id,
  storage_bucket,
  thumbnail_storage_key,
  CASE
    WHEN COALESCE(thumbnail_size_bytes, 0) < 0 THEN 0
    ELSE COALESCE(thumbnail_size_bytes, 0)
  END,
  thumbnail_mime_type,
  'media_thumbnail',
  NULL,
  'active',
  created_at,
  datetime('now'),
  datetime('now')
FROM media_assets
WHERE COALESCE(TRIM(thumbnail_storage_key), '') <> ''
  AND thumbnail_storage_key <> storage_key
  AND (
    optimized_storage_key IS NULL
    OR thumbnail_storage_key <> optimized_storage_key
  )
  AND UPPER(COALESCE(storage_bucket, '')) NOT IN (
    '',
    'EXTERNAL'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Adjuntos privados
-- ─────────────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO storage_objects (
  id,
  tenant_id,
  bucket_key,
  object_key,
  size_bytes,
  mime_type,
  category,
  metadata_json,
  lifecycle_state,
  source_created_at,
  created_at,
  updated_at
)
SELECT
  'backfill:private-attachment:' || id,
  tenant_id,
  'PRIVATE_MEDIA',
  storage_key,
  CASE
    WHEN COALESCE(size_bytes, 0) < 0 THEN 0
    ELSE COALESCE(size_bytes, 0)
  END,
  mime_type,
  'private_quote_attachment',
  NULL,
  'active',
  created_at,
  datetime('now'),
  datetime('now')
FROM lead_intake_customer_message_attachments
WHERE COALESCE(TRIM(storage_key), '') <> '';

-- ─────────────────────────────────────────────────────────────────────────────
-- Referencias de media principal
-- ─────────────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO storage_object_references (
  storage_object_id,
  tenant_id,
  publication_id,
  source_type,
  source_id,
  source_field,
  created_at
)
SELECT
  so.id,
  ma.tenant_id,
  ma.publication_id,
  'media_asset',
  ma.id,
  'storage_key',
  datetime('now')
FROM media_assets ma
JOIN storage_objects so
  ON so.tenant_id = ma.tenant_id
 AND so.bucket_key = ma.storage_bucket
 AND so.object_key = ma.storage_key
WHERE COALESCE(TRIM(ma.storage_key), '') <> ''
  AND UPPER(COALESCE(ma.storage_bucket, '')) NOT IN (
    '',
    'EXTERNAL'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Referencias de variante optimizada
-- Incluye el caso donde comparte el mismo objeto con storage_key.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO storage_object_references (
  storage_object_id,
  tenant_id,
  publication_id,
  source_type,
  source_id,
  source_field,
  created_at
)
SELECT
  so.id,
  ma.tenant_id,
  ma.publication_id,
  'media_asset',
  ma.id,
  'optimized_storage_key',
  datetime('now')
FROM media_assets ma
JOIN storage_objects so
  ON so.tenant_id = ma.tenant_id
 AND so.bucket_key = ma.storage_bucket
 AND so.object_key = ma.optimized_storage_key
WHERE COALESCE(TRIM(ma.optimized_storage_key), '') <> ''
  AND UPPER(COALESCE(ma.storage_bucket, '')) NOT IN (
    '',
    'EXTERNAL'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Referencias de miniatura
-- ─────────────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO storage_object_references (
  storage_object_id,
  tenant_id,
  publication_id,
  source_type,
  source_id,
  source_field,
  created_at
)
SELECT
  so.id,
  ma.tenant_id,
  ma.publication_id,
  'media_asset',
  ma.id,
  'thumbnail_storage_key',
  datetime('now')
FROM media_assets ma
JOIN storage_objects so
  ON so.tenant_id = ma.tenant_id
 AND so.bucket_key = ma.storage_bucket
 AND so.object_key = ma.thumbnail_storage_key
WHERE COALESCE(TRIM(ma.thumbnail_storage_key), '') <> ''
  AND UPPER(COALESCE(ma.storage_bucket, '')) NOT IN (
    '',
    'EXTERNAL'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Referencias de adjunto privado
-- ─────────────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO storage_object_references (
  storage_object_id,
  tenant_id,
  publication_id,
  source_type,
  source_id,
  source_field,
  created_at
)
SELECT
  so.id,
  attachment.tenant_id,
  NULL,
  'lead_intake_customer_message_attachment',
  attachment.id,
  'storage_key',
  datetime('now')
FROM lead_intake_customer_message_attachments attachment
JOIN storage_objects so
  ON so.tenant_id = attachment.tenant_id
 AND so.bucket_key = 'PRIVATE_MEDIA'
 AND so.object_key = attachment.storage_key
WHERE COALESCE(TRIM(attachment.storage_key), '') <> '';
