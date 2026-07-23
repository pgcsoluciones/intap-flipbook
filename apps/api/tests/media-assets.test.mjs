import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const SECRET = 'test-secret'

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function signJwt(payload) {
  const now = Math.floor(Date.now() / 1000)
  const body = { ...payload, iat: now, exp: now + 86400 }
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const claims = base64url(JSON.stringify(body))
  const input = `${header}.${claims}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign(
    { name: 'HMAC', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(input),
  )
  return `${input}.${base64url(Buffer.from(sig))}`
}

async function loadUploadRouter() {
  const dir = await mkdtemp(join(tmpdir(), 'media-assets-test-'))
  const outfile = join(dir, 'upload.mjs')
  await build({
    entryPoints: ['apps/api/src/routes/upload.ts'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
  })
  const mod = await import(pathToFileURL(outfile).href)
  return {
    upload: mod.default,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

class FakeR2 {
  constructor(seed = {}) {
    this.puts = []
    this.deletes = []
    this.objects = new Map(seed.objects ?? [])
  }

  async get(key) {
    return this.objects.get(key) ?? null
  }

  async put(key, body, options) {
    this.puts.push({ key, body, options })
  }

  async delete(key) {
    this.deletes.push(key)
  }
}

class FakeD1 {
  constructor(seed = {}) {
    this.users = seed.users ?? [{ id: 'user-1', plan_id: 'free' }]
    this.plans = seed.plans ?? [{ id: 'free', name: 'Free', max_publications: 1, max_pages_per_pub: 10, max_storage_mb: 50, custom_domain: 0, sound_enabled: 0, price_usd: 0 }]
    this.publications = seed.publications ?? [
      { id: 'pub-1', user_id: 'user-1', cover_image_url: null, social_image_url: null },
      { id: 'pub-2', user_id: 'user-1', cover_image_url: null, social_image_url: null },
      { id: 'other-pub', user_id: 'user-2', cover_image_url: null, social_image_url: null },
    ]
    this.pages = seed.pages ?? []
    this.dynamicMarkers = seed.dynamicMarkers ?? []
    this.mediaAssets = seed.mediaAssets ?? []
    this.mediaFolders = seed.mediaFolders ?? []
    this.addUsageOnSecondUsageCheck = seed.addUsageOnSecondUsageCheck ?? false
    this.maxBoundParams = seed.maxBoundParams ?? null
    this.pageUsageQueryCount = 0
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
    if (this.db.maxBoundParams && params.length > this.db.maxBoundParams) {
      throw new Error(`too many bound SQL parameters: ${params.length}`)
    }
    this.params = params
    return this
  }

  async first() {
    const sql = this.sql
    if (sql.startsWith('SELECT id, plan_id')) {
      const [userId] = this.params
      return this.db.users.find((user) => user.id === userId) ?? null
    }
    if (sql.startsWith('SELECT * FROM plans')) {
      const [planId] = this.params
      return this.db.plans.find((plan) => plan.id === planId) ?? null
    }
    if (sql.startsWith('SELECT COALESCE(SUM(size_bytes)')) {
      return { total: this.db.pages.reduce((sum, page) => sum + (page.size_bytes ?? 0), 0) }
    }
    if (sql.startsWith('SELECT id FROM publications')) {
      const [publicationId, userId] = this.params
      return this.db.publications.find((pub) => pub.id === publicationId && pub.user_id === userId) ?? null
    }
    if (sql.startsWith('SELECT * FROM publications')) {
      const [publicationId] = this.params
      return this.db.publications.find((pub) => pub.id === publicationId) ?? null
    }
    if (sql.startsWith('SELECT * FROM media_assets WHERE') && sql.includes('public_url = ?')) {
      const [tenantId, publicationId, publicUrl] = this.params
      return this.db.mediaAssets.find((asset) =>
        asset.tenant_id === tenantId
        && asset.publication_id === publicationId
        && asset.public_url === publicUrl
      ) ?? null
    }
    if (sql.startsWith('SELECT * FROM media_assets WHERE') && !sql.includes('sha256 = ?')) {
      const [assetId, publicationId] = this.params
      return this.db.mediaAssets.find((asset) =>
        asset.id === assetId
        && (!publicationId || asset.publication_id === publicationId)
      ) ?? null
    }
    if (sql.startsWith('SELECT * FROM media_folders WHERE')) {
      const [folderId, tenantId, publicationId] = this.params
      return this.db.mediaFolders.find((folder) =>
        folder.id === folderId
        && folder.tenant_id === tenantId
        && (!publicationId || folder.publication_id === publicationId)
      ) ?? null
    }
    if (sql.startsWith('SELECT id FROM media_folders')) {
      const [tenantId, publicationId, name, exceptId] = this.params
      return this.db.mediaFolders.find((folder) =>
        folder.tenant_id === tenantId
        && folder.publication_id === publicationId
        && folder.name.toLowerCase() === String(name).toLowerCase()
        && (!exceptId || folder.id !== exceptId)
      ) ?? null
    }
    if (sql.startsWith('SELECT COUNT(*) AS count FROM media_assets')) {
      const [tenantId, publicationId, folderId] = this.params
      return { count: this.db.mediaAssets.filter((asset) =>
        asset.tenant_id === tenantId
        && asset.publication_id === publicationId
        && asset.folder_id === folderId
      ).length }
    }
    if (sql.startsWith('SELECT COUNT(*) as count FROM media_assets')) {
      const [tenantId, publicationId, storageBucket] = this.params
      let index = 3
      let rows = this.db.mediaAssets.filter((asset) =>
        asset.tenant_id === tenantId
        && asset.publication_id === publicationId
        && asset.storage_bucket === storageBucket
        && !asset.is_hidden
        && !asset.deleted_at
        && ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/gif'].includes(asset.mime_type)
      )
      if (this.sql.includes('folder_id IS NULL')) {
        rows = rows.filter((asset) => asset.folder_id == null)
      } else if (this.sql.includes('folder_id = ?')) {
        const folderId = this.params[index++]
        rows = rows.filter((asset) => asset.folder_id === folderId)
      }
      if (this.sql.includes('original_name LIKE ?')) {
        const q = String(this.params[index++]).replace(/%/g, '').toLowerCase()
        rows = rows.filter((asset) => asset.original_name.toLowerCase().includes(q))
      }
      if (this.sql.includes('optimized_url IS NULL')) {
        rows = rows.filter((asset) => !asset.thumbnail_url || !asset.optimized_url)
      } else if (this.sql.includes('thumbnail_url IS NULL')) {
        rows = rows.filter((asset) => !asset.thumbnail_url)
      }
      return { count: rows.length }
    }
    if (sql.includes('FROM media_assets') && sql.includes('sha256 = ?')) {
      const [tenantId, publicationId, sha256, storageBucket] = this.params
      return this.db.mediaAssets.find((asset) =>
        asset.tenant_id === tenantId
        && asset.publication_id === publicationId
        && asset.sha256 === sha256
        && asset.storage_bucket === storageBucket
      ) ?? null
    }
    throw new Error(`Unhandled first SQL: ${this.sql}`)
  }

  async all() {
    if (this.sql.includes('FROM media_folders f')) {
      const [tenantId, publicationId] = this.params
      return {
        results: this.db.mediaFolders
          .filter((folder) => folder.tenant_id === tenantId && folder.publication_id === publicationId)
          .map((folder) => ({
            ...folder,
            asset_count: this.db.mediaAssets.filter((asset) =>
              asset.tenant_id === tenantId
              && asset.publication_id === publicationId
              && asset.folder_id === folder.id
              && !asset.is_hidden
              && !asset.deleted_at
            ).length,
          }))
          .sort((a, b) => a.name.localeCompare(b.name) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)),
      }
    }
    if (this.sql.startsWith('SELECT public_url FROM media_assets')) {
      const [tenantId, publicationId] = this.params
      return { results: this.db.mediaAssets.filter((asset) =>
        asset.tenant_id === tenantId
        && asset.publication_id === publicationId
      ).map((asset) => ({ public_url: asset.public_url })) }
    }
    if (this.sql.startsWith('SELECT id FROM media_assets') && this.sql.includes('id IN')) {
      const [tenantId, publicationId, ...assetIds] = this.params
      const allowed = new Set(assetIds)
      return { results: this.db.mediaAssets.filter((asset) =>
        asset.tenant_id === tenantId
        && asset.publication_id === publicationId
        && allowed.has(asset.id)
        && !asset.is_hidden
        && !asset.deleted_at
      ).map((asset) => ({ id: asset.id })) }
    }
    if (this.sql.startsWith('SELECT * FROM media_assets WHERE') && this.sql.includes('public_url IN')) {
      const [tenantId, publicationId, ...urls] = this.params
      const allowed = new Set(urls)
      return { results: this.db.mediaAssets.filter((asset) =>
        asset.tenant_id === tenantId
        && asset.publication_id === publicationId
        && allowed.has(asset.public_url)
        && !asset.is_hidden
        && !asset.deleted_at
      ) }
    }
    if (this.sql.includes('FROM media_assets')) {
      const [tenantId, publicationId, storageBucket] = this.params
      let index = 3
      let rows = this.db.mediaAssets.filter((asset) =>
        asset.tenant_id === tenantId
        && asset.publication_id === publicationId
        && asset.storage_bucket === storageBucket
        && !asset.is_hidden
        && !asset.deleted_at
        && ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/gif'].includes(asset.mime_type)
      )
      if (this.sql.includes('folder_id IS NULL')) {
        rows = rows.filter((asset) => asset.folder_id == null)
      } else if (this.sql.includes('folder_id = ?')) {
        const folderId = this.params[index++]
        rows = rows.filter((asset) => asset.folder_id === folderId)
      }
      if (this.sql.includes('original_name LIKE ?')) {
        const q = String(this.params[index++]).replace(/%/g, '').toLowerCase()
        rows = rows.filter((asset) => asset.original_name.toLowerCase().includes(q))
      }
      if (this.sql.includes('optimized_url IS NULL')) {
        index += 2
        rows = rows.filter((asset) => !asset.thumbnail_url || !asset.optimized_url)
      } else if (this.sql.includes('thumbnail_url IS NULL')) {
        index += 1
        rows = rows.filter((asset) => !asset.thumbnail_url)
      }
      if (this.sql.includes('created_at < ?')) {
        const [createdAt, sameCreatedAt, id] = this.params.slice(index, index + 3)
        index += 3
        rows = rows.filter((asset) => asset.created_at < createdAt || (asset.created_at === sameCreatedAt && asset.id < id))
      }
      const limit = this.params[index]
      const offset = Number(this.params[index + 1] ?? 0)
      rows = [...rows].sort((a, b) =>
        String(b.created_at).localeCompare(String(a.created_at))
        || String(b.id).localeCompare(String(a.id)),
      )
      return { results: rows.slice(offset, offset + limit) }
    }
    if (this.sql.startsWith('SELECT id, page_number, image_url, canvas_json, cover_json FROM pages')) {
      const [publicationId] = this.params
      this.db.pageUsageQueryCount += 1
      let rows = this.db.pages.filter((page) => page.publication_id === publicationId)
      if (this.db.addUsageOnSecondUsageCheck && this.db.pageUsageQueryCount >= 2) {
        rows = rows.concat([{ id: 'late-page', publication_id: publicationId, page_number: 99, image_url: '/api/upload/uploads/user-1/free.png', canvas_json: null, cover_json: null }])
      }
      return { results: rows }
    }
    if (this.sql.startsWith('SELECT id, page_id, media_json FROM dynamic_markers')) {
      const [publicationId] = this.params
      return { results: this.db.dynamicMarkers.filter((marker) => marker.publication_id === publicationId) }
    }
    throw new Error(`Unhandled all SQL: ${this.sql}`)
  }

  async run() {
    if (this.sql.startsWith('INSERT INTO media_folders')) {
      const [id, tenant_id, publication_id, name, created_at, updated_at] = this.params
      if (this.db.mediaFolders.some((folder) =>
        folder.tenant_id === tenant_id
        && folder.publication_id === publication_id
        && folder.name.toLowerCase() === String(name).toLowerCase()
      )) {
        throw new Error('UNIQUE constraint failed: media_folders.tenant_id, media_folders.publication_id, media_folders.name')
      }
      this.db.mediaFolders.push({ id, tenant_id, publication_id, name, created_at, updated_at })
      return { success: true }
    }
    if (this.sql.startsWith('UPDATE media_folders')) {
      const [name, updatedAt, folderId, tenantId] = this.params
      this.db.mediaFolders = this.db.mediaFolders.map((folder) =>
        folder.id === folderId && folder.tenant_id === tenantId ? { ...folder, name, updated_at: updatedAt } : folder,
      )
      return { success: true }
    }
    if (this.sql.startsWith('DELETE FROM media_folders')) {
      const [folderId, tenantId] = this.params
      this.db.mediaFolders = this.db.mediaFolders.filter((folder) => !(folder.id === folderId && folder.tenant_id === tenantId))
      return { success: true }
    }
    if (this.sql.startsWith('INSERT INTO media_assets')) {
      const hasFolderColumn = this.sql.includes('publication_id, folder_id, storage_bucket')
      const id = this.params[0]
      const tenant_id = this.params[1]
      const publication_id = this.params[2]
      const folder_id = hasFolderColumn ? this.params[3] : null
      const storage_bucket = this.params[hasFolderColumn ? 4 : 3]
      const storage_key = this.params[hasFolderColumn ? 5 : 4]
      const public_url = this.params[hasFolderColumn ? 6 : 5]
      const original_name = this.params[hasFolderColumn ? 7 : 6]
      const mime_type = this.params[hasFolderColumn ? 8 : 7]
      const size_bytes = this.params[hasFolderColumn ? 9 : 8]
      const sha256 = this.params[hasFolderColumn ? 10 : 9]
      const width = this.params[hasFolderColumn ? 11 : 10]
      const height = this.params[hasFolderColumn ? 12 : 11]
      const offset = hasFolderColumn ? 1 : 0
      const hasDisplayVariantColumns = this.params.length >= 33 + offset
      const hasOptimizationColumns = this.params.length > 14
      const optimization = hasDisplayVariantColumns
        ? {
            original_mime_type: this.params[12 + offset],
            original_size_bytes: this.params[13 + offset],
            original_width: this.params[14 + offset],
            original_height: this.params[15 + offset],
            optimized_storage_key: this.params[16 + offset],
            optimized_url: this.params[17 + offset],
            optimized_mime_type: this.params[18 + offset],
            optimized_size_bytes: this.params[19 + offset],
            optimized_width: this.params[20 + offset],
            optimized_height: this.params[21 + offset],
            thumbnail_storage_key: this.params[22 + offset],
            thumbnail_url: this.params[23 + offset],
            thumbnail_mime_type: this.params[24 + offset],
            thumbnail_size_bytes: this.params[25 + offset],
            thumbnail_width: this.params[26 + offset],
            thumbnail_height: this.params[27 + offset],
            optimization_status: this.params[28 + offset],
            optimization_version: this.params[29 + offset],
            optimized_at: this.params[30 + offset],
            created_at: this.params[31 + offset],
            updated_at: this.params[32 + offset],
          }
        : hasOptimizationColumns
        ? {
            original_mime_type: this.params[12],
            original_size_bytes: this.params[13],
            original_width: this.params[14],
            original_height: this.params[15],
            thumbnail_storage_key: this.params[16],
            thumbnail_url: this.params[17],
            thumbnail_mime_type: this.params[18],
            thumbnail_size_bytes: this.params[19],
            thumbnail_width: this.params[20],
            thumbnail_height: this.params[21],
            optimization_status: this.params[22],
            optimization_version: this.params[23],
            optimized_at: this.params[24],
            created_at: this.params[25],
            updated_at: this.params[26],
          }
        : {
            created_at: this.params[12],
            updated_at: this.params[13],
          }
      if (this.db.mediaAssets.some((asset) =>
        asset.tenant_id === tenant_id
        && asset.publication_id === publication_id
        && asset.storage_bucket === storage_bucket
        && asset.sha256 === sha256
      )) {
        throw new Error('UNIQUE constraint failed: media_assets.tenant_id, media_assets.publication_id, media_assets.storage_bucket, media_assets.sha256')
      }
      this.db.mediaAssets.push({
        id,
        tenant_id,
        publication_id,
        folder_id,
        storage_bucket,
        storage_key,
        public_url,
        original_name,
        mime_type,
        size_bytes,
        sha256,
        width,
        height,
        ...optimization,
      })
      return { success: true }
    }
    if (this.sql.startsWith('UPDATE media_assets SET folder_id = ?, updated_at = ?')) {
      if (this.sql.includes('id IN')) {
        const [folderId, updatedAt, tenantId, publicationId, ...assetIds] = this.params
        const allowed = new Set(assetIds)
        this.db.mediaAssets = this.db.mediaAssets.map((asset) =>
          asset.tenant_id === tenantId && asset.publication_id === publicationId && allowed.has(asset.id)
            ? { ...asset, folder_id: folderId, updated_at: updatedAt }
            : asset,
        )
        return { success: true }
      }
      const [folderId, updatedAt, assetId, tenantId, publicationId] = this.params
      this.db.mediaAssets = this.db.mediaAssets.map((asset) =>
        asset.id === assetId && asset.tenant_id === tenantId && asset.publication_id === publicationId
          ? { ...asset, folder_id: folderId, updated_at: updatedAt }
          : asset,
      )
      return { success: true }
    }
    if (this.sql.startsWith('UPDATE media_assets SET folder_id = NULL')) {
      const [updatedAt, tenantId, publicationId, folderId] = this.params
      this.db.mediaAssets = this.db.mediaAssets.map((asset) =>
        asset.tenant_id === tenantId && asset.publication_id === publicationId && asset.folder_id === folderId
          ? { ...asset, folder_id: null, updated_at: updatedAt }
          : asset,
      )
      return { success: true }
    }
    if (this.sql.startsWith('UPDATE media_assets SET optimized_storage_key = ?')) {
      const [
        optimized_storage_key,
        optimized_url,
        optimized_mime_type,
        optimized_size_bytes,
        optimized_width,
        optimized_height,
        thumbnail_storage_key,
        thumbnail_url,
        thumbnail_mime_type,
        thumbnail_size_bytes,
        thumbnail_width,
        thumbnail_height,
        optimization_status,
        optimization_version,
        optimized_at,
        updated_at,
        id,
        tenantId,
        publicationId,
      ] = this.params
      this.db.mediaAssets = this.db.mediaAssets.map((asset) =>
        asset.id === id && asset.tenant_id === tenantId && asset.publication_id === publicationId
          ? {
              ...asset,
              optimized_storage_key,
              optimized_url,
              optimized_mime_type,
              optimized_size_bytes,
              optimized_width,
              optimized_height,
              thumbnail_storage_key,
              thumbnail_url,
              thumbnail_mime_type,
              thumbnail_size_bytes,
              thumbnail_width,
              thumbnail_height,
              optimization_status: asset.optimization_status ?? optimization_status,
              optimization_version: asset.optimization_version ?? optimization_version,
              optimized_at: asset.optimized_at ?? optimized_at,
              updated_at,
            }
          : asset,
      )
      return { success: true }
    }
    if (this.sql.startsWith('UPDATE media_assets SET thumbnail_storage_key = ?')) {
      const [
        thumbnail_storage_key,
        thumbnail_url,
        thumbnail_mime_type,
        thumbnail_size_bytes,
        thumbnail_width,
        thumbnail_height,
        optimization_status,
        optimization_version,
        optimized_at,
        updated_at,
        id,
        tenantId,
        publicationId,
      ] = this.params
      this.db.mediaAssets = this.db.mediaAssets.map((asset) =>
        asset.id === id && asset.tenant_id === tenantId && (!publicationId || asset.publication_id === publicationId)
          ? {
              ...asset,
              thumbnail_storage_key,
              thumbnail_url,
              thumbnail_mime_type,
              thumbnail_size_bytes,
              thumbnail_width,
              thumbnail_height,
              optimization_status,
              optimization_version,
              optimized_at,
              updated_at,
            }
          : asset,
      )
      return { success: true }
    }
    if (this.sql.startsWith('UPDATE media_assets SET is_hidden = ?, updated_at = ?')) {
      const [isHidden, updatedAt, id, tenantId] = this.params
      this.db.mediaAssets = this.db.mediaAssets.map((asset) =>
        asset.id === id && asset.tenant_id === tenantId ? { ...asset, is_hidden: isHidden, updated_at: updatedAt } : asset,
      )
      return { success: true }
    }
    if (this.sql.startsWith('UPDATE media_assets SET deleted_at = ?')) {
      const [deletedAt, updatedAt, id, tenantId] = this.params
      this.db.mediaAssets = this.db.mediaAssets.map((asset) =>
        asset.id === id && asset.tenant_id === tenantId ? { ...asset, deleted_at: deletedAt, is_hidden: 1, updated_at: updatedAt } : asset,
      )
      return { success: true }
    }
    throw new Error(`Unhandled run SQL: ${this.sql}`)
  }
}

async function requestUpload(db, r2, path, init = {}, userId = 'user-1') {
  const { upload, cleanup } = await loadUploadRouter()
  try {
    const token = await signJwt({ sub: userId, email: `${userId}@example.test` })
    const response = await upload.request(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    }, {
      DB: db,
      MEDIA: r2,
      JWT_SECRET: SECRET,
      R2_PUBLIC_BASE_URL: 'https://media.example.test',
    })
    const body = await response.json()
    return { status: response.status, body }
  } finally {
    await cleanup()
  }
}

async function requestPublicUpload(r2, path, method = 'GET') {
  const { upload, cleanup } = await loadUploadRouter()

  try {
    const response = await upload.request(path, { method }, {
      DB: new FakeD1(),
      MEDIA: r2,
      JWT_SECRET: SECRET,
      R2_PUBLIC_BASE_URL: 'https://media.example.test',
    })

    const body = new Uint8Array(await response.arrayBuffer())

    return {
      status: response.status,
      body,
      contentType: response.headers.get('content-type'),
      etag: response.headers.get('etag'),
      accessControlAllowOrigin: response.headers.get(
        'access-control-allow-origin',
      ),
      crossOriginResourcePolicy: response.headers.get(
        'cross-origin-resource-policy',
      ),
      timingAllowOrigin: response.headers.get('timing-allow-origin'),
      cacheControl: response.headers.get('cache-control'),
      contentTypeOptions: response.headers.get('x-content-type-options'),
    }
  } finally {
    await cleanup()
  }
}

function form(publicationId, file) {
  const data = new FormData()
  data.append('publication_id', publicationId)
  data.append('file', file)
  data.append('width', '120')
  data.append('height', '80')
  return data
}

function optimizedForm(publicationId, file, thumbnail) {
  const data = form(publicationId, file)
  data.append('thumbnail', thumbnail)
  data.append('original_name', 'large-original.jpg')
  data.append('original_mime_type', 'image/jpeg')
  data.append('original_size_bytes', '4000000')
  data.append('original_width', '4000')
  data.append('original_height', '3000')
  data.append('optimized_mime_type', file.type)
  data.append('optimized_size_bytes', String(file.size))
  data.append('optimized_width', '2400')
  data.append('optimized_height', '1800')
  data.append('thumbnail_size_bytes', String(thumbnail.size))
  data.append('thumbnail_width', '360')
  data.append('thumbnail_height', '270')
  data.append('compression_saved_bytes', '3000000')
  data.append('compression_saved_percent', '75')
  data.append('optimization_status', 'optimized')
  data.append('optimization_version', 'phase1b-test')
  return data
}

function variantsForm(publicationId, display, thumbnail) {
  const data = new FormData()
  data.append('publication_id', publicationId)
  if (display) data.append('display', display)
  if (thumbnail) data.append('thumbnail', thumbnail)
  data.append('optimized_width', '1800')
  data.append('optimized_height', '1200')
  data.append('thumbnail_width', '360')
  data.append('thumbnail_height', '240')
  data.append('optimization_status', 'optimized')
  data.append('optimization_version', 'phase1b-test')
  return data
}

function multiForm(publicationId, files) {
  const data = new FormData()
  data.append('publication_id', publicationId)
  for (const file of files) data.append('file', file)
  return data
}

function pngFile(name, content) {
  return new File([content], name, { type: 'image/png' })
}

test('public upload allows cross-origin Fabric rendering and immutable cache', async () => {
  const key = 'uploads/user-1/public-image.webp'

  const object = {
    body: new Uint8Array([1, 2, 3, 4]),
    httpEtag: '"public-etag"',
    writeHttpMetadata(headers) {
      headers.set('content-type', 'image/webp')
      headers.set('content-length', '4')
    },
  }

  const r2 = new FakeR2({
    objects: [[key, object]],
  })

  const getResult = await requestPublicUpload(
    r2,
    '/uploads/user-1/public-image.webp',
  )

  assert.equal(getResult.status, 200)
  assert.equal(getResult.contentType, 'image/webp')
  assert.equal(getResult.etag, '"public-etag"')
  assert.equal(getResult.accessControlAllowOrigin, '*')
  assert.equal(getResult.crossOriginResourcePolicy, 'cross-origin')
  assert.equal(getResult.timingAllowOrigin, '*')
  assert.equal(
    getResult.cacheControl,
    'public, max-age=31536000, immutable',
  )
  assert.equal(getResult.contentTypeOptions, 'nosniff')
  assert.deepEqual([...getResult.body], [1, 2, 3, 4])

  const headResult = await requestPublicUpload(
    r2,
    '/uploads/user-1/public-image.webp',
    'HEAD',
  )

  assert.equal(headResult.status, 200)
  assert.equal(headResult.accessControlAllowOrigin, '*')
  assert.equal(
    headResult.cacheControl,
    'public, max-age=31536000, immutable',
  )
  assert.equal(headResult.body.byteLength, 0)
})

test('first upload creates media_asset, puts once and returns reused false', async () => {
  const db = new FakeD1()
  const r2 = new FakeR2()
  const result = await requestUpload(db, r2, '/media-assets', {
    method: 'POST',
    body: form('pub-1', pngFile('hero.png', 'same-bytes')),
  })

  assert.equal(result.status, 201)
  assert.equal(result.body.success, true)
  assert.equal(result.body.data.reused, false)
  assert.equal(db.mediaAssets.length, 1)
  assert.equal(r2.puts.length, 1)
  assert.equal(db.mediaAssets[0].original_name, 'hero.png')
})

test('optimized upload stores display and thumbnail in separate keys with metadata', async () => {
  const db = new FakeD1()
  const r2 = new FakeR2()
  const result = await requestUpload(db, r2, '/media-assets', {
    method: 'POST',
    body: optimizedForm('pub-1', new File(['display'], 'large.webp', { type: 'image/webp' }), new File(['thumb'], 'large-thumb.webp', { type: 'image/webp' })),
  })

  assert.equal(result.status, 201)
  assert.equal(r2.puts.length, 2)
  assert.notEqual(r2.puts[0].key, r2.puts[1].key)
  assert.equal(result.body.data.asset.thumbnail_url.includes('-thumb.webp'), true)
  assert.equal(result.body.data.asset.optimization_status, 'optimized')
  assert.equal(result.body.data.asset.original_width, 4000)
  assert.equal(result.body.data.asset.original_name, 'large-original.jpg')
})

test('repeated optimized asset reuses display and completes missing thumbnail only once', async () => {
  const db = new FakeD1()
  const r2 = new FakeR2()
  await requestUpload(db, r2, '/media-assets', {
    method: 'POST',
    body: form('pub-1', new File(['same'], 'same.webp', { type: 'image/webp' })),
  })
  const result = await requestUpload(db, r2, '/media-assets', {
    method: 'POST',
    body: optimizedForm('pub-1', new File(['same'], 'same.webp', { type: 'image/webp' }), new File(['thumb'], 'same-thumb.webp', { type: 'image/webp' })),
  })

  assert.equal(result.status, 200)
  assert.equal(result.body.data.reused, true)
  assert.equal(r2.puts.length, 2)
  assert.equal(db.mediaAssets.length, 1)
  assert.equal(db.mediaAssets[0].thumbnail_url.includes('-thumb.webp'), true)
})

test('asset antiguo puede completar thumbnail sin cambiar public_url', async () => {
  const db = new FakeD1({
    mediaAssets: [
      { id: 'old', tenant_id: 'user-1', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/old.png', public_url: 'https://media.example.test/uploads/user-1/old.png', original_name: 'old.png', mime_type: 'image/png', size_bytes: 99, sha256: 'old', width: null, height: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
  })
  const r2 = new FakeR2()
  const data = new FormData()
  data.append('publication_id', 'pub-1')
  data.append('thumbnail', new File(['thumb'], 'old-thumb.webp', { type: 'image/webp' }))
  data.append('thumbnail_width', '360')
  data.append('thumbnail_height', '270')
  data.append('optimization_status', 'thumbnail_only')
  data.append('optimization_version', 'phase1b-test')

  const result = await requestUpload(db, r2, '/media-assets/old/thumbnail', { method: 'POST', body: data })

  assert.equal(result.status, 200)
  assert.equal(result.body.data.asset.public_url, 'https://media.example.test/uploads/user-1/old.png')
  assert.equal(result.body.data.asset.thumbnail_url, 'https://media.example.test/uploads/user-1/old-thumb.webp')
  assert.equal(r2.puts.length, 1)
})

test('tenant A no puede completar thumbnail de un asset del tenant B', async () => {
  const db = new FakeD1({
    mediaAssets: [
      { id: 'foreign', tenant_id: 'user-2', publication_id: 'other-pub', storage_bucket: 'MEDIA', storage_key: 'uploads/user-2/foreign.png', public_url: 'https://media.example.test/uploads/user-2/foreign.png', original_name: 'foreign.png', mime_type: 'image/png', size_bytes: 99, sha256: 'foreign', width: null, height: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
  })
  const r2 = new FakeR2()
  const data = new FormData()
  data.append('publication_id', 'other-pub')
  data.append('thumbnail', new File(['thumb'], 'foreign-thumb.webp', { type: 'image/webp' }))

  const result = await requestUpload(db, r2, '/media-assets/foreign/thumbnail', { method: 'POST', body: data }, 'user-1')

  assert.equal(result.status, 403)
  assert.equal(r2.puts.length, 0)
  assert.equal(db.mediaAssets[0].thumbnail_url, undefined)
})

test('publicacion A no puede modificar asset exclusivo de publicacion B', async () => {
  const db = new FakeD1({
    mediaAssets: [
      { id: 'pub2-asset', tenant_id: 'user-1', publication_id: 'pub-2', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/pub2.png', public_url: 'https://media.example.test/uploads/user-1/pub2.png', original_name: 'pub2.png', mime_type: 'image/png', size_bytes: 99, sha256: 'pub2', width: null, height: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
  })
  const r2 = new FakeR2()
  const data = new FormData()
  data.append('publication_id', 'pub-1')
  data.append('thumbnail', new File(['thumb'], 'pub2-thumb.webp', { type: 'image/webp' }))

  const result = await requestUpload(db, r2, '/media-assets/pub2-asset/thumbnail', { method: 'POST', body: data })

  assert.equal(result.status, 404)
  assert.equal(r2.puts.length, 0)
  assert.equal(db.mediaAssets[0].thumbnail_url, undefined)
})

test('deduplicacion no mezcla tenants con el mismo archivo', async () => {
  const db = new FakeD1({
    users: [{ id: 'user-1', plan_id: 'free' }, { id: 'user-2', plan_id: 'free' }],
  })
  const r2 = new FakeR2()
  const first = await requestUpload(db, r2, '/media-assets', {
    method: 'POST',
    body: form('pub-1', pngFile('same.png', 'same-bytes')),
  }, 'user-1')
  const second = await requestUpload(db, r2, '/media-assets', {
    method: 'POST',
    body: form('other-pub', pngFile('same.png', 'same-bytes')),
  }, 'user-2')

  assert.equal(first.status, 201)
  assert.equal(second.status, 201)
  assert.equal(second.body.data.reused, false)
  assert.equal(db.mediaAssets.length, 2)
  assert.deepEqual(new Set(db.mediaAssets.map((asset) => asset.tenant_id)), new Set(['user-1', 'user-2']))
})

test('same file in same publication reuses asset and does not put again', async () => {
  const db = new FakeD1()
  const r2 = new FakeR2()
  await requestUpload(db, r2, '/media-assets', {
    method: 'POST',
    body: form('pub-1', pngFile('hero.png', 'same-bytes')),
  })
  const result = await requestUpload(db, r2, '/media-assets', {
    method: 'POST',
    body: form('pub-1', pngFile('renamed.png', 'same-bytes')),
  })

  assert.equal(result.status, 200)
  assert.equal(result.body.data.reused, true)
  assert.equal(db.mediaAssets.length, 1)
  assert.equal(r2.puts.length, 1)
  assert.equal(result.body.data.asset.original_name, 'hero.png')
})

test('same name with different content creates a different asset', async () => {
  const db = new FakeD1()
  const r2 = new FakeR2()
  await requestUpload(db, r2, '/media-assets', {
    method: 'POST',
    body: form('pub-1', pngFile('hero.png', 'content-a')),
  })
  const result = await requestUpload(db, r2, '/media-assets', {
    method: 'POST',
    body: form('pub-1', pngFile('hero.png', 'content-b')),
  })

  assert.equal(result.status, 201)
  assert.equal(result.body.data.reused, false)
  assert.equal(db.mediaAssets.length, 2)
  assert.equal(r2.puts.length, 2)
  assert.notEqual(db.mediaAssets[0].sha256, db.mediaAssets[1].sha256)
})

test('same file in another publication does not mix banks', async () => {
  const db = new FakeD1()
  const r2 = new FakeR2()
  await requestUpload(db, r2, '/media-assets', {
    method: 'POST',
    body: form('pub-1', pngFile('hero.png', 'same-bytes')),
  })
  const result = await requestUpload(db, r2, '/media-assets', {
    method: 'POST',
    body: form('pub-2', pngFile('hero.png', 'same-bytes')),
  })

  assert.equal(result.status, 201)
  assert.equal(result.body.data.reused, false)
  assert.equal(db.mediaAssets.length, 2)
  assert.equal(r2.puts.length, 2)
  assert.deepEqual(new Set(db.mediaAssets.map((asset) => asset.publication_id)), new Set(['pub-1', 'pub-2']))
})

test('publication from another tenant is rejected', async () => {
  const db = new FakeD1()
  const r2 = new FakeR2()
  const result = await requestUpload(db, r2, '/media-assets', {
    method: 'POST',
    body: form('other-pub', pngFile('hero.png', 'same-bytes')),
  })

  assert.equal(result.status, 404)
  assert.equal(result.body.success, false)
  assert.equal(db.mediaAssets.length, 0)
  assert.equal(r2.puts.length, 0)
})

test('unsupported MIME is rejected with a clear error', async () => {
  const db = new FakeD1()
  const r2 = new FakeR2()
  const result = await requestUpload(db, r2, '/media-assets', {
    method: 'POST',
    body: form('pub-1', new File(['hello'], 'notes.txt', { type: 'text/plain' })),
  })

  assert.equal(result.status, 415)
  assert.equal(result.body.success, false)
  assert.match(result.body.error, /Tipo de imagen no permitido/)
  assert.equal(r2.puts.length, 0)
})

test('listing returns only authorized publication images with limit and recent order', async () => {
  const db = new FakeD1({
    mediaAssets: [
      { id: 'a1', tenant_id: 'user-1', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/a1.png', public_url: 'https://media.example.test/uploads/user-1/a1.png', original_name: 'older.png', mime_type: 'image/png', size_bytes: 1, sha256: '1', width: null, height: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 'a2', tenant_id: 'user-1', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/a2.png', public_url: 'https://media.example.test/uploads/user-1/a2.png', original_name: 'newer.png', mime_type: 'image/png', size_bytes: 1, sha256: '2', width: null, height: null, created_at: '2026-01-03T00:00:00.000Z', updated_at: '2026-01-03T00:00:00.000Z' },
      { id: 'a3', tenant_id: 'user-1', publication_id: 'pub-2', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/a3.png', public_url: 'https://media.example.test/uploads/user-1/a3.png', original_name: 'other-pub.png', mime_type: 'image/png', size_bytes: 1, sha256: '3', width: null, height: null, created_at: '2026-01-04T00:00:00.000Z', updated_at: '2026-01-04T00:00:00.000Z' },
      { id: 'a4', tenant_id: 'user-2', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-2/a4.png', public_url: 'https://media.example.test/uploads/user-2/a4.png', original_name: 'other-tenant.png', mime_type: 'image/png', size_bytes: 1, sha256: '4', width: null, height: null, created_at: '2026-01-05T00:00:00.000Z', updated_at: '2026-01-05T00:00:00.000Z' },
    ],
  })
  const r2 = new FakeR2()
  const result = await requestUpload(db, r2, '/media-assets?publication_id=pub-1&limit=1', { method: 'GET' })

  assert.equal(result.status, 200)
  assert.deepEqual(result.body.data.map((asset) => asset.id), ['a2'])
  assert.equal(result.body.page.has_more, true)
  assert.ok(result.body.page.next_cursor)
})

test('multiple upload with three different images creates assets in selected order', async () => {
  const db = new FakeD1()
  const r2 = new FakeR2()
  const result = await requestUpload(db, r2, '/media-assets', {
    method: 'POST',
    body: multiForm('pub-1', [
      pngFile('one.png', 'content-one'),
      pngFile('two.png', 'content-two'),
      pngFile('three.png', 'content-three'),
    ]),
  })

  assert.equal(result.status, 201)
  assert.deepEqual(result.body.data.results.map((item) => item.asset.original_name), ['one.png', 'two.png', 'three.png'])
  assert.deepEqual(result.body.data.results.map((item) => item.reused), [false, false, false])
  assert.equal(db.mediaAssets.length, 3)
  assert.equal(r2.puts.length, 3)
})

test('batch containing a repeated image reuses the existing asset without a second R2 put', async () => {
  const db = new FakeD1()
  const r2 = new FakeR2()
  const result = await requestUpload(db, r2, '/media-assets', {
    method: 'POST',
    body: multiForm('pub-1', [
      pngFile('first.png', 'same-content'),
      pngFile('repeat.png', 'same-content'),
      pngFile('different.png', 'different-content'),
    ]),
  })

  assert.equal(result.status, 201)
  assert.deepEqual(result.body.data.results.map((item) => item.reused), [false, true, false])
  assert.deepEqual(result.body.data.results.map((item) => item.asset.original_name), ['first.png', 'first.png', 'different.png'])
  assert.equal(db.mediaAssets.length, 2)
  assert.equal(r2.puts.length, 2)
})

test('same file uploaded later is reused and result order follows selected order', async () => {
  const db = new FakeD1()
  const r2 = new FakeR2()
  await requestUpload(db, r2, '/media-assets', {
    method: 'POST',
    body: form('pub-1', pngFile('existing.png', 'existing-content')),
  })
  const result = await requestUpload(db, r2, '/media-assets', {
    method: 'POST',
    body: multiForm('pub-1', [
      pngFile('new-first.png', 'new-first-content'),
      pngFile('existing-again.png', 'existing-content'),
    ]),
  })

  assert.equal(result.status, 201)
  assert.deepEqual(result.body.data.results.map((item) => item.asset.original_name), ['new-first.png', 'existing.png'])
  assert.deepEqual(result.body.data.results.map((item) => item.reused), [false, true])
  assert.equal(r2.puts.length, 2)
})

test('listing returns URL and metadata needed for thumbnails', async () => {
  const db = new FakeD1({
    mediaAssets: [
      { id: 'a1', tenant_id: 'user-1', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/a1.png', public_url: 'https://media.example.test/uploads/user-1/a1.png', original_name: 'thumb.png', mime_type: 'image/png', size_bytes: 1234, sha256: '1', width: 640, height: 480, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
  })
  const r2 = new FakeR2()
  const result = await requestUpload(db, r2, '/media-assets?publication_id=pub-1&limit=24', { method: 'GET' })

  assert.equal(result.status, 200)
  assert.equal(result.body.data[0].public_url, 'https://media.example.test/uploads/user-1/a1.png')
  assert.equal(result.body.data[0].original_name, 'thumb.png')
  assert.equal(result.body.data[0].mime_type, 'image/png')
  assert.equal(result.body.data[0].size_bytes, 1234)
  assert.equal(result.body.data[0].width, 640)
  assert.equal(result.body.data[0].height, 480)
  assert.equal(r2.puts.length, 0)
})

test('selecting/listing an existing resource does not execute upload', async () => {
  const db = new FakeD1({
    mediaAssets: [
      { id: 'a1', tenant_id: 'user-1', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/a1.png', public_url: 'https://media.example.test/uploads/user-1/a1.png', original_name: 'existing.png', mime_type: 'image/png', size_bytes: 1, sha256: '1', width: null, height: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
  })
  const r2 = new FakeR2()
  const result = await requestUpload(db, r2, '/media-assets?publication_id=pub-1', { method: 'GET' })

  assert.equal(result.status, 200)
  assert.equal(result.body.data.length, 1)
  assert.equal(r2.puts.length, 0)
})

test('listing paginates 12 assets and reports total pages', async () => {
  const mediaAssets = Array.from({ length: 13 }, (_, index) => ({
    id: `a${index + 1}`,
    tenant_id: 'user-1',
    publication_id: 'pub-1',
    storage_bucket: 'MEDIA',
    storage_key: `uploads/user-1/a${index + 1}.png`,
    public_url: `https://media.example.test/uploads/user-1/a${index + 1}.png`,
    original_name: `image-${index + 1}.png`,
    mime_type: 'image/png',
    size_bytes: 1,
    sha256: `${index + 1}`,
    width: null,
    height: null,
    created_at: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    updated_at: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
  }))
  const db = new FakeD1({ mediaAssets })
  const r2 = new FakeR2()
  const result = await requestUpload(db, r2, '/media-assets?publication_id=pub-1&limit=12&page=1', { method: 'GET' })

  assert.equal(result.status, 200)
  assert.equal(result.body.data.length, 12)
  assert.equal(result.body.page.total, 13)
  assert.equal(result.body.page.total_pages, 2)
  assert.equal(result.body.page.has_more, true)
})

test('listing pending thumbnails is scoped to tenant and publication', async () => {
  const db = new FakeD1({
    mediaAssets: [
      { id: 'pending-1', tenant_id: 'user-1', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/pending-1.png', public_url: 'https://media.example.test/uploads/user-1/pending-1.png', original_name: 'pending-1.png', mime_type: 'image/png', size_bytes: 1, sha256: '1', width: null, height: null, thumbnail_url: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 'ready-1', tenant_id: 'user-1', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/ready-1.png', public_url: 'https://media.example.test/uploads/user-1/ready-1.png', original_name: 'ready-1.png', mime_type: 'image/png', size_bytes: 1, sha256: '2', width: null, height: null, thumbnail_url: 'https://media.example.test/uploads/user-1/ready-1-thumb.webp', created_at: '2026-01-02T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z' },
      { id: 'pending-2', tenant_id: 'user-1', publication_id: 'pub-2', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/pending-2.png', public_url: 'https://media.example.test/uploads/user-1/pending-2.png', original_name: 'pending-2.png', mime_type: 'image/png', size_bytes: 1, sha256: '3', width: null, height: null, thumbnail_url: null, created_at: '2026-01-03T00:00:00.000Z', updated_at: '2026-01-03T00:00:00.000Z' },
      { id: 'foreign-pending', tenant_id: 'user-2', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-2/foreign.png', public_url: 'https://media.example.test/uploads/user-2/foreign.png', original_name: 'foreign.png', mime_type: 'image/png', size_bytes: 1, sha256: '4', width: null, height: null, thumbnail_url: null, created_at: '2026-01-04T00:00:00.000Z', updated_at: '2026-01-04T00:00:00.000Z' },
    ],
  })
  const r2 = new FakeR2()
  const result = await requestUpload(db, r2, '/media-assets?publication_id=pub-1&needs_thumbnail=true&limit=12&page=1', { method: 'GET' })

  assert.equal(result.status, 200)
  assert.deepEqual(result.body.data.map((asset) => asset.id), ['pending-1'])
  assert.equal(result.body.page.total, 1)
})

test('listing pending optimization includes assets missing display or thumbnail only in current publication', async () => {
  const db = new FakeD1({
    mediaAssets: [
      { id: 'missing-display', tenant_id: 'user-1', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/missing-display.png', public_url: 'https://media.example.test/uploads/user-1/missing-display.png', original_name: 'missing-display.png', mime_type: 'image/png', size_bytes: 1, sha256: '1', width: null, height: null, thumbnail_url: 'https://media.example.test/uploads/user-1/missing-display-thumb.webp', optimized_url: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 'missing-thumb', tenant_id: 'user-1', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/missing-thumb.png', public_url: 'https://media.example.test/uploads/user-1/missing-thumb.png', original_name: 'missing-thumb.png', mime_type: 'image/png', size_bytes: 1, sha256: '2', width: null, height: null, thumbnail_url: null, optimized_url: 'https://media.example.test/uploads/user-1/missing-thumb-display.webp', created_at: '2026-01-02T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z' },
      { id: 'ready', tenant_id: 'user-1', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/ready.png', public_url: 'https://media.example.test/uploads/user-1/ready.png', original_name: 'ready.png', mime_type: 'image/png', size_bytes: 1, sha256: '3', width: null, height: null, thumbnail_url: 'https://media.example.test/uploads/user-1/ready-thumb.webp', optimized_url: 'https://media.example.test/uploads/user-1/ready-display.webp', created_at: '2026-01-03T00:00:00.000Z', updated_at: '2026-01-03T00:00:00.000Z' },
      { id: 'foreign', tenant_id: 'user-2', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-2/foreign.png', public_url: 'https://media.example.test/uploads/user-2/foreign.png', original_name: 'foreign.png', mime_type: 'image/png', size_bytes: 1, sha256: '4', width: null, height: null, thumbnail_url: null, optimized_url: null, created_at: '2026-01-04T00:00:00.000Z', updated_at: '2026-01-04T00:00:00.000Z' },
    ],
  })
  const r2 = new FakeR2()
  const result = await requestUpload(db, r2, '/media-assets?publication_id=pub-1&needs_optimization=true&limit=12&page=1', { method: 'GET' })

  assert.equal(result.status, 200)
  assert.deepEqual(result.body.data.map((asset) => asset.id), ['missing-thumb', 'missing-display'])
  assert.equal(result.body.page.total, 2)
})

test('resolve thumbnails returns visible current publication assets without R2 reads', async () => {
  const db = new FakeD1({
    mediaAssets: [
      { id: 'ready-1', tenant_id: 'user-1', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/ready-1.png', public_url: 'https://media.example.test/uploads/user-1/ready-1.png', original_name: 'ready-1.png', mime_type: 'image/png', size_bytes: 1, sha256: '1', width: null, height: null, thumbnail_url: 'https://media.example.test/uploads/user-1/ready-1-thumb.webp', created_at: '2026-01-02T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z' },
      { id: 'pending-1', tenant_id: 'user-1', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/pending-1.png', public_url: 'https://media.example.test/uploads/user-1/pending-1.png', original_name: 'pending-1.png', mime_type: 'image/png', size_bytes: 1, sha256: '2', width: null, height: null, thumbnail_url: null, created_at: '2026-01-03T00:00:00.000Z', updated_at: '2026-01-03T00:00:00.000Z' },
      { id: 'foreign-pub', tenant_id: 'user-1', publication_id: 'pub-2', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/foreign-pub.png', public_url: 'https://media.example.test/uploads/user-1/foreign-pub.png', original_name: 'foreign-pub.png', mime_type: 'image/png', size_bytes: 1, sha256: '3', width: null, height: null, thumbnail_url: 'https://media.example.test/uploads/user-1/foreign-pub-thumb.webp', created_at: '2026-01-04T00:00:00.000Z', updated_at: '2026-01-04T00:00:00.000Z' },
      { id: 'hidden', tenant_id: 'user-1', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/hidden.png', public_url: 'https://media.example.test/uploads/user-1/hidden.png', original_name: 'hidden.png', mime_type: 'image/png', size_bytes: 1, sha256: '4', width: null, height: null, thumbnail_url: 'https://media.example.test/uploads/user-1/hidden-thumb.webp', is_hidden: 1, created_at: '2026-01-05T00:00:00.000Z', updated_at: '2026-01-05T00:00:00.000Z' },
    ],
  })
  const r2 = new FakeR2()
  const result = await requestUpload(db, r2, '/media-assets/resolve-thumbnails', {
    method: 'POST',
    body: JSON.stringify({
      publication_id: 'pub-1',
      public_urls: [
        'https://media.example.test/uploads/user-1/ready-1.png',
        'https://media.example.test/uploads/user-1/pending-1.png',
        'https://media.example.test/uploads/user-1/foreign-pub.png',
        'https://media.example.test/uploads/user-1/hidden.png',
      ],
    }),
  })

  assert.equal(result.status, 200)
  assert.deepEqual(result.body.data.thumbnails, {
    'https://media.example.test/uploads/user-1/ready-1.png': 'https://media.example.test/uploads/user-1/ready-1-thumb.webp',
  })
  assert.deepEqual(result.body.data.displays, {
    'https://media.example.test/uploads/user-1/ready-1.png': 'https://media.example.test/uploads/user-1/ready-1.png',
    'https://media.example.test/uploads/user-1/pending-1.png': 'https://media.example.test/uploads/user-1/pending-1.png',
  })
  assert.equal(result.body.data.variants['https://media.example.test/uploads/user-1/ready-1.png'].display_url, 'https://media.example.test/uploads/user-1/ready-1.png')
  assert.deepEqual(result.body.data.assets.map((asset) => asset.id).sort(), ['pending-1', 'ready-1'])
  assert.equal(r2.puts.length, 0)
})

test('resolve thumbnails divide 120 URLs sin superar 100 parametros enlazados', async () => {
  const mediaAssets = Array.from({ length: 120 }, (_, index) => {
    const number = index + 1
    const publicUrl = `https://media.example.test/uploads/user-1/batch-${number}.jpg`
    return {
      id: `batch-${number}`,
      tenant_id: 'user-1',
      publication_id: 'pub-1',
      storage_bucket: 'MEDIA',
      storage_key: `uploads/user-1/batch-${number}.jpg`,
      public_url: publicUrl,
      original_name: `batch-${number}.jpg`,
      mime_type: 'image/jpeg',
      size_bytes: 1,
      sha256: `batch-sha-${number}`,
      width: null,
      height: null,
      thumbnail_url: `https://media.example.test/uploads/user-1/batch-${number}-thumb.webp`,
      created_at: '2026-07-23T00:00:00.000Z',
      updated_at: '2026-07-23T00:00:00.000Z',
    }
  })

  const db = new FakeD1({
    mediaAssets,
    maxBoundParams: 100,
  })
  const r2 = new FakeR2()

  const result = await requestUpload(db, r2, '/media-assets/resolve-thumbnails', {
    method: 'POST',
    body: JSON.stringify({
      publication_id: 'pub-1',
      public_urls: mediaAssets.map((asset) => asset.public_url),
    }),
  })

  assert.equal(result.status, 200)
  assert.equal(result.body.data.assets.length, 120)
  assert.equal(Object.keys(result.body.data.thumbnails).length, 120)
  assert.equal(r2.puts.length, 0)
})

test('legacy asset can store display and thumbnail variants without changing public_url', async () => {
  const db = new FakeD1({
    mediaAssets: [
      { id: 'legacy-1', tenant_id: 'user-1', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/legacy-1.jpg', public_url: 'https://media.example.test/uploads/user-1/legacy-1.jpg', original_name: 'legacy-1.jpg', mime_type: 'image/jpeg', size_bytes: 2400000, sha256: 'legacy-1', width: null, height: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
  })
  const r2 = new FakeR2()
  const result = await requestUpload(db, r2, '/media-assets/legacy-1/variants', {
    method: 'POST',
    body: variantsForm('pub-1', new File(['display'], 'display.webp', { type: 'image/webp' }), new File(['thumb'], 'thumb.webp', { type: 'image/webp' })),
  })

  assert.equal(result.status, 200)
  assert.equal(result.body.data.asset.public_url, 'https://media.example.test/uploads/user-1/legacy-1.jpg')
  assert.equal(result.body.data.asset.original_url, 'https://media.example.test/uploads/user-1/legacy-1.jpg')
  assert.equal(result.body.data.asset.optimized_url, 'https://media.example.test/uploads/user-1/legacy-1-display.webp')
  assert.equal(result.body.data.asset.display_url, 'https://media.example.test/uploads/user-1/legacy-1-display.webp')
  assert.equal(result.body.data.asset.thumbnail_url, 'https://media.example.test/uploads/user-1/legacy-1-thumb.webp')
  assert.deepEqual(r2.puts.map((put) => put.key), ['uploads/user-1/legacy-1-display.webp', 'uploads/user-1/legacy-1-thumb.webp'])
})

test('legacy variant upload is idempotent when display and thumbnail already exist', async () => {
  const db = new FakeD1({
    mediaAssets: [
      { id: 'legacy-ready', tenant_id: 'user-1', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/legacy-ready.jpg', public_url: 'https://media.example.test/uploads/user-1/legacy-ready.jpg', optimized_url: 'https://media.example.test/uploads/user-1/legacy-ready-display.webp', thumbnail_url: 'https://media.example.test/uploads/user-1/legacy-ready-thumb.webp', original_name: 'legacy-ready.jpg', mime_type: 'image/jpeg', size_bytes: 2400000, sha256: 'legacy-ready', width: null, height: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
  })
  const r2 = new FakeR2()
  const result = await requestUpload(db, r2, '/media-assets/legacy-ready/variants', {
    method: 'POST',
    body: variantsForm('pub-1', new File(['display'], 'display.webp', { type: 'image/webp' }), new File(['thumb'], 'thumb.webp', { type: 'image/webp' })),
  })

  assert.equal(result.status, 200)
  assert.equal(result.body.data.asset.public_url, 'https://media.example.test/uploads/user-1/legacy-ready.jpg')
  assert.equal(result.body.data.asset.display_url, 'https://media.example.test/uploads/user-1/legacy-ready-display.webp')
  assert.equal(result.body.data.asset.thumbnail_url, 'https://media.example.test/uploads/user-1/legacy-ready-thumb.webp')
  assert.equal(r2.puts.length, 0)
})

test('listing includes known urls so hidden legacy entries do not reappear', async () => {
  const db = new FakeD1({
    mediaAssets: [
      { id: 'hidden', tenant_id: 'user-1', publication_id: 'pub-1', storage_bucket: 'EXTERNAL', storage_key: 'external/hidden', public_url: 'https://legacy.example.test/hidden.jpg', original_name: 'hidden.jpg', mime_type: 'image/jpeg', size_bytes: 0, sha256: 'legacy:hidden', width: null, height: null, is_hidden: 1, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
  })
  const r2 = new FakeR2()
  const result = await requestUpload(db, r2, '/media-assets?publication_id=pub-1&limit=12&page=1', { method: 'GET' })

  assert.equal(result.status, 200)
  assert.equal(result.body.data.length, 0)
  assert.deepEqual(result.body.meta.known_urls, ['https://legacy.example.test/hidden.jpg'])
})

test('adopting legacy URL creates media_asset without R2 put and reusing same URL does not duplicate', async () => {
  const db = new FakeD1()
  const r2 = new FakeR2()
  const body = JSON.stringify({
    publication_id: 'pub-1',
    public_url: 'https://legacy.example.test/old.jpg',
    original_name: 'old.jpg',
  })
  const first = await requestUpload(db, r2, '/media-assets/adopt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })
  const second = await requestUpload(db, r2, '/media-assets/adopt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })

  assert.equal(first.status, 201)
  assert.equal(first.body.data.reused, false)
  assert.equal(first.body.data.asset.public_url, 'https://legacy.example.test/old.jpg')
  assert.equal(first.body.data.asset.storage_bucket, 'EXTERNAL')
  assert.equal(second.status, 200)
  assert.equal(second.body.data.reused, true)
  assert.equal(db.mediaAssets.length, 1)
  assert.equal(r2.puts.length, 0)
})

test('usage by legacy URL reports project references without creating media_asset or touching R2', async () => {
  const legacyUrl = 'https://legacy.example.test/used-without-adopt.jpg'
  const db = new FakeD1({
    pages: [
      {
        id: 'p1',
        publication_id: 'pub-1',
        page_number: 4,
        image_url: legacyUrl,
        canvas_json: JSON.stringify({
          objects: [
            { type: 'image', src: legacyUrl },
          ],
        }),
        cover_json: null,
      },
    ],
    dynamicMarkers: [
      {
        id: 'marker-1',
        publication_id: 'pub-1',
        page_id: 'p1',
        media_json: JSON.stringify({
          gallery: [legacyUrl],
        }),
      },
    ],
  })
  const r2 = new FakeR2()

  const result = await requestUpload(db, r2, '/media-assets/usage-by-url', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      publication_id: 'pub-1',
      public_url: legacyUrl,
    }),
  })

  assert.equal(result.status, 200)
  assert.equal(result.body.data.asset_id, null)
  assert.equal(result.body.data.public_url, legacyUrl)
  assert.equal(result.body.data.usage_count, 3)
  assert.equal(result.body.data.can_delete_physical, false)
  assert.deepEqual(
    result.body.data.usages.map((usage) => usage.type),
    ['page_image', 'page_canvas', 'dynamic_marker_media'],
  )
  assert.equal(db.mediaAssets.length, 0)
  assert.equal(db.pages[0].image_url, legacyUrl)
  assert.equal(db.dynamicMarkers[0].media_json.includes(legacyUrl), true)
  assert.deepEqual(r2.puts, [])
  assert.deepEqual(r2.deletes, [])
})

test('adopted legacy used in a page reports usage and can be hidden without deleting origin', async () => {
  const db = new FakeD1({
    pages: [
      { id: 'p1', publication_id: 'pub-1', page_number: 4, image_url: 'https://legacy.example.test/used.jpg', canvas_json: null, cover_json: null },
    ],
  })
  const r2 = new FakeR2()
  const adopted = await requestUpload(db, r2, '/media-assets/adopt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publication_id: 'pub-1', public_url: 'https://legacy.example.test/used.jpg' }),
  })
  const assetId = adopted.body.data.asset.id
  const usage = await requestUpload(db, r2, `/media-assets/${assetId}/usage?publication_id=pub-1`, { method: 'GET' })
  const hidden = await requestUpload(db, r2, `/media-assets/${assetId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ is_hidden: true }),
  })

  assert.equal(usage.status, 200)
  assert.equal(usage.body.data.usage_count, 1)
  assert.equal(usage.body.data.can_delete_physical, false)
  assert.equal(hidden.status, 200)
  assert.equal(db.mediaAssets[0].is_hidden, 1)
  assert.equal(db.pages[0].image_url, 'https://legacy.example.test/used.jpg')
  assert.deepEqual(r2.deletes, [])
})

test('external adopted URL cannot be physically deleted but trusted R2 legacy URL can when unused', async () => {
  const db = new FakeD1()
  const r2 = new FakeR2()
  const external = await requestUpload(db, r2, '/media-assets/adopt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publication_id: 'pub-1', public_url: 'https://legacy.example.test/free.jpg' }),
  })
  const trusted = await requestUpload(db, r2, '/media-assets/adopt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publication_id: 'pub-1', public_url: 'https://media.example.test/uploads/user-1/trusted.jpg' }),
  })
  const externalDelete = await requestUpload(db, r2, `/media-assets/${external.body.data.asset.id}?publication_id=pub-1`, { method: 'DELETE' })
  const trustedDelete = await requestUpload(db, r2, `/media-assets/${trusted.body.data.asset.id}?publication_id=pub-1`, { method: 'DELETE' })

  assert.equal(externalDelete.status, 409)
  assert.equal(externalDelete.body.code, 'MEDIA_ASSET_UNSAFE_STORAGE_KEY')
  assert.equal(trustedDelete.status, 200)
  assert.deepEqual(r2.deletes, ['uploads/user-1/trusted.jpg'])
})

test('asset without usages returns usage_count 0', async () => {
  const db = new FakeD1({
    mediaAssets: [
      { id: 'free', tenant_id: 'user-1', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/free.png', public_url: 'https://media.example.test/uploads/user-1/free.png', original_name: 'free.png', mime_type: 'image/png', size_bytes: 1, sha256: '1', width: null, height: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
  })
  const r2 = new FakeR2()
  const usage = await requestUpload(db, r2, '/media-assets/free/usage?publication_id=pub-1', { method: 'GET' })

  assert.equal(usage.status, 200)
  assert.equal(usage.body.data.usage_count, 0)
  assert.equal(usage.body.data.can_delete_physical, true)
})

test('asset used as page image_url is reported', async () => {
  const db = new FakeD1({
    mediaAssets: [
      { id: 'a1', tenant_id: 'user-1', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/a1.png', public_url: 'https://media.example.test/uploads/user-1/a1.png', original_name: 'used.png', mime_type: 'image/png', size_bytes: 1, sha256: '1', width: null, height: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
    pages: [
      { id: 'p1', publication_id: 'pub-1', page_number: 2, image_url: '/api/upload/uploads/user-1/a1.png', canvas_json: null, cover_json: null },
    ],
  })
  const r2 = new FakeR2()
  const usage = await requestUpload(db, r2, '/media-assets/a1/usage?publication_id=pub-1', { method: 'GET' })

  assert.equal(usage.status, 200)
  assert.equal(usage.body.data.usage_count, 1)
  assert.equal(usage.body.data.usages[0].type, 'page_image')
  assert.equal(usage.body.data.usages[0].label, 'Página 2')
})

test('asset inside canvas_json is reported and invalid canvas_json does not 500', async () => {
  const db = new FakeD1({
    mediaAssets: [
      { id: 'a1', tenant_id: 'user-1', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/a1.png', public_url: 'https://media.example.test/uploads/user-1/a1.png', original_name: 'used.png', mime_type: 'image/png', size_bytes: 1, sha256: '1', width: null, height: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
    pages: [
      { id: 'p1', publication_id: 'pub-1', page_number: 1, image_url: null, canvas_json: '{invalid json', cover_json: null },
      { id: 'p2', publication_id: 'pub-1', page_number: 2, image_url: null, canvas_json: JSON.stringify({ objects: [{ src: 'https://media.example.test/uploads/user-1/a1.png' }] }), cover_json: null },
    ],
  })
  const r2 = new FakeR2()
  const usage = await requestUpload(db, r2, '/media-assets/a1/usage?publication_id=pub-1', { method: 'GET' })

  assert.equal(usage.status, 200)
  assert.equal(usage.body.data.usage_count, 1)
  assert.equal(usage.body.data.usages[0].type, 'page_canvas')
})

test('asset inside dynamic marker media_json is reported', async () => {
  const db = new FakeD1({
    mediaAssets: [
      { id: 'a1', tenant_id: 'user-1', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/a1.png', public_url: 'https://media.example.test/uploads/user-1/a1.png', original_name: 'marker.png', mime_type: 'image/png', size_bytes: 1, sha256: '1', width: null, height: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
    pages: [{ id: 'p1', publication_id: 'pub-1', page_number: 3, image_url: null, canvas_json: null, cover_json: null }],
    dynamicMarkers: [{ id: 'm1', publication_id: 'pub-1', page_id: 'p1', media_json: JSON.stringify({ image: 'https://media.example.test/uploads/user-1/a1.png' }) }],
  })
  const r2 = new FakeR2()
  const usage = await requestUpload(db, r2, '/media-assets/a1/usage?publication_id=pub-1', { method: 'GET' })

  assert.equal(usage.status, 200)
  assert.equal(usage.body.data.usage_count, 1)
  assert.equal(usage.body.data.usages[0].type, 'dynamic_marker_media')
  assert.equal(usage.body.data.usages[0].label, 'Ficha dinámica en página 3')
})

test('asset from another tenant returns 403 and missing asset returns 404', async () => {
  const db = new FakeD1({
    mediaAssets: [
      { id: 'foreign', tenant_id: 'user-2', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-2/foreign.png', public_url: 'https://media.example.test/uploads/user-2/foreign.png', original_name: 'foreign.png', mime_type: 'image/png', size_bytes: 1, sha256: '1', width: null, height: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
  })
  const r2 = new FakeR2()
  const foreign = await requestUpload(db, r2, '/media-assets/foreign/usage?publication_id=pub-1', { method: 'GET' })
  const missing = await requestUpload(db, r2, '/media-assets/missing/usage?publication_id=pub-1', { method: 'GET' })

  assert.equal(foreign.status, 403)
  assert.equal(missing.status, 404)
})

test('asset in use can be hidden without deleting R2 object', async () => {
  const db = new FakeD1({
    mediaAssets: [
      { id: 'a1', tenant_id: 'user-1', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/a1.png', public_url: 'https://media.example.test/uploads/user-1/a1.png', original_name: 'used.png', mime_type: 'image/png', size_bytes: 1, sha256: '1', width: null, height: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
    pages: [
      { id: 'p1', publication_id: 'pub-1', page_number: 1, image_url: '/api/upload/uploads/user-1/a1.png', canvas_json: null, cover_json: null },
    ],
  })
  const r2 = new FakeR2()
  const usage = await requestUpload(db, r2, '/media-assets/a1/usage?publication_id=pub-1', { method: 'GET' })
  const hidden = await requestUpload(db, r2, '/media-assets/a1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ is_hidden: true }),
  })

  assert.equal(usage.body.data.usage_count, 1)
  assert.equal(hidden.status, 200)
  assert.equal(db.mediaAssets[0].is_hidden, 1)
  assert.equal(r2.deletes.length, 0)
})

test('physical delete is blocked with usages and allowed with zero usages', async () => {
  const db = new FakeD1({
    mediaAssets: [
      { id: 'used', tenant_id: 'user-1', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/used.png', public_url: 'https://media.example.test/uploads/user-1/used.png', thumbnail_storage_key: 'uploads/user-1/used-thumb.webp', original_name: 'used.png', mime_type: 'image/png', size_bytes: 1, sha256: '1', width: null, height: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 'free', tenant_id: 'user-1', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/free.png', public_url: 'https://media.example.test/uploads/user-1/free.png', thumbnail_storage_key: 'uploads/user-1/free-thumb.webp', original_name: 'free.png', mime_type: 'image/png', size_bytes: 1, sha256: '2', width: null, height: null, created_at: '2026-01-02T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z' },
    ],
    pages: [
      { id: 'p1', publication_id: 'pub-1', page_number: 1, image_url: '/api/upload/uploads/user-1/used.png', canvas_json: null, cover_json: null },
    ],
  })
  const r2 = new FakeR2()
  const blocked = await requestUpload(db, r2, '/media-assets/used?publication_id=pub-1', { method: 'DELETE' })
  const deleted = await requestUpload(db, r2, '/media-assets/free?publication_id=pub-1', { method: 'DELETE' })

  assert.equal(blocked.status, 409)
  assert.equal(blocked.body.code, 'ASSET_IN_USE')
  assert.equal(deleted.status, 200)
  assert.deepEqual(r2.deletes, ['uploads/user-1/free.png', 'uploads/user-1/free-thumb.webp'])
  assert.ok(db.mediaAssets.find((asset) => asset.id === 'free').deleted_at)
})

test('delete revalidates usage before deleting physical object', async () => {
  const db = new FakeD1({
    addUsageOnSecondUsageCheck: true,
    mediaAssets: [
      { id: 'free', tenant_id: 'user-1', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/free.png', public_url: 'https://media.example.test/uploads/user-1/free.png', original_name: 'free.png', mime_type: 'image/png', size_bytes: 1, sha256: '1', width: null, height: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
  })
  const r2 = new FakeR2()
  const result = await requestUpload(db, r2, '/media-assets/free?publication_id=pub-1', { method: 'DELETE' })

  assert.equal(result.status, 409)
  assert.equal(result.body.code, 'ASSET_IN_USE')
  assert.deepEqual(r2.deletes, [])
  assert.equal(db.mediaAssets[0].deleted_at, undefined)
})

test('legacy asset without trusted storage_key is not physically deleted', async () => {
  const db = new FakeD1({
    mediaAssets: [
      { id: 'legacy', tenant_id: 'user-1', publication_id: 'pub-1', storage_bucket: 'MEDIA', storage_key: null, public_url: 'https://media.example.test/legacy.png', original_name: 'legacy.png', mime_type: 'image/png', size_bytes: 1, sha256: '1', width: null, height: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
  })
  const r2 = new FakeR2()
  const result = await requestUpload(db, r2, '/media-assets/legacy?publication_id=pub-1', { method: 'DELETE' })

  assert.equal(result.status, 409)
  assert.equal(result.body.code, 'MEDIA_ASSET_UNSAFE_STORAGE_KEY')
  assert.deepEqual(r2.deletes, [])
  assert.equal(db.mediaAssets[0].deleted_at, undefined)
})

test('media folders can be created, listed, renamed and deleted without touching R2', async () => {
  const db = new FakeD1({
    mediaAssets: [
      { id: 'in-folder', tenant_id: 'user-1', publication_id: 'pub-1', folder_id: 'folder-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/in-folder.png', public_url: 'https://media.example.test/uploads/user-1/in-folder.png', original_name: 'in-folder.png', mime_type: 'image/png', size_bytes: 1, sha256: 'in-folder', width: null, height: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
    mediaFolders: [
      { id: 'folder-1', tenant_id: 'user-1', publication_id: 'pub-1', name: 'Campana', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
  })
  const r2 = new FakeR2()

  const created = await requestUpload(db, r2, '/media-folders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publication_id: 'pub-1', name: 'Productos' }),
  })
  const listed = await requestUpload(db, r2, '/media-folders?publication_id=pub-1', { method: 'GET' })
  const renamed = await requestUpload(db, r2, `/media-folders/${created.body.data.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Productos 2026' }),
  })
  const deleted = await requestUpload(db, r2, '/media-folders/folder-1', { method: 'DELETE' })

  assert.equal(created.status, 201)
  assert.equal(renamed.body.data.name, 'Productos 2026')
  assert.deepEqual(listed.body.data.map((folder) => [folder.name, folder.asset_count]), [['Campana', 1], ['Productos', 0]])
  assert.equal(deleted.status, 200)
  assert.equal(deleted.body.data.moved_count, 1)
  assert.equal(db.mediaAssets.find((asset) => asset.id === 'in-folder').folder_id, null)
  assert.equal(db.mediaFolders.some((folder) => folder.id === 'folder-1'), false)
  assert.deepEqual(r2.puts, [])
  assert.deepEqual(r2.deletes, [])
})

test('media folder names reject empty, long and duplicate case-insensitive values', async () => {
  const db = new FakeD1({
    mediaFolders: [
      { id: 'folder-1', tenant_id: 'user-1', publication_id: 'pub-1', name: 'Productos', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
  })
  const r2 = new FakeR2()
  const empty = await requestUpload(db, r2, '/media-folders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publication_id: 'pub-1', name: '   ' }),
  })
  const long = await requestUpload(db, r2, '/media-folders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publication_id: 'pub-1', name: 'x'.repeat(81) }),
  })
  const duplicate = await requestUpload(db, r2, '/media-folders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publication_id: 'pub-1', name: 'productos' }),
  })

  assert.equal(empty.status, 400)
  assert.equal(long.status, 400)
  assert.equal(duplicate.status, 409)
  assert.equal(db.mediaFolders.length, 1)
})

test('media folders are isolated by tenant and publication', async () => {
  const db = new FakeD1({
    users: [{ id: 'user-1', plan_id: 'free' }, { id: 'user-2', plan_id: 'free' }],
    mediaFolders: [
      { id: 'pub-1-folder', tenant_id: 'user-1', publication_id: 'pub-1', name: 'Pub 1', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 'pub-2-folder', tenant_id: 'user-1', publication_id: 'pub-2', name: 'Pub 2', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 'foreign-folder', tenant_id: 'user-2', publication_id: 'other-pub', name: 'Foreign', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
  })
  const r2 = new FakeR2()
  const own = await requestUpload(db, r2, '/media-folders?publication_id=pub-1', { method: 'GET' })
  const foreign = await requestUpload(db, r2, '/media-folders?publication_id=other-pub', { method: 'GET' }, 'user-1')
  const otherTenant = await requestUpload(db, r2, '/media-folders?publication_id=other-pub', { method: 'GET' }, 'user-2')

  assert.deepEqual(own.body.data.map((folder) => folder.id), ['pub-1-folder'])
  assert.equal(foreign.status, 404)
  assert.deepEqual(otherTenant.body.data.map((folder) => folder.id), ['foreign-folder'])
})

test('media asset listing supports all, unfiled and folder filters while known urls remain global', async () => {
  const db = new FakeD1({
    mediaFolders: [
      { id: 'folder-1', tenant_id: 'user-1', publication_id: 'pub-1', name: 'Folder', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
    mediaAssets: [
      { id: 'general', tenant_id: 'user-1', publication_id: 'pub-1', folder_id: null, storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/general.png', public_url: 'https://media.example.test/uploads/user-1/general.png', original_name: 'general.png', mime_type: 'image/png', size_bytes: 1, sha256: 'general', width: null, height: null, created_at: '2026-01-03T00:00:00.000Z', updated_at: '2026-01-03T00:00:00.000Z' },
      { id: 'foldered', tenant_id: 'user-1', publication_id: 'pub-1', folder_id: 'folder-1', storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/foldered.png', public_url: 'https://media.example.test/uploads/user-1/foldered.png', original_name: 'foldered.png', mime_type: 'image/png', size_bytes: 1, sha256: 'foldered', width: null, height: null, created_at: '2026-01-02T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z' },
      { id: 'hidden-known', tenant_id: 'user-1', publication_id: 'pub-1', folder_id: 'folder-1', storage_bucket: 'EXTERNAL', storage_key: 'external/hidden', public_url: 'https://legacy.example.test/hidden.jpg', original_name: 'hidden.jpg', mime_type: 'image/jpeg', size_bytes: 0, sha256: 'hidden', width: null, height: null, is_hidden: 1, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
  })
  const r2 = new FakeR2()
  const all = await requestUpload(db, r2, '/media-assets?publication_id=pub-1&limit=12&page=1', { method: 'GET' })
  const unfiled = await requestUpload(db, r2, '/media-assets?publication_id=pub-1&folder_id=unfiled&limit=12&page=1', { method: 'GET' })
  const foldered = await requestUpload(db, r2, '/media-assets?publication_id=pub-1&folder_id=folder-1&limit=12&page=1', { method: 'GET' })

  assert.deepEqual(all.body.data.map((asset) => asset.id), ['general', 'foldered'])
  assert.deepEqual(unfiled.body.data.map((asset) => asset.id), ['general'])
  assert.deepEqual(foldered.body.data.map((asset) => asset.id), ['foldered'])
  assert.deepEqual(foldered.body.meta.known_urls.sort(), [
    'https://legacy.example.test/hidden.jpg',
    'https://media.example.test/uploads/user-1/foldered.png',
    'https://media.example.test/uploads/user-1/general.png',
  ].sort())
})

test('moving one or many media assets validates ownership, visibility and does not touch R2', async () => {
  const db = new FakeD1({
    mediaFolders: [
      { id: 'folder-1', tenant_id: 'user-1', publication_id: 'pub-1', name: 'Folder', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
    mediaAssets: [
      { id: 'a1', tenant_id: 'user-1', publication_id: 'pub-1', folder_id: null, storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/a1.png', public_url: 'https://media.example.test/uploads/user-1/a1.png', original_name: 'a1.png', mime_type: 'image/png', size_bytes: 1, sha256: 'a1', width: null, height: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 'a2', tenant_id: 'user-1', publication_id: 'pub-1', folder_id: null, storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/a2.png', public_url: 'https://media.example.test/uploads/user-1/a2.png', original_name: 'a2.png', mime_type: 'image/png', size_bytes: 1, sha256: 'a2', width: null, height: null, created_at: '2026-01-02T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z' },
      { id: 'hidden', tenant_id: 'user-1', publication_id: 'pub-1', folder_id: null, storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/hidden.png', public_url: 'https://media.example.test/uploads/user-1/hidden.png', original_name: 'hidden.png', mime_type: 'image/png', size_bytes: 1, sha256: 'hidden', width: null, height: null, is_hidden: 1, created_at: '2026-01-03T00:00:00.000Z', updated_at: '2026-01-03T00:00:00.000Z' },
      { id: 'deleted', tenant_id: 'user-1', publication_id: 'pub-1', folder_id: null, storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/deleted.png', public_url: 'https://media.example.test/uploads/user-1/deleted.png', original_name: 'deleted.png', mime_type: 'image/png', size_bytes: 1, sha256: 'deleted', width: null, height: null, deleted_at: '2026-01-04T00:00:00.000Z', created_at: '2026-01-04T00:00:00.000Z', updated_at: '2026-01-04T00:00:00.000Z' },
      { id: 'foreign', tenant_id: 'user-1', publication_id: 'pub-2', folder_id: null, storage_bucket: 'MEDIA', storage_key: 'uploads/user-1/foreign.png', public_url: 'https://media.example.test/uploads/user-1/foreign.png', original_name: 'foreign.png', mime_type: 'image/png', size_bytes: 1, sha256: 'foreign', width: null, height: null, created_at: '2026-01-05T00:00:00.000Z', updated_at: '2026-01-05T00:00:00.000Z' },
    ],
  })
  const r2 = new FakeR2()
  const moved = await requestUpload(db, r2, '/media-assets/move', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publication_id: 'pub-1', asset_ids: ['a1', 'a2', 'a2'], folder_id: 'folder-1' }),
  })
  const hidden = await requestUpload(db, r2, '/media-assets/move', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publication_id: 'pub-1', asset_ids: ['hidden'], folder_id: null }),
  })
  const deleted = await requestUpload(db, r2, '/media-assets/move', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publication_id: 'pub-1', asset_ids: ['deleted'], folder_id: null }),
  })
  const foreign = await requestUpload(db, r2, '/media-assets/move', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publication_id: 'pub-1', asset_ids: ['foreign'], folder_id: null }),
  })
  const tooMany = await requestUpload(db, r2, '/media-assets/move', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publication_id: 'pub-1', asset_ids: Array.from({ length: 101 }, (_, index) => `asset-${index}`), folder_id: null }),
  })

  assert.equal(moved.status, 200)
  assert.equal(moved.body.data.moved_count, 2)
  assert.equal(db.mediaAssets.find((asset) => asset.id === 'a1').folder_id, 'folder-1')
  assert.equal(db.mediaAssets.find((asset) => asset.id === 'a2').folder_id, 'folder-1')
  assert.equal(hidden.status, 404)
  assert.equal(deleted.status, 404)
  assert.equal(foreign.status, 404)
  assert.equal(tooMany.status, 400)
  assert.deepEqual(r2.puts, [])
  assert.deepEqual(r2.deletes, [])
})

test('upload folder_id controls new and reused assets without duplicate records or extra R2 puts', async () => {
  const db = new FakeD1({
    mediaFolders: [
      { id: 'folder-1', tenant_id: 'user-1', publication_id: 'pub-1', name: 'Folder 1', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 'folder-2', tenant_id: 'user-1', publication_id: 'pub-1', name: 'Folder 2', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
  })
  const r2 = new FakeR2()
  const toFolder = form('pub-1', pngFile('hero.png', 'same-bytes'))
  toFolder.append('folder_id', 'folder-1')
  const first = await requestUpload(db, r2, '/media-assets', { method: 'POST', body: toFolder })

  const reusedToOtherFolder = form('pub-1', pngFile('hero-renamed.png', 'same-bytes'))
  reusedToOtherFolder.append('folder_id', 'folder-2')
  const second = await requestUpload(db, r2, '/media-assets', { method: 'POST', body: reusedToOtherFolder })
  const folderAfterSecond = db.mediaAssets[0].folder_id

  const reusedToUnfiled = form('pub-1', pngFile('hero-again.png', 'same-bytes'))
  reusedToUnfiled.append('folder_id', 'unfiled')
  const third = await requestUpload(db, r2, '/media-assets', { method: 'POST', body: reusedToUnfiled })
  const folderAfterThird = db.mediaAssets[0].folder_id

  db.mediaAssets[0].folder_id = 'folder-1'
  const omitted = await requestUpload(db, r2, '/media-assets', {
    method: 'POST',
    body: form('pub-1', pngFile('hero-omitted.png', 'same-bytes')),
  })

  assert.equal(first.status, 201)
  assert.equal(first.body.data.asset.folder_id, 'folder-1')
  assert.equal(second.status, 200)
  assert.equal(second.body.data.reused, true)
  assert.equal(second.body.data.asset.folder_id, 'folder-2')
  assert.equal(folderAfterSecond, 'folder-2')
  assert.equal(third.body.data.asset.folder_id, null)
  assert.equal(folderAfterThird, null)
  assert.equal(omitted.body.data.asset.folder_id, 'folder-1')
  assert.equal(db.mediaAssets.length, 1)
  assert.equal(r2.puts.length, 1)
})
