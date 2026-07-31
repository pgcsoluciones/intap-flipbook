import {
  linkStorageObjectReference,
  registerStorageObject,
} from './storageRegistry'
import { extractUploadObjectKey } from './storageUsage'

export interface LegacyPageStorageBackfillInput {
  tenantId: string
  dryRun: boolean
}

export interface MissingLegacyPageObject {
  object_key: string | null
  page_ids: string[]
  reason: string
}

export interface LegacyPageStorageBackfillResult {
  tenant_id: string
  dry_run: boolean
  pages_reviewed: number
  unique_objects: number
  bytes_found: number
  pages_updated: number
  references_created: number
  missing_objects: MissingLegacyPageObject[]
}

interface LegacyPageRow {
  id: string
  publication_id: string
  tenant_id: string
  image_url: string
  created_at: string | null
}

interface ObjectCandidate {
  objectKey: string
  pages: LegacyPageRow[]
  sizeBytes: number
  contentType: string | null
}

function requiredTenantId(value: string): string {
  const tenantId = value.trim()

  if (!tenantId) {
    throw new Error('tenant_id es requerido')
  }

  return tenantId
}

function normalizeR2Size(value: unknown): number | null {
  const size = Number(value)

  if (!Number.isFinite(size) || size <= 0) {
    return null
  }

  return Math.trunc(size)
}

function getR2ContentType(object: R2Object): string | null {
  const contentType = object.httpMetadata?.contentType

  return typeof contentType === 'string' && contentType.trim()
    ? contentType
    : null
}

async function listLegacyPageRows(
  db: D1Database,
  tenantId: string,
): Promise<LegacyPageRow[]> {
  const { results } = await db.prepare(
    `SELECT
       pg.id,
       pg.publication_id,
       pub.user_id AS tenant_id,
       pg.image_url,
       pg.created_at
     FROM pages pg
     JOIN publications pub
       ON pub.id = pg.publication_id
     WHERE pub.user_id = ?
       AND COALESCE(TRIM(pg.image_url), '') <> ''
       AND COALESCE(pg.size_bytes, 0) = 0
     ORDER BY pg.publication_id ASC, pg.page_number ASC, pg.id ASC`,
  ).bind(tenantId).all<LegacyPageRow>()

  return results ?? []
}

async function resolveCandidates(
  pages: LegacyPageRow[],
  media: R2Bucket,
): Promise<{
  candidates: ObjectCandidate[]
  missingObjects: MissingLegacyPageObject[]
}> {
  const pagesByObject = new Map<string, LegacyPageRow[]>()
  const missingObjects: MissingLegacyPageObject[] = []

  for (const page of pages) {
    const objectKey = extractUploadObjectKey(page.image_url)

    if (!objectKey) {
      missingObjects.push({
        object_key: null,
        page_ids: [page.id],
        reason: 'invalid_upload_key',
      })
      continue
    }

    const existing = pagesByObject.get(objectKey) ?? []
    existing.push(page)
    pagesByObject.set(objectKey, existing)
  }

  const candidates: ObjectCandidate[] = []

  for (const [objectKey, objectPages] of pagesByObject) {
    const object = await media.head(objectKey)

    if (!object) {
      missingObjects.push({
        object_key: objectKey,
        page_ids: objectPages.map((page) => page.id),
        reason: 'not_found',
      })
      continue
    }

    const sizeBytes = normalizeR2Size(object.size)

    if (sizeBytes === null) {
      missingObjects.push({
        object_key: objectKey,
        page_ids: objectPages.map((page) => page.id),
        reason: 'invalid_size',
      })
      continue
    }

    candidates.push({
      objectKey,
      pages: objectPages,
      sizeBytes,
      contentType: getR2ContentType(object),
    })
  }

  return { candidates, missingObjects }
}

export async function backfillLegacyPageStorage(
  db: D1Database,
  media: R2Bucket,
  input: LegacyPageStorageBackfillInput,
): Promise<LegacyPageStorageBackfillResult> {
  const tenantId = requiredTenantId(input.tenantId)
  const pages = await listLegacyPageRows(db, tenantId)
  const { candidates, missingObjects } = await resolveCandidates(
    pages,
    media,
  )

  const bytesFound = candidates.reduce(
    (total, candidate) => total + candidate.sizeBytes,
    0,
  )
  const pagesUpdated = candidates.reduce(
    (total, candidate) => total + candidate.pages.length,
    0,
  )

  if (input.dryRun) {
    return {
      tenant_id: tenantId,
      dry_run: true,
      pages_reviewed: pages.length,
      unique_objects: candidates.length,
      bytes_found: bytesFound,
      pages_updated: 0,
      references_created: 0,
      missing_objects: missingObjects,
    }
  }

  let referencesCreated = 0

  for (const candidate of candidates) {
    const storageObjectId = await registerStorageObject(db, {
      tenantId,
      bucketKey: 'MEDIA',
      objectKey: candidate.objectKey,
      sizeBytes: candidate.sizeBytes,
      mimeType: candidate.contentType,
      category: 'page_legacy',
      sourceCreatedAt: candidate.pages[0]?.created_at ?? null,
    })

    for (const page of candidate.pages) {
      await db.prepare(
        `UPDATE pages
         SET size_bytes = ?
         WHERE id = ?
           AND publication_id = ?`,
      ).bind(
        candidate.sizeBytes,
        page.id,
        page.publication_id,
      ).run()

      await linkStorageObjectReference(db, {
        storageObjectId,
        tenantId,
        publicationId: page.publication_id,
        sourceType: 'page',
        sourceId: page.id,
        sourceField: 'image_url',
      })
      referencesCreated += 1
    }
  }

  return {
    tenant_id: tenantId,
    dry_run: false,
    pages_reviewed: pages.length,
    unique_objects: candidates.length,
    bytes_found: bytesFound,
    pages_updated: pagesUpdated,
    references_created: referencesCreated,
    missing_objects: missingObjects,
  }
}
