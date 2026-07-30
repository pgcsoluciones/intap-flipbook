-- Registro central de objetos físicos almacenados por tenant.
-- Esta migración solo crea la estructura. El backfill se ejecutará aparte,
-- primero en modo dry-run.
--
-- Regla de consumo:
--   un objeto físico se cuenta una sola vez por bucket_key + object_key.
--
-- No contabilizar columnas de tamaño cuando no exista una clave física propia.

CREATE TABLE IF NOT EXISTS storage_objects (
  id TEXT PRIMARY KEY,

  tenant_id TEXT NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

  -- Nombre del binding o almacén lógico:
  -- MEDIA | PRIVATE_MEDIA | futuros almacenes.
  bucket_key TEXT NOT NULL,

  -- Clave física exacta dentro del bucket.
  object_key TEXT NOT NULL,

  size_bytes INTEGER NOT NULL DEFAULT 0
    CHECK (size_bytes >= 0),

  mime_type TEXT,
  checksum_sha256 TEXT,

  -- Clasificación operativa. Es ampliable sin nueva tabla:
  -- media_original, media_display, media_thumbnail,
  -- page_legacy, private_quote_attachment,
  -- product_media, snapshot, backup, pdf_export, portable_file.
  category TEXT NOT NULL,

  metadata_json TEXT,

  lifecycle_state TEXT NOT NULL DEFAULT 'active'
    CHECK (
      lifecycle_state IN (
        'active',
        'deleted',
        'orphaned',
        'pending_delete'
      )
    ),

  source_created_at TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,

  UNIQUE (bucket_key, object_key)
);

CREATE INDEX IF NOT EXISTS idx_storage_objects_tenant_state
  ON storage_objects (
    tenant_id,
    lifecycle_state
  );

CREATE INDEX IF NOT EXISTS idx_storage_objects_tenant_category
  ON storage_objects (
    tenant_id,
    category,
    lifecycle_state
  );

CREATE INDEX IF NOT EXISTS idx_storage_objects_object_lookup
  ON storage_objects (
    bucket_key,
    object_key
  );

-- Registra dónde se utiliza un objeto sin multiplicar su consumo.
-- Esta tabla servirá para:
--   eliminación segura,
--   reemplazo,
--   "ver dónde se utiliza",
--   clonación,
--   snapshots,
--   backups,
--   PDF,
--   exportación portable.
CREATE TABLE IF NOT EXISTS storage_object_references (
  storage_object_id TEXT NOT NULL
    REFERENCES storage_objects(id)
    ON DELETE CASCADE,

  tenant_id TEXT NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

  publication_id TEXT
    REFERENCES publications(id)
    ON DELETE SET NULL,

  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_field TEXT NOT NULL,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  PRIMARY KEY (
    storage_object_id,
    source_type,
    source_id,
    source_field
  )
);

CREATE INDEX IF NOT EXISTS idx_storage_references_tenant
  ON storage_object_references (
    tenant_id,
    source_type
  );

CREATE INDEX IF NOT EXISTS idx_storage_references_publication
  ON storage_object_references (
    publication_id,
    source_type
  );

CREATE INDEX IF NOT EXISTS idx_storage_references_source
  ON storage_object_references (
    source_type,
    source_id
  );
