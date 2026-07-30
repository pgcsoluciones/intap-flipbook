export type StorageLifecycleState =
  | 'active'
  | 'deleted'
  | 'orphaned'
  | 'pending_delete'

export interface RegisterStorageObjectInput {
  id?: string
  tenantId: string
  bucketKey: string
  objectKey: string
  sizeBytes: number
  mimeType?: string | null
  checksumSha256?: string | null
  category: string
  metadata?: unknown
  sourceCreatedAt?: string | null
}

export interface LinkStorageReferenceInput {
  storageObjectId: string
  tenantId: string
  publicationId?: string | null
  sourceType: string
  sourceId: string
  sourceField: string
}

interface StoredObjectOwnerRow {
  id: string
  tenant_id: string
}

function requiredText(
  value: string,
  field: string,
): string {
  const cleaned = value.trim()

  if (!cleaned) {
    throw new Error(`${field} es requerido`)
  }

  return cleaned
}

function normalizeSizeBytes(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      'sizeBytes debe ser un número no negativo',
    )
  }

  return Math.trunc(value)
}

function serializeMetadata(value: unknown): string | null {
  if (value === null || value === undefined) return null

  try {
    return JSON.stringify(value)
  } catch {
    throw new Error(
      'metadata no puede serializarse como JSON',
    )
  }
}

export async function registerStorageObject(
  db: D1Database,
  input: RegisterStorageObjectInput,
): Promise<string> {
  const tenantId = requiredText(
    input.tenantId,
    'tenantId',
  )

  const bucketKey = requiredText(
    input.bucketKey,
    'bucketKey',
  )

  const objectKey = requiredText(
    input.objectKey,
    'objectKey',
  )

  const category = requiredText(
    input.category,
    'category',
  )

  const sizeBytes = normalizeSizeBytes(
    input.sizeBytes,
  )

  const existing = await db.prepare(
    `SELECT id, tenant_id
     FROM storage_objects
     WHERE bucket_key = ?
       AND object_key = ?
     LIMIT 1`,
  )
    .bind(bucketKey, objectKey)
    .first<StoredObjectOwnerRow>()

  if (existing && existing.tenant_id !== tenantId) {
    throw new Error(
      'El objeto físico ya está registrado para otro tenant',
    )
  }

  const metadataJson = serializeMetadata(input.metadata)
  const now = new Date().toISOString()

  if (existing) {
    await db.prepare(
      `UPDATE storage_objects
       SET size_bytes = ?,
           mime_type = ?,
           checksum_sha256 = ?,
           category = ?,
           metadata_json = ?,
           lifecycle_state = 'active',
           source_created_at = COALESCE(?, source_created_at),
           updated_at = ?,
           deleted_at = NULL
       WHERE id = ?
         AND tenant_id = ?`,
    )
      .bind(
        sizeBytes,
        input.mimeType ?? null,
        input.checksumSha256 ?? null,
        category,
        metadataJson,
        input.sourceCreatedAt ?? null,
        now,
        existing.id,
        tenantId,
      )
      .run()

    return existing.id
  }

  const id = input.id?.trim() || crypto.randomUUID()

  await db.prepare(
    `INSERT INTO storage_objects (
       id,
       tenant_id,
       bucket_key,
       object_key,
       size_bytes,
       mime_type,
       checksum_sha256,
       category,
       metadata_json,
       lifecycle_state,
       source_created_at,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
  )
    .bind(
      id,
      tenantId,
      bucketKey,
      objectKey,
      sizeBytes,
      input.mimeType ?? null,
      input.checksumSha256 ?? null,
      category,
      metadataJson,
      input.sourceCreatedAt ?? null,
      now,
      now,
    )
    .run()

  return id
}

export async function linkStorageObjectReference(
  db: D1Database,
  input: LinkStorageReferenceInput,
): Promise<void> {
  const owner = await db.prepare(
    `SELECT id, tenant_id
     FROM storage_objects
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(input.storageObjectId)
    .first<StoredObjectOwnerRow>()

  if (!owner || owner.tenant_id !== input.tenantId) {
    throw new Error(
      'El objeto no pertenece al tenant indicado',
    )
  }

  await db.prepare(
    `INSERT OR IGNORE INTO storage_object_references (
       storage_object_id,
       tenant_id,
       publication_id,
       source_type,
       source_id,
       source_field,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      input.storageObjectId,
      input.tenantId,
      input.publicationId ?? null,
      requiredText(input.sourceType, 'sourceType'),
      requiredText(input.sourceId, 'sourceId'),
      requiredText(input.sourceField, 'sourceField'),
      new Date().toISOString(),
    )
    .run()
}

export async function unlinkStorageObjectReference(
  db: D1Database,
  input: LinkStorageReferenceInput,
): Promise<void> {
  await db.prepare(
    `DELETE FROM storage_object_references
     WHERE storage_object_id = ?
       AND tenant_id = ?
       AND source_type = ?
       AND source_id = ?
       AND source_field = ?`,
  )
    .bind(
      input.storageObjectId,
      input.tenantId,
      input.sourceType,
      input.sourceId,
      input.sourceField,
    )
    .run()
}

export async function setStorageObjectLifecycle(
  db: D1Database,
  tenantId: string,
  storageObjectId: string,
  lifecycleState: StorageLifecycleState,
): Promise<void> {
  const now = new Date().toISOString()

  await db.prepare(
    `UPDATE storage_objects
     SET lifecycle_state = ?,
         deleted_at = CASE
           WHEN ? = 'deleted' THEN ?
           ELSE deleted_at
         END,
         updated_at = ?
     WHERE id = ?
       AND tenant_id = ?`,
  )
    .bind(
      lifecycleState,
      lifecycleState,
      now,
      now,
      storageObjectId,
      tenantId,
    )
    .run()
}

export interface StorageObjectRecord {
  id: string
  tenant_id: string
  bucket_key: string
  object_key: string
  size_bytes: number
  mime_type: string | null
  checksum_sha256: string | null
  category: string
  metadata_json: string | null
  lifecycle_state: StorageLifecycleState
  source_created_at: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface StorageObjectWithReferenceCounts
  extends StorageObjectRecord {
  source_reference_count: number
  other_reference_count: number
}

function normalizeStoredObject(
  row: StorageObjectRecord,
): StorageObjectRecord {
  return {
    ...row,
    size_bytes: normalizeSizeBytes(
      Number(row.size_bytes),
    ),
  }
}

function normalizeReferenceCount(
  value: unknown,
): number {
  const count = Number(value)

  if (!Number.isFinite(count) || count < 0) {
    return 0
  }

  return Math.trunc(count)
}

export async function getStorageObjectByPhysicalKey(
  db: D1Database,
  tenantId: string,
  bucketKey: string,
  objectKey: string,
): Promise<StorageObjectRecord | null> {
  const row = await db.prepare(
    `SELECT
       id,
       tenant_id,
       bucket_key,
       object_key,
       size_bytes,
       mime_type,
       checksum_sha256,
       category,
       metadata_json,
       lifecycle_state,
       source_created_at,
       created_at,
       updated_at,
       deleted_at
     FROM storage_objects
     WHERE tenant_id = ?
       AND bucket_key = ?
       AND object_key = ?
     LIMIT 1`,
  )
    .bind(
      requiredText(tenantId, 'tenantId'),
      requiredText(bucketKey, 'bucketKey'),
      requiredText(objectKey, 'objectKey'),
    )
    .first<StorageObjectRecord>()

  return row
    ? normalizeStoredObject(row)
    : null
}

export async function getActiveStorageObjectSize(
  db: D1Database,
  tenantId: string,
  bucketKey: string,
  objectKey: string,
): Promise<number> {
  const object = await getStorageObjectByPhysicalKey(
    db,
    tenantId,
    bucketKey,
    objectKey,
  )

  if (
    !object
    || object.lifecycle_state === 'deleted'
  ) {
    return 0
  }

  // Mientras el objeto físico no esté confirmado como eliminado,
  // active, orphaned y pending_delete permanecen dentro de la cuota.
  return object.size_bytes
}

export async function listStorageObjectsForSource(
  db: D1Database,
  tenantId: string,
  sourceType: string,
  sourceId: string,
): Promise<StorageObjectWithReferenceCounts[]> {
  const normalizedTenantId = requiredText(
    tenantId,
    'tenantId',
  )

  const normalizedSourceType = requiredText(
    sourceType,
    'sourceType',
  )

  const normalizedSourceId = requiredText(
    sourceId,
    'sourceId',
  )

  const { results } = await db.prepare(
    `SELECT DISTINCT
       so.id,
       so.tenant_id,
       so.bucket_key,
       so.object_key,
       so.size_bytes,
       so.mime_type,
       so.checksum_sha256,
       so.category,
       so.metadata_json,
       so.lifecycle_state,
       so.source_created_at,
       so.created_at,
       so.updated_at,
       so.deleted_at,
       (
         SELECT COUNT(*)
         FROM storage_object_references own_ref
         WHERE own_ref.storage_object_id = so.id
           AND own_ref.tenant_id = ?
           AND own_ref.source_type = ?
           AND own_ref.source_id = ?
       ) AS source_reference_count,
       (
         SELECT COUNT(*)
         FROM storage_object_references other_ref
         WHERE other_ref.storage_object_id = so.id
           AND NOT (
             other_ref.tenant_id = ?
             AND other_ref.source_type = ?
             AND other_ref.source_id = ?
           )
       ) AS other_reference_count
     FROM storage_objects so
     JOIN storage_object_references requested_ref
       ON requested_ref.storage_object_id = so.id
      AND requested_ref.tenant_id = ?
      AND requested_ref.source_type = ?
      AND requested_ref.source_id = ?
     WHERE so.tenant_id = ?
     ORDER BY
       so.bucket_key ASC,
       so.object_key ASC`,
  )
    .bind(
      normalizedTenantId,
      normalizedSourceType,
      normalizedSourceId,
      normalizedTenantId,
      normalizedSourceType,
      normalizedSourceId,
      normalizedTenantId,
      normalizedSourceType,
      normalizedSourceId,
      normalizedTenantId,
    )
    .all<StorageObjectWithReferenceCounts>()

  return (results ?? []).map((row) => ({
    ...normalizeStoredObject(row),
    source_reference_count: normalizeReferenceCount(
      row.source_reference_count,
    ),
    other_reference_count: normalizeReferenceCount(
      row.other_reference_count,
    ),
  }))
}

export async function countStorageObjectReferences(
  db: D1Database,
  storageObjectId: string,
): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS count
     FROM storage_object_references
     WHERE storage_object_id = ?`,
  )
    .bind(
      requiredText(
        storageObjectId,
        'storageObjectId',
      ),
    )
    .first<{ count: number }>()

  return normalizeReferenceCount(row?.count)
}

export async function detachStorageReferencesBySource(
  db: D1Database,
  tenantId: string,
  sourceType: string,
  sourceId: string,
): Promise<number> {
  const result = await db.prepare(
    `DELETE FROM storage_object_references
     WHERE tenant_id = ?
       AND source_type = ?
       AND source_id = ?`,
  )
    .bind(
      requiredText(tenantId, 'tenantId'),
      requiredText(sourceType, 'sourceType'),
      requiredText(sourceId, 'sourceId'),
    )
    .run()

  return normalizeReferenceCount(
    result.meta?.changes,
  )
}

export async function finalizeStorageObjectDeletion(
  db: D1Database,
  tenantId: string,
  storageObjectId: string,
): Promise<boolean> {
  const now = new Date().toISOString()

  const result = await db.prepare(
    `UPDATE storage_objects
     SET lifecycle_state = 'deleted',
         deleted_at = COALESCE(deleted_at, ?),
         updated_at = ?
     WHERE id = ?
       AND tenant_id = ?
       AND NOT EXISTS (
         SELECT 1
         FROM storage_object_references refs
         WHERE refs.storage_object_id = storage_objects.id
       )`,
  )
    .bind(
      now,
      now,
      requiredText(
        storageObjectId,
        'storageObjectId',
      ),
      requiredText(tenantId, 'tenantId'),
    )
    .run()

  return normalizeReferenceCount(
    result.meta?.changes,
  ) > 0
}

export async function finalizeStorageObjectDeletionByPhysicalKey(
  db: D1Database,
  tenantId: string,
  bucketKey: string,
  objectKey: string,
): Promise<boolean> {
  const now = new Date().toISOString()

  const result = await db.prepare(
    `UPDATE storage_objects
     SET lifecycle_state = 'deleted',
         deleted_at = COALESCE(deleted_at, ?),
         updated_at = ?
     WHERE tenant_id = ?
       AND bucket_key = ?
       AND object_key = ?
       AND NOT EXISTS (
         SELECT 1
         FROM storage_object_references refs
         WHERE refs.storage_object_id = storage_objects.id
       )`,
  )
    .bind(
      now,
      now,
      requiredText(tenantId, 'tenantId'),
      requiredText(bucketKey, 'bucketKey'),
      requiredText(objectKey, 'objectKey'),
    )
    .run()

  return normalizeReferenceCount(
    result.meta?.changes,
  ) > 0
}
