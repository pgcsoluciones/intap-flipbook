import { getIntegerEntitlement } from './entitlements'

export interface StorageUsageBreakdown {
  category: string
  object_count: number
  bytes: number
  mb: number
}

export interface TenantStorageUsage {
  tenant_id: string
  object_count: number
  total_bytes: number
  used_mb: number
  breakdown: StorageUsageBreakdown[]
}

export interface TenantStorageTotal {
  tenant_id: string
  object_count: number
  total_bytes: number
  used_mb: number
}

export interface StorageLimitCheck {
  allowed: boolean
  unlimited: boolean
  used_bytes: number
  incoming_bytes: number
  replacing_bytes: number
  projected_bytes: number
  max_bytes: number | null
  max_mb: number | null
  message: string | null
}

interface StorageObjectRow {
  tenant_id: string
  category: string
  bucket_key: string
  object_key: string
  size_bytes: number
}

interface MediaAssetStorageRow {
  tenant_id: string
  storage_bucket: string
  storage_key: string
  size_bytes: number
  optimized_storage_key: string | null
  optimized_size_bytes: number | null
  thumbnail_storage_key: string | null
  thumbnail_size_bytes: number | null
}

interface PageStorageRow {
  tenant_id: string
  image_url: string
  size_bytes: number | null
}

interface AccumulatedObject {
  category: string
  bytes: number
}

function bytesToMb(bytes: number): number {
  return Number(
    (bytes / 1024 / 1024).toFixed(2),
  )
}

function safeBytes(value: unknown): number {
  const number = Number(value)

  return Number.isFinite(number) && number > 0
    ? Math.trunc(number)
    : 0
}

function storageIdentity(
  bucketKey: string,
  objectKey: string,
): string {
  return `${bucketKey}:${objectKey}`
}

function legacyUrlIdentity(url: string): string {
  return `legacy_url:${url}`
}

export function extractUploadObjectKey(
  value: unknown,
): string | null {
  const candidate = String(value ?? '').trim()

  if (!candidate) return null

  if (candidate.startsWith('uploads/')) {
    return candidate
  }

  try {
    const url = new URL(candidate)
    const path = decodeURIComponent(
      url.pathname.replace(/^\/+/, ''),
    )
    const uploadsIndex = path.indexOf('uploads/')

    return uploadsIndex >= 0
      ? path.slice(uploadsIndex)
      : null
  } catch {
    const uploadsIndex = candidate.indexOf('uploads/')

    return uploadsIndex >= 0
      ? candidate.slice(uploadsIndex)
      : null
  }
}

function addObject(
  objects: Map<string, AccumulatedObject>,
  identity: string,
  category: string,
  bytes: unknown,
): void {
  const normalizedBytes = safeBytes(bytes)
  const existing = objects.get(identity)

  if (!existing) {
    objects.set(identity, {
      category,
      bytes: normalizedBytes,
    })
    return
  }

  existing.bytes = Math.max(
    existing.bytes,
    normalizedBytes,
  )
}

function addStorageRow(
  objects: Map<string, AccumulatedObject>,
  row: StorageObjectRow,
): void {
  addObject(
    objects,
    storageIdentity(row.bucket_key, row.object_key),
    row.category,
    row.size_bytes,
  )
}

function addMediaAssetRow(
  objects: Map<string, AccumulatedObject>,
  row: MediaAssetStorageRow,
): void {
  const bucketKey = row.storage_bucket || 'MEDIA'

  addObject(
    objects,
    storageIdentity(bucketKey, row.storage_key),
    'media_original',
    row.size_bytes,
  )

  if (row.optimized_storage_key) {
    addObject(
      objects,
      storageIdentity(bucketKey, row.optimized_storage_key),
      'media_display',
      row.optimized_size_bytes ?? row.size_bytes,
    )
  }

  if (row.thumbnail_storage_key) {
    addObject(
      objects,
      storageIdentity(bucketKey, row.thumbnail_storage_key),
      'media_thumbnail',
      row.thumbnail_size_bytes,
    )
  }
}

function addPageRow(
  objects: Map<string, AccumulatedObject>,
  row: PageStorageRow,
): void {
  const objectKey = extractUploadObjectKey(row.image_url)

  addObject(
    objects,
    objectKey
      ? storageIdentity('MEDIA', objectKey)
      : legacyUrlIdentity(row.image_url),
    'page_legacy',
    row.size_bytes,
  )
}

async function readRowsOrEmpty<T>(
  query: D1PreparedStatement,
): Promise<{ ok: boolean; results?: T[] }> {
  try {
    const response = await query.all<T>()

    return { ok: true, results: response.results }
  } catch {
    return { ok: false, results: [] }
  }
}

async function readStorageObjectRows(
  db: D1Database,
  tenantId: string,
): Promise<{ results?: StorageObjectRow[] }> {
  const filtered = await readRowsOrEmpty<StorageObjectRow>(db.prepare(
    `SELECT
       tenant_id,
       category,
       bucket_key,
       object_key,
       size_bytes
     FROM storage_objects
     WHERE tenant_id = ?
       AND lifecycle_state <> 'deleted'`,
  ).bind(tenantId))

  if (filtered.ok) return filtered

  return readRowsOrEmpty<StorageObjectRow>(db.prepare(
    `SELECT
       tenant_id,
       category,
       bucket_key,
       object_key,
       size_bytes
     FROM storage_objects
     WHERE tenant_id = ?`,
  ).bind(tenantId))
}

async function readMediaAssetRows(
  db: D1Database,
  tenantId: string,
): Promise<{ results?: MediaAssetStorageRow[] }> {
  const filtered = await readRowsOrEmpty<MediaAssetStorageRow>(db.prepare(
    `SELECT
       tenant_id,
       storage_bucket,
       storage_key,
       size_bytes,
       optimized_storage_key,
       optimized_size_bytes,
       thumbnail_storage_key,
       thumbnail_size_bytes
     FROM media_assets
     WHERE tenant_id = ?
       AND deleted_at IS NULL`,
  ).bind(tenantId))

  if (filtered.ok) return filtered

  return readRowsOrEmpty<MediaAssetStorageRow>(db.prepare(
    `SELECT
       tenant_id,
       storage_bucket,
       storage_key,
       size_bytes,
       optimized_storage_key,
       optimized_size_bytes,
       thumbnail_storage_key,
       thumbnail_size_bytes
     FROM media_assets
     WHERE tenant_id = ?`,
  ).bind(tenantId))
}

async function readPageRows(
  db: D1Database,
  tenantId: string,
): Promise<{ results?: PageStorageRow[] }> {
  return readRowsOrEmpty<PageStorageRow>(db.prepare(
    `SELECT
       pub.user_id AS tenant_id,
       pg.image_url,
       pg.size_bytes
     FROM pages pg
     JOIN publications pub
       ON pub.id = pg.publication_id
     WHERE pub.user_id = ?`,
  ).bind(tenantId))
}

function usageFromObjects(
  tenantId: string,
  objects: Map<string, AccumulatedObject>,
): TenantStorageUsage {
  const byCategory = new Map<string, StorageUsageBreakdown>()

  for (const object of objects.values()) {
    const existing = byCategory.get(object.category) ?? {
      category: object.category,
      object_count: 0,
      bytes: 0,
      mb: 0,
    }

    existing.object_count += 1
    existing.bytes += object.bytes
    byCategory.set(object.category, existing)
  }

  const breakdown = Array.from(byCategory.values())
    .sort((a, b) => a.category.localeCompare(b.category))
    .map((item) => ({
      ...item,
      mb: bytesToMb(item.bytes),
    }))

  const totalBytes = breakdown.reduce(
    (total, item) => total + item.bytes,
    0,
  )

  const objectCount = breakdown.reduce(
    (total, item) => total + item.object_count,
    0,
  )

  return {
    tenant_id: tenantId,
    object_count: objectCount,
    total_bytes: totalBytes,
    used_mb: bytesToMb(totalBytes),
    breakdown,
  }
}

async function collectTenantStorageObjects(
  db: D1Database,
  tenantId: string,
): Promise<Map<string, AccumulatedObject>> {
  const objects = new Map<string, AccumulatedObject>()

  const [storageRows, mediaRows, pageRows] = await Promise.all([
    readStorageObjectRows(db, tenantId),
    readMediaAssetRows(db, tenantId),
    readPageRows(db, tenantId),
  ])

  for (const row of storageRows.results ?? []) {
    addStorageRow(objects, row)
  }

  for (const row of mediaRows.results ?? []) {
    addMediaAssetRow(objects, row)
  }

  for (const row of pageRows.results ?? []) {
    addPageRow(objects, row)
  }

  return objects
}

export async function getTenantStorageUsage(
  db: D1Database,
  tenantId: string,
): Promise<TenantStorageUsage> {
  const objects = await collectTenantStorageObjects(
    db,
    tenantId,
  )

  return usageFromObjects(tenantId, objects)
}

export async function getAllTenantStorageTotals(
  db: D1Database,
): Promise<TenantStorageTotal[]> {
  const { results } = await db.prepare(
    'SELECT id FROM users ORDER BY created_at DESC',
  ).all<{ id: string }>()

  const totals: TenantStorageTotal[] = []

  for (const user of results ?? []) {
    const usage = await getTenantStorageUsage(db, user.id)

    totals.push({
      tenant_id: usage.tenant_id,
      object_count: usage.object_count,
      total_bytes: usage.total_bytes,
      used_mb: usage.used_mb,
    })
  }

  return totals
}

export async function checkTenantStorageLimit(
  db: D1Database,
  tenantId: string,
  incomingBytes: number,
  replacingBytes = 0,
  explicitMaxMb?: number | null,
): Promise<StorageLimitCheck> {
  const normalizedIncoming = safeBytes(incomingBytes)
  const normalizedReplacing = safeBytes(replacingBytes)

  const [usage, resolvedMaxMb] = await Promise.all([
    getTenantStorageUsage(db, tenantId),
    explicitMaxMb === undefined
      ? getIntegerEntitlement(
        db,
        tenantId,
        'storage.max_mb',
      )
      : Promise.resolve(explicitMaxMb),
  ])
  const maxMb = resolvedMaxMb

  const projectedBytes = Math.max(
    0,
    usage.total_bytes - normalizedReplacing,
  ) + normalizedIncoming

  if (maxMb === null) {
    return {
      allowed: true,
      unlimited: true,
      used_bytes: usage.total_bytes,
      incoming_bytes: normalizedIncoming,
      replacing_bytes: normalizedReplacing,
      projected_bytes: projectedBytes,
      max_bytes: null,
      max_mb: null,
      message: null,
    }
  }

  const maxBytes = Math.max(0, maxMb) * 1024 * 1024
  const allowed = projectedBytes <= maxBytes

  return {
    allowed,
    unlimited: false,
    used_bytes: usage.total_bytes,
    incoming_bytes: normalizedIncoming,
    replacing_bytes: normalizedReplacing,
    projected_bytes: projectedBytes,
    max_bytes: maxBytes,
    max_mb: maxMb,
    message: allowed
      ? null
      : (
        `Almacenamiento insuficiente. `
        + `Usados: ${usage.used_mb} MB / ${maxMb} MB.`
      ),
  }
}
