import { Hono } from 'hono'
import { jwtMiddleware } from '../middleware/jwt'
import { getUserPlan, checkStorageLimit } from '../lib/plans'
import { sanitizeSvg } from '../lib/svg'
import type { Env } from '../index'
import type { AuthVariables } from '../middleware/jwt'

type Variables = AuthVariables

const upload = new Hono<{ Bindings: Env; Variables: Variables }>()

function isPublicUploadKey(key: string) {
  return /^uploads\/[^/]+\/[^/]+$/.test(key)
}

// PROTECTED: Public read-only asset route required by Fabric thumbnail rendering.
// POST, DELETE and administration must remain JWT-protected below.
async function servePublicUpload(c: any) {
  const key = `uploads/${c.req.param('key')}`
  if (!key || !isPublicUploadKey(key)) {
    return c.json({ success: false, error: 'Archivo no encontrado' }, 404)
  }

  const obj = await c.env.MEDIA.get(key)
  if (!obj) {
    return c.json({ success: false, error: 'Archivo no encontrado' }, 404)
  }

  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)

  if (c.req.method === 'HEAD') {
    return new Response(null, { status: 200, headers })
  }

  return new Response(obj.body, { status: 200, headers })
}

upload.get('/uploads/:key{.+}', servePublicUpload)
upload.on('HEAD', '/uploads/:key{.+}', servePublicUpload)

// PROTECTED: All non-public upload routes remain authenticated.
upload.use('*', jwtMiddleware)

// Tipos MIME permitidos y su extensión de archivo asociada.
// Imágenes, audio, video y documentos descargables (cupones, catálogos PDF, etc.).
const EXT_BY_TYPE: Record<string, string> = {
  // Imágenes
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/gif': 'gif',
  // Audio
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  // Video
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogv',
  // Documentos descargables
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
}
const IMAGE_MAX_BYTES = 10 * 1024 * 1024  // 10 MB para imágenes
const MEDIA_MAX_BYTES = 50 * 1024 * 1024  // 50 MB para audio/video/documentos
const MEDIA_ASSET_LIMIT_MAX = 50
const MEDIA_ASSET_LIMIT_DEFAULT = 24

const MEDIA_IMAGE_EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/gif': 'gif',
}

type MediaAssetRow = {
  id: string
  tenant_id: string
  publication_id: string
  storage_bucket: string
  storage_key: string | null
  public_url: string
  original_name: string
  mime_type: string
  size_bytes: number
  sha256: string
  width: number | null
  height: number | null
  original_mime_type?: string | null
  original_size_bytes?: number | null
  original_width?: number | null
  original_height?: number | null
  thumbnail_storage_key?: string | null
  thumbnail_url?: string | null
  thumbnail_mime_type?: string | null
  thumbnail_size_bytes?: number | null
  thumbnail_width?: number | null
  thumbnail_height?: number | null
  optimization_status?: string | null
  optimization_version?: string | null
  optimized_at?: string | null
  is_hidden?: number | null
  deleted_at?: string | null
  created_at: string
  updated_at: string
}

function mediaAssetResponse(row: MediaAssetRow) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    publication_id: row.publication_id,
    storage_bucket: row.storage_bucket,
    storage_key: row.storage_key,
    public_url: row.public_url,
    original_name: row.original_name,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    sha256: row.sha256,
    width: row.width,
    height: row.height,
    original_mime_type: row.original_mime_type ?? null,
    original_size_bytes: row.original_size_bytes ?? null,
    original_width: row.original_width ?? null,
    original_height: row.original_height ?? null,
    thumbnail_storage_key: row.thumbnail_storage_key ?? null,
    thumbnail_url: row.thumbnail_url ?? null,
    thumbnail_mime_type: row.thumbnail_mime_type ?? null,
    thumbnail_size_bytes: row.thumbnail_size_bytes ?? null,
    thumbnail_width: row.thumbnail_width ?? null,
    thumbnail_height: row.thumbnail_height ?? null,
    optimization_status: row.optimization_status ?? null,
    optimization_version: row.optimization_version ?? null,
    optimized_at: row.optimized_at ?? null,
    is_hidden: row.is_hidden ?? 0,
    deleted_at: row.deleted_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

async function sha256Hex(data: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map((item) => item.toString(16).padStart(2, '0')).join('')
}

function boundedMediaAssetLimit(value: string | null) {
  const parsed = value ? Number.parseInt(value, 10) : MEDIA_ASSET_LIMIT_DEFAULT
  if (!Number.isFinite(parsed)) return MEDIA_ASSET_LIMIT_DEFAULT
  return Math.max(1, Math.min(MEDIA_ASSET_LIMIT_MAX, parsed))
}

function parseMediaAssetCursor(value: string | null) {
  if (!value) return null
  try {
    const decoded = atob(value)
    const parsed = JSON.parse(decoded)
    if (!parsed?.created_at || !parsed?.id) return null
    return { created_at: String(parsed.created_at), id: String(parsed.id) }
  } catch {
    return null
  }
}

function encodeMediaAssetCursor(row: MediaAssetRow) {
  return btoa(JSON.stringify({ created_at: row.created_at, id: row.id }))
}

function normalizeStoredAssetUrl(value: string) {
  return value.trim()
}

function legacyAssetSha(publicUrl: string) {
  return `legacy:${publicUrl}`
}

function mimeFromAssetUrl(publicUrl: string) {
  const pathname = (() => {
    try { return new URL(publicUrl).pathname } catch { return publicUrl }
  })().toLowerCase()
  if (pathname.endsWith('.svg')) return 'image/svg+xml'
  if (pathname.endsWith('.gif')) return 'image/gif'
  if (pathname.endsWith('.webp')) return 'image/webp'
  if (pathname.endsWith('.png')) return 'image/png'
  return 'image/jpeg'
}

function optionalInt(value: FormDataEntryValue | null) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function optionalNumber(value: FormDataEntryValue | null) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function optionalString(value: FormDataEntryValue | null) {
  const raw = String(value ?? '').trim()
  return raw || null
}

function assetNameFromUrl(publicUrl: string, fallback = 'Imagen anterior') {
  try {
    const pathname = new URL(publicUrl).pathname
    const name = pathname.split('/').filter(Boolean).pop()
    return name ? decodeURIComponent(name) : fallback
  } catch {
    const name = publicUrl.split('/').filter(Boolean).pop()?.split('?')[0]
    return name ? decodeURIComponent(name) : fallback
  }
}

function storageKeyFromKnownPublicUrl(c: any, publicUrl: string) {
  const normalized = publicUrl.trim()
  const uploadMatch = normalized.match(/(?:^|\/)api\/upload\/(uploads\/[^?#]+)$/)
  if (uploadMatch?.[1] && isPublicUploadKey(uploadMatch[1])) return uploadMatch[1]
  const base = String(c.env.R2_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '')
  if (base && normalized.startsWith(`${base}/`)) {
    const key = normalized.slice(base.length + 1).split(/[?#]/)[0]
    if (isPublicUploadKey(key)) return key
  }
  return null
}

async function getOwnedPublication(c: any, publicationId: string, userId: string) {
  return c.env.DB.prepare(
    'SELECT id FROM publications WHERE id = ? AND user_id = ?',
  ).bind(publicationId, userId).first<{ id: string }>()
}

async function getOwnedMediaAsset(c: any, userId: string, assetId: string, publicationId?: string) {
  const conditions = ['id = ?']
  const params: unknown[] = [assetId]
  if (publicationId) {
    conditions.push('publication_id = ?')
    params.push(publicationId)
  }
  const asset = await c.env.DB.prepare(`SELECT * FROM media_assets WHERE ${conditions.join(' AND ')} LIMIT 1`)
    .bind(...params)
    .first<MediaAssetRow>()
  if (!asset) return { status: 'missing' as const, asset: null }
  if (asset.tenant_id !== userId) return { status: 'forbidden' as const, asset }
  return { status: 'owned' as const, asset }
}

function assetReferenceCandidates(asset: MediaAssetRow) {
  const storageKey = typeof asset.storage_key === 'string' ? asset.storage_key.trim() : ''
  const publicUrl = typeof asset.public_url === 'string' ? asset.public_url.trim() : ''
  const candidates = [
    asset.id,
    publicUrl,
    storageKey,
    storageKey ? `/api/upload/${storageKey}` : '',
  ]
  if (publicUrl && storageKey && publicUrl.includes(storageKey)) {
    candidates.push(publicUrl.slice(publicUrl.indexOf(storageKey)))
  }
  return Array.from(new Set(candidates.filter((value) => typeof value === 'string' && value.trim())))
}

async function findMediaAssetByPublicUrl(c: any, userId: string, publicationId: string, publicUrl: string) {
  return c.env.DB.prepare(
    `SELECT *
     FROM media_assets
     WHERE tenant_id = ?
       AND publication_id = ?
       AND public_url = ?
     LIMIT 1`,
  ).bind(userId, publicationId, publicUrl).first<MediaAssetRow>()
}

function textContainsAnyReference(value: unknown, candidates: string[]) {
  if (typeof value !== 'string' || !value || candidates.length === 0) return false
  return candidates.some((candidate) => value.includes(candidate))
}

async function countMediaAssetUsage(c: any, asset: MediaAssetRow) {
  const candidates = assetReferenceCandidates(asset)
  const pageRows = await c.env.DB.prepare(
    `SELECT id, page_number, image_url, canvas_json, cover_json
     FROM pages
     WHERE publication_id = ?`,
  ).bind(asset.publication_id).all<{ id: string; page_number: number | null; image_url: string | null; canvas_json: string | null; cover_json: string | null }>()
  const pub = await c.env.DB.prepare(
    `SELECT *
     FROM publications
     WHERE id = ?`,
  ).bind(asset.publication_id).first<any>()
  let markers: { results?: Array<{ id: string; page_id: string | null; media_json: string | null }> } = { results: [] }
  try {
    markers = await c.env.DB.prepare(
      `SELECT id, page_id, media_json
       FROM dynamic_markers
       WHERE publication_id = ?`,
    ).bind(asset.publication_id).all<{ id: string; page_id: string | null; media_json: string | null }>()
  } catch (error) {
    console.error('[media-assets.usage] dynamic marker scan skipped', {
      asset_id: asset.id,
      publication_id: asset.publication_id,
      error: errorMessage(error),
    })
  }

  const usages: Array<{ type: string; page_id?: string; page_number?: number | null; marker_id?: string; field: string; label: string }> = []
  const pageNumberById = new Map((pageRows.results ?? []).map((page) => [page.id, page.page_number ?? null]))
  for (const page of pageRows.results ?? []) {
    if (textContainsAnyReference(page.image_url, candidates)) {
      usages.push({ type: 'page_image', page_id: page.id, page_number: page.page_number, field: 'image_url', label: page.page_number ? `Página ${page.page_number}` : 'Página' })
    }
    if (textContainsAnyReference(page.canvas_json, candidates)) {
      usages.push({ type: 'page_canvas', page_id: page.id, page_number: page.page_number, field: 'canvas_json', label: page.page_number ? `Página ${page.page_number}` : 'Página' })
    }
    if (textContainsAnyReference(page.cover_json, candidates)) {
      usages.push({ type: 'page_cover', page_id: page.id, page_number: page.page_number, field: 'cover_json', label: page.page_number ? `Página ${page.page_number}` : 'Página' })
    }
  }
  if (pub) {
    for (const field of ['cover_image_url', 'social_image_url', 'social_image_source_url'] as const) {
      const value = pub[field]
      if (textContainsAnyReference(value, candidates)) {
        usages.push({ type: 'publication_image', field, label: field === 'cover_image_url' ? 'Portada de publicación' : 'Imagen social' })
      }
    }
  }
  for (const marker of markers.results ?? []) {
    if (textContainsAnyReference(marker.media_json, candidates)) {
      const pageNumber = marker.page_id ? pageNumberById.get(marker.page_id) ?? null : null
      usages.push({ type: 'dynamic_marker_media', page_id: marker.page_id ?? undefined, page_number: pageNumber, marker_id: marker.id, field: 'media_json', label: pageNumber ? `Ficha dinámica en página ${pageNumber}` : 'Ficha dinámica' })
    }
  }
  return {
    asset_id: asset.id,
    usage_count: usages.length,
    can_delete_physical: usages.length === 0 && asset.storage_bucket === 'MEDIA' && !!asset.storage_key && isPublicUploadKey(asset.storage_key),
    usages,
  }
}

async function storeMediaAsset(c: any, userId: string, publicationId: string, file: File, width: number | null, height: number | null, thumbnail: File | null, metadata: Record<string, any>) {
  const ext = MEDIA_IMAGE_EXT_BY_TYPE[file.type]
  if (!ext) {
    throw new Response(JSON.stringify({ success: false, error: 'Tipo de imagen no permitido. Se aceptan JPEG, PNG, WebP, GIF y SVG seguro.' }), {
      status: 415,
      headers: { 'content-type': 'application/json' },
    })
  }
  if (file.size > IMAGE_MAX_BYTES) {
    const mb = Math.round(IMAGE_MAX_BYTES / 1024 / 1024)
    throw new Response(JSON.stringify({ success: false, error: `El archivo supera el tamaño máximo de ${mb} MB` }), {
      status: 413,
      headers: { 'content-type': 'application/json' },
    })
  }

  let body: ArrayBuffer
  let sizeBytes = file.size
  if (file.type === 'image/svg+xml') {
    const sanitized = await sanitizeSvg(await file.text())
    if (!sanitized.ok) {
      throw new Response(JSON.stringify({ success: false, error: sanitized.error }), {
        status: 415,
        headers: { 'content-type': 'application/json' },
      })
    }
    body = new TextEncoder().encode(sanitized.svg).buffer
    sizeBytes = body.byteLength
  } else {
    body = await file.arrayBuffer()
  }
  const sha256 = await sha256Hex(body)
  let thumbnailBody: ArrayBuffer | null = null
  let thumbnailKey: string | null = null
  let thumbnailUrl: string | null = null
  if (thumbnail) {
    const thumbnailExt = MEDIA_IMAGE_EXT_BY_TYPE[thumbnail.type]
    if (!thumbnailExt) {
      throw new Response(JSON.stringify({ success: false, error: 'Tipo de miniatura no permitido.' }), {
        status: 415,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (thumbnail.size > IMAGE_MAX_BYTES) {
      throw new Response(JSON.stringify({ success: false, error: 'La miniatura supera el tamaño máximo permitido.' }), {
        status: 413,
        headers: { 'content-type': 'application/json' },
      })
    }
    thumbnailBody = await thumbnail.arrayBuffer()
  }

  const existing = await c.env.DB.prepare(
    `SELECT *
     FROM media_assets
     WHERE tenant_id = ?
       AND publication_id = ?
       AND sha256 = ?
       AND storage_bucket = ?
     LIMIT 1`,
  ).bind(userId, publicationId, sha256, 'MEDIA').first<MediaAssetRow>()

  if (existing) {
    if (thumbnail && thumbnailBody && !existing.thumbnail_url) {
      const thumbExt = MEDIA_IMAGE_EXT_BY_TYPE[thumbnail.type]!
      thumbnailKey = `uploads/${userId}/${existing.id}-thumb.${thumbExt}`
      thumbnailUrl = `${c.env.R2_PUBLIC_BASE_URL}/${thumbnailKey}`
      await c.env.MEDIA.put(thumbnailKey, thumbnailBody, {
        httpMetadata: { contentType: thumbnail.type },
      })
      await c.env.DB.prepare(
        `UPDATE media_assets
         SET thumbnail_storage_key = ?, thumbnail_url = ?, thumbnail_mime_type = ?, thumbnail_size_bytes = ?,
             thumbnail_width = ?, thumbnail_height = ?, optimization_status = COALESCE(optimization_status, ?),
             optimization_version = COALESCE(optimization_version, ?), optimized_at = COALESCE(optimized_at, ?),
             updated_at = ?
         WHERE id = ? AND tenant_id = ? AND publication_id = ?`,
      ).bind(
        thumbnailKey,
        thumbnailUrl,
        thumbnail.type,
        thumbnail.size,
        metadata.thumbnail_width ?? null,
        metadata.thumbnail_height ?? null,
        metadata.optimization_status ?? 'thumbnail_only',
        metadata.optimization_version ?? null,
        new Date().toISOString(),
        new Date().toISOString(),
        existing.id,
        userId,
        publicationId,
      ).run()
      existing.thumbnail_storage_key = thumbnailKey
      existing.thumbnail_url = thumbnailUrl
      existing.thumbnail_mime_type = thumbnail.type
      existing.thumbnail_size_bytes = thumbnail.size
      existing.thumbnail_width = metadata.thumbnail_width ?? null
      existing.thumbnail_height = metadata.thumbnail_height ?? null
    }
    return { asset: mediaAssetResponse(existing), url: existing.public_url, reused: true }
  }

  const { plan } = await getUserPlan(c.env.DB, userId)
  const storageError = await checkStorageLimit(c.env.DB, userId, plan, sizeBytes)
  if (storageError) {
    throw new Response(JSON.stringify({ success: false, error: storageError }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    })
  }

  const id = crypto.randomUUID()
  const key = `uploads/${userId}/${id}.${ext}`
  const url = `${c.env.R2_PUBLIC_BASE_URL}/${key}`
  if (thumbnail && thumbnailBody) {
    const thumbExt = MEDIA_IMAGE_EXT_BY_TYPE[thumbnail.type]!
    thumbnailKey = `uploads/${userId}/${id}-thumb.${thumbExt}`
    thumbnailUrl = `${c.env.R2_PUBLIC_BASE_URL}/${thumbnailKey}`
  }
  const now = new Date().toISOString()
  const asset: MediaAssetRow = {
    id,
    tenant_id: userId,
    publication_id: publicationId,
    storage_bucket: 'MEDIA',
    storage_key: key,
    public_url: url,
    original_name: (metadata.original_name ?? file.name) || `imagen.${ext}`,
    mime_type: file.type,
    size_bytes: sizeBytes,
    sha256,
    width: Number.isFinite(width) && width !== null ? width : null,
    height: Number.isFinite(height) && height !== null ? height : null,
    original_mime_type: metadata.original_mime_type ?? file.type,
    original_size_bytes: metadata.original_size_bytes ?? sizeBytes,
    original_width: metadata.original_width ?? null,
    original_height: metadata.original_height ?? null,
    thumbnail_storage_key: thumbnailKey,
    thumbnail_url: thumbnailUrl,
    thumbnail_mime_type: thumbnail?.type ?? null,
    thumbnail_size_bytes: thumbnail?.size ?? null,
    thumbnail_width: metadata.thumbnail_width ?? null,
    thumbnail_height: metadata.thumbnail_height ?? null,
    optimization_status: metadata.optimization_status ?? null,
    optimization_version: metadata.optimization_version ?? null,
    optimized_at: metadata.optimization_status ? now : null,
    created_at: now,
    updated_at: now,
  }

  await c.env.MEDIA.put(key, body, {
    httpMetadata: { contentType: file.type },
  })
  if (thumbnail && thumbnailBody && thumbnailKey) {
    await c.env.MEDIA.put(thumbnailKey, thumbnailBody, {
      httpMetadata: { contentType: thumbnail.type },
    })
  }

  await c.env.DB.prepare(
    `INSERT INTO media_assets (
       id, tenant_id, publication_id, storage_bucket, storage_key, public_url,
       original_name, mime_type, size_bytes, sha256, width, height,
       original_mime_type, original_size_bytes, original_width, original_height,
       thumbnail_storage_key, thumbnail_url, thumbnail_mime_type, thumbnail_size_bytes, thumbnail_width, thumbnail_height,
       optimization_status, optimization_version, optimized_at,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    asset.id,
    asset.tenant_id,
    asset.publication_id,
    asset.storage_bucket,
    asset.storage_key,
    asset.public_url,
    asset.original_name,
    asset.mime_type,
    asset.size_bytes,
    asset.sha256,
    asset.width,
    asset.height,
    asset.original_mime_type,
    asset.original_size_bytes,
    asset.original_width,
    asset.original_height,
    asset.thumbnail_storage_key,
    asset.thumbnail_url,
    asset.thumbnail_mime_type,
    asset.thumbnail_size_bytes,
    asset.thumbnail_width,
    asset.thumbnail_height,
    asset.optimization_status,
    asset.optimization_version,
    asset.optimized_at,
    asset.created_at,
    asset.updated_at,
  ).run()

  return { asset: mediaAssetResponse(asset), url, reused: false }
}

upload.get('/media-assets', async (c) => {
  const userId = c.get('user').sub
  const publicationId = (c.req.query('publication_id') ?? '').trim()
  if (!publicationId) return c.json({ success: false, error: 'publication_id es requerido' }, 400)

  const publication = await getOwnedPublication(c, publicationId, userId)
  if (!publication) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)

  const q = (c.req.query('q') ?? '').trim()
  const needsThumbnail = c.req.query('needs_thumbnail') === 'true'
  const limit = boundedMediaAssetLimit(c.req.query('limit') ?? null)
  const pageNumber = Math.max(1, Number.parseInt(c.req.query('page') ?? '1', 10) || 1)
  const offset = (pageNumber - 1) * limit
  const cursor = parseMediaAssetCursor(c.req.query('cursor') ?? null)
  const conditions = [
    'tenant_id = ?',
    'publication_id = ?',
    'storage_bucket = ?',
    '(is_hidden IS NULL OR is_hidden = 0)',
    'deleted_at IS NULL',
    "mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/gif')",
  ]
  const params: unknown[] = [userId, publicationId, 'MEDIA']
  if (q) {
    conditions.push('original_name LIKE ?')
    params.push(`%${q}%`)
  }
  if (needsThumbnail) {
    conditions.push('(thumbnail_url IS NULL OR thumbnail_url = ?)')
    params.push('')
  }
  if (cursor) {
    conditions.push('(created_at < ? OR (created_at = ? AND id < ?))')
    params.push(cursor.created_at, cursor.created_at, cursor.id)
  }
  const countSql = `
    SELECT COUNT(*) as count
    FROM media_assets
    WHERE ${conditions.join(' AND ')}
  `
  const totalRow = await c.env.DB.prepare(countSql).bind(...params).first<{ count: number }>()

  const sql = `
    SELECT *
    FROM media_assets
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `
  params.push(limit + 1, offset)
  const result = await c.env.DB.prepare(sql).bind(...params).all<MediaAssetRow>()
  const knownRows = await c.env.DB.prepare(
    `SELECT public_url
     FROM media_assets
     WHERE tenant_id = ?
       AND publication_id = ?`,
  ).bind(userId, publicationId).all<{ public_url: string }>()
  const rows = result.results ?? []
  const pageRows = rows.slice(0, limit)
  const hasMore = rows.length > limit
  const knownUrls = Array.from(new Set((knownRows.results ?? []).map((row) => normalizeStoredAssetUrl(row.public_url)).filter(Boolean)))
  return c.json({
    success: true,
    data: pageRows.map(mediaAssetResponse),
    page: {
      limit,
      page: pageNumber,
      total: totalRow?.count ?? pageRows.length,
      total_pages: Math.max(1, Math.ceil((totalRow?.count ?? pageRows.length) / limit)),
      has_more: hasMore,
      next_cursor: hasMore ? encodeMediaAssetCursor(pageRows[pageRows.length - 1]) : null,
      known_urls: knownUrls,
    },
    meta: { known_urls: knownUrls, excluded_legacy_urls: knownUrls },
  })
})

upload.post('/media-assets/adopt', async (c) => {
  const userId = c.get('user').sub
  const reqId = c.req.header('CF-Ray') ?? crypto.randomUUID()
  const body = await c.req.json<{ publication_id?: string; public_url?: string; original_name?: string }>().catch(() => ({}))
  const publicationId = String(body.publication_id ?? '').trim()
  const publicUrl = normalizeStoredAssetUrl(String(body.public_url ?? ''))
  const originalName = String(body.original_name ?? '').trim() || assetNameFromUrl(publicUrl)

  if (!publicationId) return c.json({ success: false, error: 'publication_id es requerido' }, 400)
  if (!publicUrl) return c.json({ success: false, error: 'public_url es requerido' }, 400)
  const publication = await getOwnedPublication(c, publicationId, userId)
  if (!publication) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)

  try {
    const existing = await findMediaAssetByPublicUrl(c, userId, publicationId, publicUrl)
    if (existing) {
      return c.json({ success: true, data: { asset: mediaAssetResponse(existing), url: existing.public_url, reused: true } })
    }

    const storageKey = storageKeyFromKnownPublicUrl(c, publicUrl)
    const now = new Date().toISOString()
    const asset: MediaAssetRow = {
      id: crypto.randomUUID(),
      tenant_id: userId,
      publication_id: publicationId,
      storage_bucket: storageKey ? 'MEDIA' : 'EXTERNAL',
      storage_key: storageKey ?? `external/${crypto.randomUUID()}`,
      public_url: publicUrl,
      original_name: originalName,
      mime_type: mimeFromAssetUrl(publicUrl),
      size_bytes: 0,
      sha256: legacyAssetSha(publicUrl),
      width: null,
      height: null,
      is_hidden: 0,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    }

    await c.env.DB.prepare(
      `INSERT INTO media_assets (
         id, tenant_id, publication_id, storage_bucket, storage_key, public_url,
         original_name, mime_type, size_bytes, sha256, width, height, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      asset.id,
      asset.tenant_id,
      asset.publication_id,
      asset.storage_bucket,
      asset.storage_key,
      asset.public_url,
      asset.original_name,
      asset.mime_type,
      asset.size_bytes,
      asset.sha256,
      asset.width,
      asset.height,
      asset.created_at,
      asset.updated_at,
    ).run()

    return c.json({ success: true, data: { asset: mediaAssetResponse(asset), url: asset.public_url, reused: false } }, 201)
  } catch (error: any) {
    if (String(error?.message ?? '').includes('UNIQUE constraint')) {
      const existing = await findMediaAssetByPublicUrl(c, userId, publicationId, publicUrl)
      if (existing) return c.json({ success: true, data: { asset: mediaAssetResponse(existing), url: existing.public_url, reused: true } })
    }
    console.error('[media-assets.adopt] failed', {
      request_id: reqId,
      user_id: userId,
      publication_id: publicationId,
      public_url: publicUrl,
      error: errorMessage(error),
    })
    return c.json({ success: false, code: 'MEDIA_ASSET_ADOPT_FAILED', error: 'No se pudo registrar esta imagen anterior en el banco.' }, 500)
  }
})

upload.get('/media-assets/:assetId/usage', async (c) => {
  const userId = c.get('user').sub
  const reqId = c.req.header('CF-Ray') ?? crypto.randomUUID()
  const lookup = await getOwnedMediaAsset(c, userId, c.req.param('assetId'), c.req.query('publication_id') ?? undefined)
  if (lookup.status === 'missing') return c.json({ success: false, error: 'Imagen no encontrada' }, 404)
  if (lookup.status === 'forbidden') return c.json({ success: false, error: 'No tienes acceso a esta imagen' }, 403)
  try {
    const usage = await countMediaAssetUsage(c, lookup.asset)
    return c.json({ success: true, data: usage, ...usage })
  } catch (error) {
    console.error('[media-assets.usage] failed', {
      request_id: reqId,
      user_id: userId,
      asset_id: c.req.param('assetId'),
      publication_id: c.req.query('publication_id') ?? null,
      error: errorMessage(error),
    })
    return c.json({ success: false, code: 'MEDIA_ASSET_USAGE_FAILED', error: 'No se pudieron consultar los usos de esta imagen.' }, 500)
  }
})

upload.patch('/media-assets/:assetId', async (c) => {
  const userId = c.get('user').sub
  const lookup = await getOwnedMediaAsset(c, userId, c.req.param('assetId'))
  if (lookup.status === 'missing') return c.json({ success: false, error: 'Imagen no encontrada' }, 404)
  if (lookup.status === 'forbidden') return c.json({ success: false, error: 'No tienes acceso a esta imagen' }, 403)
  const body = await c.req.json<{ is_hidden?: boolean }>()
  await c.env.DB.prepare('UPDATE media_assets SET is_hidden = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
    .bind(body.is_hidden === false ? 0 : 1, new Date().toISOString(), lookup.asset.id, userId)
    .run()
  const updated = await getOwnedMediaAsset(c, userId, lookup.asset.id)
  return c.json({ success: true, data: updated.status === 'owned' ? mediaAssetResponse(updated.asset) : mediaAssetResponse(lookup.asset) })
})

upload.delete('/media-assets/:assetId', async (c) => {
  const userId = c.get('user').sub
  const lookup = await getOwnedMediaAsset(c, userId, c.req.param('assetId'), c.req.query('publication_id') ?? undefined)
  if (lookup.status === 'missing') return c.json({ success: false, error: 'Imagen no encontrada' }, 404)
  if (lookup.status === 'forbidden') return c.json({ success: false, error: 'No tienes acceso a esta imagen' }, 403)
  if (lookup.asset.storage_bucket !== 'MEDIA' || !lookup.asset.storage_key || !isPublicUploadKey(lookup.asset.storage_key)) {
    return c.json({ success: false, code: 'MEDIA_ASSET_UNSAFE_STORAGE_KEY', error: 'No se puede eliminar físicamente una imagen sin storage_key confiable.' }, 409)
  }
  const usage = await countMediaAssetUsage(c, lookup.asset)
  if (usage.usage_count > 0) {
    return c.json({ success: false, code: 'ASSET_IN_USE', error: 'La imagen está en uso y no puede eliminarse físicamente.', data: usage }, 409)
  }
  const secondUsage = await countMediaAssetUsage(c, lookup.asset)
  if (secondUsage.usage_count > 0) {
    return c.json({ success: false, code: 'ASSET_IN_USE', error: 'La imagen está en uso y no puede eliminarse físicamente.', data: secondUsage }, 409)
  }
  await c.env.MEDIA.delete(lookup.asset.storage_key)
  if (
    lookup.asset.thumbnail_storage_key
    && lookup.asset.thumbnail_storage_key !== lookup.asset.storage_key
    && isPublicUploadKey(lookup.asset.thumbnail_storage_key)
  ) {
    await c.env.MEDIA.delete(lookup.asset.thumbnail_storage_key)
  }
  await c.env.DB.prepare('UPDATE media_assets SET deleted_at = ?, is_hidden = 1, updated_at = ? WHERE id = ? AND tenant_id = ?')
    .bind(new Date().toISOString(), new Date().toISOString(), lookup.asset.id, userId)
    .run()
  return c.json({ success: true, data: { deleted: true } })
})

upload.post('/media-assets/:assetId/thumbnail', async (c) => {
  const userId = c.get('user').sub
  const formData = await c.req.formData()
  const publicationId = String(formData.get('publication_id') ?? '').trim()
  const thumbnail = formData.get('thumbnail')
  if (!publicationId) return c.json({ success: false, error: 'publication_id es requerido' }, 400)
  if (!(thumbnail instanceof File)) return c.json({ success: false, error: 'thumbnail field is required' }, 400)
  const lookup = await getOwnedMediaAsset(c, userId, c.req.param('assetId'), publicationId)
  if (lookup.status === 'missing') return c.json({ success: false, error: 'Imagen no encontrada' }, 404)
  if (lookup.status === 'forbidden') return c.json({ success: false, error: 'No tienes acceso a esta imagen' }, 403)
  const ext = MEDIA_IMAGE_EXT_BY_TYPE[thumbnail.type]
  if (!ext) return c.json({ success: false, error: 'Tipo de miniatura no permitido.' }, 415)
  if (thumbnail.size > IMAGE_MAX_BYTES) return c.json({ success: false, error: 'La miniatura supera el tamaño máximo permitido.' }, 413)

  const key = lookup.asset.thumbnail_storage_key && isPublicUploadKey(lookup.asset.thumbnail_storage_key)
    ? lookup.asset.thumbnail_storage_key
    : `uploads/${userId}/${lookup.asset.id}-thumb.${ext}`
  const url = `${c.env.R2_PUBLIC_BASE_URL}/${key}`
  await c.env.MEDIA.put(key, await thumbnail.arrayBuffer(), {
    httpMetadata: { contentType: thumbnail.type },
  })
  const now = new Date().toISOString()
  await c.env.DB.prepare(
    `UPDATE media_assets
     SET thumbnail_storage_key = ?, thumbnail_url = ?, thumbnail_mime_type = ?, thumbnail_size_bytes = ?,
         thumbnail_width = ?, thumbnail_height = ?, optimization_status = ?, optimization_version = ?, optimized_at = ?, updated_at = ?
     WHERE id = ? AND tenant_id = ? AND publication_id = ?`,
  ).bind(
    key,
    url,
    thumbnail.type,
    thumbnail.size,
    optionalInt(formData.get('thumbnail_width')),
    optionalInt(formData.get('thumbnail_height')),
    optionalString(formData.get('optimization_status')) ?? 'thumbnail_only',
    optionalString(formData.get('optimization_version')),
    now,
    now,
    lookup.asset.id,
    userId,
    publicationId,
  ).run()
  const updated = await getOwnedMediaAsset(c, userId, lookup.asset.id, publicationId)
  return c.json({ success: true, data: { asset: updated.status === 'owned' ? mediaAssetResponse(updated.asset) : mediaAssetResponse(lookup.asset) } })
})

upload.post('/media-assets', async (c) => {
  const userId = c.get('user').sub
  const formData = await c.req.formData()
  const publicationId = String(formData.get('publication_id') ?? '').trim()
  const files = formData.getAll('file').filter((item): item is File => item instanceof File)
  const thumbnail = formData.get('thumbnail')
  const widthRaw = String(formData.get('width') ?? '').trim()
  const heightRaw = String(formData.get('height') ?? '').trim()
  const width = widthRaw ? Number.parseInt(widthRaw, 10) : null
  const height = heightRaw ? Number.parseInt(heightRaw, 10) : null
  const metadata = {
    original_name: optionalString(formData.get('original_name')),
    original_mime_type: optionalString(formData.get('original_mime_type')),
    original_size_bytes: optionalInt(formData.get('original_size_bytes')),
    original_width: optionalInt(formData.get('original_width')),
    original_height: optionalInt(formData.get('original_height')),
    optimized_mime_type: optionalString(formData.get('optimized_mime_type')),
    optimized_size_bytes: optionalInt(formData.get('optimized_size_bytes')),
    optimized_width: optionalInt(formData.get('optimized_width')),
    optimized_height: optionalInt(formData.get('optimized_height')),
    thumbnail_size_bytes: optionalInt(formData.get('thumbnail_size_bytes')),
    thumbnail_width: optionalInt(formData.get('thumbnail_width')),
    thumbnail_height: optionalInt(formData.get('thumbnail_height')),
    compression_saved_bytes: optionalInt(formData.get('compression_saved_bytes')),
    compression_saved_percent: optionalNumber(formData.get('compression_saved_percent')),
    optimization_status: optionalString(formData.get('optimization_status')),
    optimization_version: optionalString(formData.get('optimization_version')),
  }

  if (!publicationId) return c.json({ success: false, error: 'publication_id es requerido' }, 400)
  if (!files.length) return c.json({ success: false, error: 'file field is required' }, 400)

  const publication = await getOwnedPublication(c, publicationId, userId)
  if (!publication) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)

  try {
    const results = []
    for (const file of files) {
      results.push(await storeMediaAsset(c, userId, publicationId, file, width, height, thumbnail instanceof File ? thumbnail : null, metadata))
    }
    const first = results[0]
    const status = results.some((item) => !item.reused) ? 201 : 200
    return c.json({
      success: true,
      data: {
        asset: first.asset,
        url: first.url,
        reused: first.reused,
        assets: results.map((item) => item.asset),
        urls: results.map((item) => item.url),
        results,
      },
    }, status)
  } catch (error) {
    if (error instanceof Response) return error
    throw error
  }
})

upload.post('/', async (c) => {
  const userId = c.get('user').sub

  const formData = await c.req.formData()
  const file = formData.get('file') as File | null
  if (!file) return c.json({ success: false, error: 'file field is required' }, 400)

  const ext = EXT_BY_TYPE[file.type]
  if (!ext) {
    return c.json({ success: false, error: 'Tipo de archivo no permitido. Se aceptan imágenes, audio, video y documentos (PDF, ZIP, Office).' }, 415)
  }
  const isImage = file.type.startsWith('image/')
  const maxBytes = isImage ? IMAGE_MAX_BYTES : MEDIA_MAX_BYTES
  if (file.size > maxBytes) {
    const mb = Math.round(maxBytes / 1024 / 1024)
    return c.json({ success: false, error: `El archivo supera el tamaño máximo de ${mb} MB` }, 413)
  }

  const { plan } = await getUserPlan(c.env.DB, userId)
  const storageError = await checkStorageLimit(c.env.DB, userId, plan, file.size)
  if (storageError) return c.json({ success: false, error: storageError }, 403)

  const key = `uploads/${userId}/${crypto.randomUUID()}.${ext}`

  await c.env.MEDIA.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  })

  const url = `${c.env.R2_PUBLIC_BASE_URL}/${key}`
  return c.json({ success: true, data: { url, key, size_bytes: file.size } }, 201)
})

// Borra un archivo de R2. Acepta el `key` directo o una `url` pública (de la que se
// deriva el key). Guarda de propiedad: solo se permite borrar archivos dentro de
// `uploads/<userId>/` del usuario autenticado — nadie puede borrar archivos de otro.
upload.delete('/', async (c) => {
  const userId = c.get('user').sub

  const body = await c.req.json<{ key?: string; url?: string }>().catch(() => ({}))
  let key = body.key?.trim()

  // Si llega una URL pública, derivamos el key quitando el prefijo R2.
  if (!key && body.url) {
    const base = c.env.R2_PUBLIC_BASE_URL.replace(/\/+$/, '')
    key = body.url.trim().replace(`${base}/`, '')
  }

  if (!key) return c.json({ success: false, error: 'key o url es requerido' }, 400)

  const prefix = `uploads/${userId}/`
  if (!key.startsWith(prefix)) {
    return c.json({ success: false, error: 'No autorizado para borrar este archivo' }, 403)
  }

  await c.env.MEDIA.delete(key)
  return c.json({ success: true })
})

export default upload
