import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

async function loadBackfill() {
  const dir = await mkdtemp(join(tmpdir(), 'legacy-page-storage-test-'))
  const outfile = join(dir, 'backfill.mjs')
  await build({
    entryPoints: ['apps/api/src/lib/legacyPageStorageBackfill.ts'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
  })
  const mod = await import(pathToFileURL(outfile).href)
  return {
    backfillLegacyPageStorage: mod.backfillLegacyPageStorage,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

class FakeR2 {
  constructor(objects = {}) {
    this.objects = new Map(Object.entries(objects))
    this.heads = []
  }

  async head(key) {
    this.heads.push(key)
    const object = this.objects.get(key)
    if (!object) return null
    return {
      size: object.size,
      httpMetadata: { contentType: object.contentType },
    }
  }
}

class FakeD1 {
  constructor() {
    this.publications = [
      { id: 'pub-1', user_id: 'tenant-1' },
      { id: 'pub-2', user_id: 'tenant-1' },
      { id: 'pub-other', user_id: 'tenant-2' },
    ]
    this.pages = [
      {
        id: 'page-1',
        publication_id: 'pub-1',
        page_number: 1,
        image_url: 'https://cdn.example.com/uploads/tenant-1/a.jpg',
        size_bytes: 0,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'page-2',
        publication_id: 'pub-1',
        page_number: 2,
        image_url: 'uploads/tenant-1/a.jpg',
        size_bytes: 0,
        created_at: '2026-01-01T00:00:01.000Z',
      },
      {
        id: 'page-3',
        publication_id: 'pub-2',
        page_number: 1,
        image_url: 'https://cdn.example.com/uploads/tenant-1/missing.jpg',
        size_bytes: 0,
        created_at: '2026-01-01T00:00:02.000Z',
      },
      {
        id: 'page-4',
        publication_id: 'pub-other',
        page_number: 1,
        image_url: 'uploads/tenant-2/other.jpg',
        size_bytes: 0,
        created_at: '2026-01-01T00:00:03.000Z',
      },
    ]
    this.storageObjects = []
    this.storageReferences = []
    this.updates = []
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
  }
}

class FakeStatement {
  constructor(db, sql) {
    this.db = db
    this.sql = sql.replace(/\s+/g, ' ').trim()
    this.params = []
  }

  bind(...params) {
    this.params = params
    return this
  }

  async all() {
    if (this.sql.includes('FROM pages pg JOIN publications pub')) {
      const [tenantId] = this.params
      const publications = new Map(
        this.db.publications.map((pub) => [pub.id, pub]),
      )
      return {
        results: this.db.pages
          .map((page) => ({
            ...page,
            tenant_id: publications.get(page.publication_id)?.user_id,
          }))
          .filter((page) =>
            page.tenant_id === tenantId
            && String(page.image_url ?? '').trim()
            && Number(page.size_bytes ?? 0) === 0
          )
          .sort((a, b) =>
            a.publication_id.localeCompare(b.publication_id)
            || a.page_number - b.page_number
            || a.id.localeCompare(b.id)
          ),
      }
    }
    throw new Error(`Unhandled all SQL: ${this.sql}`)
  }

  async first() {
    if (this.sql.includes('FROM storage_objects') && this.sql.includes('bucket_key = ?')) {
      const [bucketKey, objectKey] = this.params
      return this.db.storageObjects.find((object) =>
        object.bucket_key === bucketKey
        && object.object_key === objectKey
      ) ?? null
    }
    if (this.sql.includes('FROM storage_objects') && this.sql.includes('WHERE id = ?')) {
      const [id] = this.params
      return this.db.storageObjects.find((object) => object.id === id) ?? null
    }
    throw new Error(`Unhandled first SQL: ${this.sql}`)
  }

  async run() {
    if (this.sql.startsWith('INSERT INTO storage_objects')) {
      const [
        id,
        tenantId,
        bucketKey,
        objectKey,
        sizeBytes,
        mimeType,
        checksumSha256,
        category,
        metadataJson,
        sourceCreatedAt,
        createdAt,
        updatedAt,
      ] = this.params
      this.db.storageObjects.push({
        id,
        tenant_id: tenantId,
        bucket_key: bucketKey,
        object_key: objectKey,
        size_bytes: sizeBytes,
        mime_type: mimeType,
        checksum_sha256: checksumSha256,
        category,
        metadata_json: metadataJson,
        lifecycle_state: 'active',
        source_created_at: sourceCreatedAt,
        created_at: createdAt,
        updated_at: updatedAt,
        deleted_at: null,
      })
      return { success: true }
    }

    if (this.sql.startsWith('UPDATE storage_objects')) {
      const [
        sizeBytes,
        mimeType,
        checksumSha256,
        category,
        metadataJson,
        sourceCreatedAt,
        updatedAt,
        id,
        tenantId,
      ] = this.params
      const object = this.db.storageObjects.find((item) =>
        item.id === id && item.tenant_id === tenantId
      )
      if (object) {
        object.size_bytes = sizeBytes
        object.mime_type = mimeType
        object.checksum_sha256 = checksumSha256
        object.category = category
        object.metadata_json = metadataJson
        object.lifecycle_state = 'active'
        object.source_created_at = sourceCreatedAt ?? object.source_created_at
        object.updated_at = updatedAt
        object.deleted_at = null
      }
      return { success: true }
    }

    if (this.sql.startsWith('UPDATE pages')) {
      const [sizeBytes, pageId, publicationId] = this.params
      const page = this.db.pages.find((item) =>
        item.id === pageId && item.publication_id === publicationId
      )
      if (page) {
        page.size_bytes = sizeBytes
        this.db.updates.push({ pageId, sizeBytes })
      }
      return { success: true }
    }

    if (this.sql.startsWith('INSERT OR IGNORE INTO storage_object_references')) {
      const [
        storageObjectId,
        tenantId,
        publicationId,
        sourceType,
        sourceId,
        sourceField,
        createdAt,
      ] = this.params
      const exists = this.db.storageReferences.some((ref) =>
        ref.storage_object_id === storageObjectId
        && ref.source_type === sourceType
        && ref.source_id === sourceId
        && ref.source_field === sourceField
      )
      if (!exists) {
        this.db.storageReferences.push({
          storage_object_id: storageObjectId,
          tenant_id: tenantId,
          publication_id: publicationId,
          source_type: sourceType,
          source_id: sourceId,
          source_field: sourceField,
          created_at: createdAt,
        })
      }
      return { success: true }
    }

    throw new Error(`Unhandled run SQL: ${this.sql}`)
  }
}

test('legacy page storage backfill deduplicates, honors dry-run, and skips missing objects', async () => {
  const { backfillLegacyPageStorage, cleanup } = await loadBackfill()
  try {
    const db = new FakeD1()
    const r2 = new FakeR2({
      'uploads/tenant-1/a.jpg': {
        size: 12345,
        contentType: 'image/jpeg',
      },
    })

    const result = await backfillLegacyPageStorage(db, r2, {
      tenantId: 'tenant-1',
      dryRun: true,
    })

    assert.equal(result.pages_reviewed, 3)
    assert.equal(result.unique_objects, 1)
    assert.equal(result.bytes_found, 12345)
    assert.equal(result.pages_updated, 0)
    assert.equal(result.references_created, 0)
    assert.deepEqual(r2.heads.sort(), [
      'uploads/tenant-1/a.jpg',
      'uploads/tenant-1/missing.jpg',
    ])
    assert.equal(result.missing_objects.length, 1)
    assert.equal(result.missing_objects[0].object_key, 'uploads/tenant-1/missing.jpg')
    assert.equal(db.storageObjects.length, 0)
    assert.equal(db.storageReferences.length, 0)
    assert.equal(db.updates.length, 0)
  } finally {
    await cleanup()
  }
})

test('legacy page storage backfill writes objects and references idempotently', async () => {
  const { backfillLegacyPageStorage, cleanup } = await loadBackfill()
  try {
    const db = new FakeD1()
    const r2 = new FakeR2({
      'uploads/tenant-1/a.jpg': {
        size: 12345,
        contentType: 'image/jpeg',
      },
    })

    const first = await backfillLegacyPageStorage(db, r2, {
      tenantId: 'tenant-1',
      dryRun: false,
    })

    assert.equal(first.pages_reviewed, 3)
    assert.equal(first.unique_objects, 1)
    assert.equal(first.bytes_found, 12345)
    assert.equal(first.pages_updated, 2)
    assert.equal(first.references_created, 2)
    assert.equal(db.storageObjects.length, 1)
    assert.equal(db.storageObjects[0].tenant_id, 'tenant-1')
    assert.equal(db.storageObjects[0].bucket_key, 'MEDIA')
    assert.equal(db.storageObjects[0].object_key, 'uploads/tenant-1/a.jpg')
    assert.equal(db.storageObjects[0].size_bytes, 12345)
    assert.equal(db.storageReferences.length, 2)
    assert.deepEqual(
      db.storageReferences.map((ref) => [ref.source_type, ref.source_id, ref.source_field]),
      [
        ['page', 'page-1', 'image_url'],
        ['page', 'page-2', 'image_url'],
      ],
    )

    const second = await backfillLegacyPageStorage(db, r2, {
      tenantId: 'tenant-1',
      dryRun: false,
    })

    assert.equal(second.pages_reviewed, 1)
    assert.equal(second.unique_objects, 0)
    assert.equal(second.pages_updated, 0)
    assert.equal(second.references_created, 0)
    assert.equal(db.storageObjects.length, 1)
    assert.equal(db.storageReferences.length, 2)
  } finally {
    await cleanup()
  }
})
