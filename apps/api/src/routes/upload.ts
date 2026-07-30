import { Hono } from 'hono'
import { jwtMiddleware } from '../middleware/jwt'
import { getUserPlan, checkStorageLimit } from '../lib/plans'
import { sanitizeSvg } from '../lib/svg'
import { checkTenantStorageLimit } from '../lib/storageUsage'
import {
  countStorageObjectReferences,
  detachStorageReferencesBySource,
  finalizeStorageObjectDeletionByPhysicalKey,
  getStorageObjectByPhysicalKey,
  linkStorageObjectReference,
  listStorageObjectsForSource,
  registerStorageObject,
  setStorageObjectLifecycle,
} from '../lib/storageRegistry'
import type { Env } from '../index'
import type { AuthVariables } from '../middleware/jwt'

type Variables = AuthVariables

const upload = new Hono<{ Bindings: Env; Variables: Variables }>()

function isPublicUploadKey(key: string) {
  return /^uploads\/[^/]+\/[^/]+$/.test(key)
}

function safeMediaAssetPhysicalKeys(asset: MediaAssetRow): string[] {
  const keys = [
    asset.storage_key,
    asset.optimized_storage_key ?? null,
    asset.thumbnail_storage_key ?? null,
  ]

  return Array.from(new Set(
    keys.filter((key): key is string =>
      !!key && isPublicUploadKey(key)
    ),
  ))
}

async function countMediaAssetStorageObjectReferences(
  db: D1Database,
  storageObjectId: string,
  tenantId: string,
  assetId: string,
): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS count
     FROM storage_object_references
     WHERE storage_object_id = ?
       AND tenant_id = ?
       AND source_type = 'media_asset'
       AND source_id = ?`,
  ).bind(storageObjectId, tenantId, assetId).first<{ count: number }>()

  const count = Number(row?.count ?? 0)
  return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0
}

async function detachMediaAssetStorageObjectReferences(
  db: D1Database,
  storageObjectId: string,
  tenantId: string,
  assetId: string,
): Promise<void> {
  await db.prepare(
    `DELETE FROM storage_object_references
     WHERE storage_object_id = ?
       AND tenant_id = ?
       AND source_type = 'media_asset'
       AND source_id = ?`,
  ).bind(storageObjectId, tenantId, assetId).run()
}

export async function assertMediaAssetPhysicalDeletionAllowed(
  c: any,
  userId: string,
  asset: MediaAssetRow,
): Promise<{ ok: true; keys: string[] } | { ok: false; response: Response }> {
  if (asset.storage_bucket !== 'MEDIA') {
    return {
      ok: false,
      response: c.json({
        success: false,
        code: 'MEDIA_ASSET_UNSAFE_STORAGE_KEY',
        error: 'No se puede eliminar físicamente una imagen sin storage_key confiable.',
      }, 409),
    }
  }

  const keysToDelete = safeMediaAssetPhysicalKeys(asset)
  if (!keysToDelete.length) {
    return {
      ok: false,
      response: c.json({
        success: false,
        code: 'MEDIA_ASSET_UNSAFE_STORAGE_KEY',
        error: 'No se encontraron claves uploads/... seguras para eliminar.',
      }, 409),
    }
  }

  const usage = await countMediaAssetUsage(c, asset)
  if (usage.usage_count > 0) {
    return {
      ok: false,
      response: c.json({
        success: false,
        code: 'ASSET_IN_USE',
        error: 'La imagen está en uso y no puede eliminarse definitivamente.',
        data: usage,
      }, 409),
    }
  }

  for (const key of keysToDelete) {
    const object = await getStorageObjectByPhysicalKey(
      c.env.DB,
      userId,
      'MEDIA',
      key,
    )
    if (!object) continue

    const totalReferences = await countStorageObjectReferences(
      c.env.DB,
      object.id,
    )
    const ownReferences = await countMediaAssetStorageObjectReferences(
      c.env.DB,
      object.id,
      userId,
      asset.id,
    )

    if (totalReferences > ownReferences) {
      return {
        ok: false,
        response: c.json({
          success: false,
          code: 'ASSET_IN_USE',
          error: 'La imagen todavía tiene referencias activas y no puede eliminarse definitivamente.',
          data: {
            asset_id: asset.id,
            storage_key: key,
            reference_count: totalReferences,
          },
        }, 409),
      }
    }
  }

  return { ok: true, keys: keysToDelete }
}

export async function permanentlyDeleteMediaAsset(
  c: any,
  userId: string,
  asset: MediaAssetRow,
) {
  const deletion = await assertMediaAssetPhysicalDeletionAllowed(c, userId, asset)
  if (!deletion.ok) return deletion.response

  const secondCheck = await assertMediaAssetPhysicalDeletionAllowed(c, userId, asset)
  if (!secondCheck.ok) return secondCheck.response
  const keysToDelete = secondCheck.keys

  try {
    for (const key of keysToDelete) {
      await c.env.MEDIA.delete(key)
    }
  } catch (error) {
    console.error('[upload.media-assets.delete.r2] failed', {
      user_id: userId,
      asset_id: asset.id,
      error: error instanceof Error
        ? error.message
        : String(error),
    })

    return c.json({
      success: false,
      error: 'No se pudo eliminar el archivo físico.',
    }, 500)
  }

  for (const key of keysToDelete) {
    const object = await getStorageObjectByPhysicalKey(
      c.env.DB,
      userId,
      'MEDIA',
      key,
    )
    if (!object) continue

    await detachMediaAssetStorageObjectReferences(
      c.env.DB,
      object.id,
      userId,
      asset.id,
    )

    const finalized = await finalizeStorageObjectDeletionByPhysicalKey(
      c.env.DB,
      userId,
      'MEDIA',
      key,
    )
    if (!finalized) {
      console.error('[upload.media-assets.delete.registry] failed', {
        user_id: userId,
        asset_id: asset.id,
        storage_object_id: object.id,
        storage_key: key,
      })
    }
  }

  const now = new Date().toISOString()
  await c.env.DB.prepare('UPDATE media_assets SET deleted_at = ?, is_hidden = 1, updated_at = ? WHERE id = ? AND tenant_id = ?')
    .bind(now, now, asset.id, userId)
    .run()
  return c.json({ success: true, data: { deleted: true } })
}

function variantAdditionalBytes(
  variants: Array<{
    key: string
    bytes: number
    replacingBytes?: number | null
  }>,
): { incomingBytes: number; replacingBytes: number } {
  const byKey = new Map<string, { bytes: number; replacingBytes: number }>()

  for (const variant of variants) {
    const current = byKey.get(variant.key)

    byKey.set(variant.key, {
      bytes: Math.max(current?.bytes ?? 0, variant.bytes),
      replacingBytes: Math.max(
        current?.replacingBytes ?? 0,
        variant.replacingBytes ?? 0,
      ),
    })
  }

  let incomingBytes = 0
  let replacingBytes = 0

  for (const variant of byKey.values()) {
    incomingBytes += variant.bytes
    replacingBytes += variant.replacingBytes
  }

  return { incomingBytes, replacingBytes }
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

  // Los assets usan claves únicas e inmutables. Fabric.js los solicita con
  // crossOrigin="anonymous", por lo que la respuesta debe autorizar lectura
  // desde Viewer, Dashboard, Preview, dominios personalizados y desarrollo local.
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin')
  headers.set('Timing-Allow-Origin', '*')
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  headers.set('X-Content-Type-Options', 'nosniff')

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
  folder_id?: string | null
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
  optimized_storage_key?: string | null
  optimized_url?: string | null
  optimized_mime_type?: string | null
  optimized_size_bytes?: number | null
  optimized_width?: number | null
  optimized_height?: number | null
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

type MediaFolderRow = {
  id: string
  tenant_id: string
  publication_id: string
  name: string
  asset_count?: number
  created_at: string
  updated_at: string
}

function mediaAssetResponse(row: MediaAssetRow) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    publication_id: row.publication_id,
    folder_id: row.folder_id ?? null,
    storage_bucket: row.storage_bucket,
    storage_key: row.storage_key,
    public_url: row.public_url,
    original_url: row.public_url,
    optimized_storage_key: row.optimized_storage_key ?? null,
    optimized_url: row.optimized_url ?? null,
    optimized_mime_type: row.optimized_mime_type ?? null,
    optimized_size_bytes: row.optimized_size_bytes ?? null,
    optimized_width: row.optimized_width ?? null,
    optimized_height: row.optimized_height ?? null,
    display_url: row.optimized_url || row.public_url,
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

function mediaFolderResponse(row: MediaFolderRow) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    publication_id: row.publication_id,
    name: row.name,
    asset_count: Number(row.asset_count ?? 0),
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

function normalizeMediaFolderName(value: unknown) {
  const name = String(value ?? '').trim()
  if (name.length < 1) return { ok: false as const, error: 'El nombre de la carpeta es requerido.' }
  if (name.length > 80) return { ok: false as const, error: 'El nombre de la carpeta no puede superar 80 caracteres.' }
  return { ok: true as const, name }
}

async function getOwnedMediaFolder(c: any, userId: string, folderId: string, publicationId?: string) {
  const conditions = ['id = ?', 'tenant_id = ?']
  const params: unknown[] = [folderId, userId]
  if (publicationId) {
    conditions.push('publication_id = ?')
    params.push(publicationId)
  }
  return c.env.DB.prepare(
    `SELECT *
     FROM media_folders
     WHERE ${conditions.join(' AND ')}
     LIMIT 1`,
  ).bind(...params).first<MediaFolderRow>()
}

async function ensureMediaFolderNameAvailable(c: any, userId: string, publicationId: string, name: string, exceptFolderId?: string) {
  const params: unknown[] = [userId, publicationId, name]
  let except = ''
  if (exceptFolderId) {
    except = 'AND id <> ?'
    params.push(exceptFolderId)
  }
  const existing = await c.env.DB.prepare(
    `SELECT id
     FROM media_folders
     WHERE tenant_id = ?
       AND publication_id = ?
       AND name = ? COLLATE NOCASE
       ${except}
     LIMIT 1`,
  ).bind(...params).first<{ id: string }>()
  return !existing
}

async function parseTargetMediaFolder(c: any, userId: string, publicationId: string, rawFolderId: unknown) {
  const folderId = String(rawFolderId ?? '').trim()
  if (!folderId || folderId === 'unfiled') return { ok: true as const, folderId: null as string | null }
  const folder = await getOwnedMediaFolder(c, userId, folderId, publicationId)
  if (!folder) return { ok: false as const, response: c.json({ success: false, error: 'Carpeta no encontrada' }, 404) }
  return { ok: true as const, folderId }
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

async function storeMediaAsset(c: any, userId: string, publicationId: string, folderId: string | null | undefined, file: File, width: number | null, height: number | null, thumbnail: File | null, metadata: Record<string, any>) {
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
    if (folderId !== undefined && existing.folder_id !== folderId) {
      await c.env.DB.prepare(
        `UPDATE media_assets
         SET folder_id = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND publication_id = ?`,
      ).bind(folderId, new Date().toISOString(), existing.id, userId, publicationId).run()
      existing.folder_id = folderId
    }
    if (thumbnail && thumbnailBody && !existing.thumbnail_url) {
      const thumbExt = MEDIA_IMAGE_EXT_BY_TYPE[thumbnail.type]!
      thumbnailKey = `uploads/${userId}/${existing.id}-thumb.${thumbExt}`
      thumbnailUrl = `${c.env.R2_PUBLIC_BASE_URL}/${thumbnailKey}`
      const thumbnailCheck = await checkTenantStorageLimit(
        c.env.DB,
        userId,
        thumbnail.size,
      )
      if (!thumbnailCheck.allowed) {
        throw new Response(JSON.stringify({
          success: false,
          error: thumbnailCheck.message
            ?? 'Almacenamiento insuficiente.',
        }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        })
      }
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
  const newAssetBytes = variantAdditionalBytes([
    { key: 'main', bytes: sizeBytes },
    ...(thumbnail && thumbnailBody
      ? [{ key: 'thumbnail', bytes: thumbnail.size }]
      : []),
  ]).incomingBytes
  const storageError = await checkStorageLimit(c.env.DB, userId, plan, newAssetBytes)
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
    folder_id: folderId ?? null,
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
    optimized_storage_key: key,
    optimized_url: url,
    optimized_mime_type: file.type,
    optimized_size_bytes: sizeBytes,
    optimized_width: Number.isFinite(width) && width !== null ? width : null,
    optimized_height: Number.isFinite(height) && height !== null ? height : null,
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
       id, tenant_id, publication_id, folder_id, storage_bucket, storage_key, public_url,
       original_name, mime_type, size_bytes, sha256, width, height,
       original_mime_type, original_size_bytes, original_width, original_height,
       optimized_storage_key, optimized_url, optimized_mime_type, optimized_size_bytes, optimized_width, optimized_height,
       thumbnail_storage_key, thumbnail_url, thumbnail_mime_type, thumbnail_size_bytes, thumbnail_width, thumbnail_height,
       optimization_status, optimization_version, optimized_at,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    asset.id,
    asset.tenant_id,
    asset.publication_id,
    asset.folder_id,
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
    asset.optimized_storage_key,
    asset.optimized_url,
    asset.optimized_mime_type,
    asset.optimized_size_bytes,
    asset.optimized_width,
    asset.optimized_height,
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

upload.get('/media-folders', async (c) => {
  const userId = c.get('user').sub
  const publicationId = (c.req.query('publication_id') ?? '').trim()
  if (!publicationId) return c.json({ success: false, error: 'publication_id es requerido' }, 400)
  const publication = await getOwnedPublication(c, publicationId, userId)
  if (!publication) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)

  const result = await c.env.DB.prepare(
    `SELECT f.*,
            COUNT(a.id) AS asset_count
     FROM media_folders f
     LEFT JOIN media_assets a
       ON a.folder_id = f.id
      AND a.tenant_id = f.tenant_id
      AND a.publication_id = f.publication_id
      AND (a.is_hidden IS NULL OR a.is_hidden = 0)
      AND a.deleted_at IS NULL
     WHERE f.tenant_id = ?
       AND f.publication_id = ?
     GROUP BY f.id
     ORDER BY f.name COLLATE NOCASE ASC, f.created_at ASC, f.id ASC`,
  ).bind(userId, publicationId).all<MediaFolderRow>()

  return c.json({ success: true, data: (result.results ?? []).map(mediaFolderResponse) })
})

upload.post('/media-folders', async (c) => {
  const userId = c.get('user').sub
  const body = await c.req.json<{ publication_id?: string; name?: string }>().catch(() => ({} as { publication_id?: string; name?: string }))
  const publicationId = String(body.publication_id ?? '').trim()
  const parsedName = normalizeMediaFolderName(body.name)
  if (!publicationId) return c.json({ success: false, error: 'publication_id es requerido' }, 400)
  if (!parsedName.ok) return c.json({ success: false, error: parsedName.error }, 400)
  const publication = await getOwnedPublication(c, publicationId, userId)
  if (!publication) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)
  if (!(await ensureMediaFolderNameAvailable(c, userId, publicationId, parsedName.name))) {
    return c.json({ success: false, code: 'MEDIA_FOLDER_NAME_EXISTS', error: 'Ya existe una carpeta con ese nombre en esta publicación.' }, 409)
  }

  const now = new Date().toISOString()
  const folder: MediaFolderRow = {
    id: crypto.randomUUID(),
    tenant_id: userId,
    publication_id: publicationId,
    name: parsedName.name,
    asset_count: 0,
    created_at: now,
    updated_at: now,
  }
  await c.env.DB.prepare(
    `INSERT INTO media_folders (id, tenant_id, publication_id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(folder.id, userId, publicationId, folder.name, now, now).run()
  return c.json({ success: true, data: mediaFolderResponse(folder) }, 201)
})

upload.patch('/media-folders/:folderId', async (c) => {
  const userId = c.get('user').sub
  const folderId = c.req.param('folderId')
  const body = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }))
  const parsedName = normalizeMediaFolderName(body.name)
  if (!parsedName.ok) return c.json({ success: false, error: parsedName.error }, 400)
  const folder = await getOwnedMediaFolder(c, userId, folderId)
  if (!folder) return c.json({ success: false, error: 'Carpeta no encontrada' }, 404)
  if (!(await ensureMediaFolderNameAvailable(c, userId, folder.publication_id, parsedName.name, folder.id))) {
    return c.json({ success: false, code: 'MEDIA_FOLDER_NAME_EXISTS', error: 'Ya existe una carpeta con ese nombre en esta publicación.' }, 409)
  }

  const now = new Date().toISOString()
  await c.env.DB.prepare(
    `UPDATE media_folders
     SET name = ?, updated_at = ?
     WHERE id = ? AND tenant_id = ?`,
  ).bind(parsedName.name, now, folder.id, userId).run()
  return c.json({ success: true, data: mediaFolderResponse({ ...folder, name: parsedName.name, updated_at: now }) })
})

upload.delete('/media-folders/:folderId', async (c) => {
  const userId = c.get('user').sub
  const folderId = c.req.param('folderId')
  const folder = await getOwnedMediaFolder(c, userId, folderId)
  if (!folder) return c.json({ success: false, error: 'Carpeta no encontrada' }, 404)

  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM media_assets
     WHERE tenant_id = ?
       AND publication_id = ?
       AND folder_id = ?`,
  ).bind(userId, folder.publication_id, folder.id).first<{ count: number }>()
  const movedCount = Number(countRow?.count ?? 0)
  const now = new Date().toISOString()
  await c.env.DB.prepare(
    `UPDATE media_assets
     SET folder_id = NULL, updated_at = ?
     WHERE tenant_id = ?
       AND publication_id = ?
       AND folder_id = ?`,
  ).bind(now, userId, folder.publication_id, folder.id).run()
  await c.env.DB.prepare(
    `DELETE FROM media_folders
     WHERE id = ? AND tenant_id = ?`,
  ).bind(folder.id, userId).run()
  return c.json({ success: true, data: { deleted: true, moved_count: movedCount } })
})

upload.get('/media-assets', async (c) => {
  const userId = c.get('user').sub
  const publicationId = (c.req.query('publication_id') ?? '').trim()
  if (!publicationId) return c.json({ success: false, error: 'publication_id es requerido' }, 400)

  const publication = await getOwnedPublication(c, publicationId, userId)
  if (!publication) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)

  const folderFilter = c.req.query('folder_id')
  if (folderFilter === 'unfiled') {
    // Banco general: folder_id NULL.
  } else if (folderFilter != null && folderFilter.trim()) {
    const folder = await getOwnedMediaFolder(c, userId, folderFilter.trim(), publicationId)
    if (!folder) return c.json({ success: false, error: 'Carpeta no encontrada' }, 404)
  }

  const q = (c.req.query('q') ?? '').trim()
  const hiddenOnly = c.req.query('hidden') === 'true'
  const needsThumbnail = c.req.query('needs_thumbnail') === 'true'
  const needsOptimization = c.req.query('needs_optimization') === 'true'
  const limit = boundedMediaAssetLimit(c.req.query('limit') ?? null)
  const pageNumber = Math.max(1, Number.parseInt(c.req.query('page') ?? '1', 10) || 1)
  const offset = (pageNumber - 1) * limit
  const cursor = parseMediaAssetCursor(c.req.query('cursor') ?? null)
  const conditions = [
    'tenant_id = ?',
    'publication_id = ?',
    'storage_bucket = ?',
    'deleted_at IS NULL',
    "mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/gif')",
  ]
  const params: unknown[] = [userId, publicationId, 'MEDIA']
  conditions.push(
    hiddenOnly
      ? 'is_hidden = 1'
      : '(is_hidden IS NULL OR is_hidden = 0)',
  )
  if (folderFilter === 'unfiled') {
    conditions.push('folder_id IS NULL')
  } else if (folderFilter != null && folderFilter.trim()) {
    conditions.push('folder_id = ?')
    params.push(folderFilter.trim())
  }
  if (q) {
    conditions.push('original_name LIKE ?')
    params.push(`%${q}%`)
  }
  if (needsThumbnail) {
    conditions.push('(thumbnail_url IS NULL OR thumbnail_url = ?)')
    params.push('')
  }
  if (needsOptimization) {
    conditions.push('((thumbnail_url IS NULL OR thumbnail_url = ?) OR (optimized_url IS NULL OR optimized_url = ?))')
    params.push('', '')
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

upload.post('/media-assets/move', async (c) => {
  const userId = c.get('user').sub
  const body = await c.req.json<{ publication_id?: string; asset_ids?: string[]; folder_id?: string | null }>().catch(() => ({} as { publication_id?: string; asset_ids?: string[]; folder_id?: string | null }))
  const publicationId = String(body.publication_id ?? '').trim()
  const assetIds = Array.from(new Set((body.asset_ids ?? []).map((id: string) => String(id ?? '').trim()).filter(Boolean)))
  if (!publicationId) return c.json({ success: false, error: 'publication_id es requerido' }, 400)
  if (!assetIds.length) return c.json({ success: false, error: 'asset_ids es requerido' }, 400)
  if (assetIds.length > 100) return c.json({ success: false, error: 'No se pueden mover más de 100 imágenes por solicitud.' }, 400)
  const publication = await getOwnedPublication(c, publicationId, userId)
  if (!publication) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)

  const parsedFolder = await parseTargetMediaFolder(c, userId, publicationId, body.folder_id ?? null)
  if (!parsedFolder.ok) return parsedFolder.response

  const placeholders = assetIds.map(() => '?').join(',')
  const owned = await c.env.DB.prepare(
    `SELECT id
     FROM media_assets
     WHERE tenant_id = ?
       AND publication_id = ?
       AND (is_hidden IS NULL OR is_hidden = 0)
       AND deleted_at IS NULL
       AND id IN (${placeholders})`,
  ).bind(userId, publicationId, ...assetIds).all<{ id: string }>()
  const ownedIds = new Set((owned.results ?? []).map((row) => row.id))
  if (ownedIds.size !== assetIds.length) {
    return c.json({ success: false, error: 'Una o más imágenes no pertenecen a esta publicación o no pueden moverse.' }, 404)
  }

  const now = new Date().toISOString()
  await c.env.DB.prepare(
    `UPDATE media_assets
     SET folder_id = ?, updated_at = ?
     WHERE tenant_id = ?
       AND publication_id = ?
       AND id IN (${placeholders})`,
  ).bind(parsedFolder.folderId, now, userId, publicationId, ...assetIds).run()

  return c.json({ success: true, data: { moved_count: assetIds.length, folder_id: parsedFolder.folderId } })
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

upload.post('/media-assets/resolve-thumbnails', async (c) => {
  const userId = c.get('user').sub
  const body = await c.req.json<{ publication_id?: string; public_urls?: string[] }>().catch(() => ({}))
  const publicationId = String(body.publication_id ?? '').trim()
  const urls = Array.from(new Set((body.public_urls ?? [])
    .map((url) => normalizeStoredAssetUrl(String(url ?? '')))
    .filter(Boolean)))
    .slice(0, 200)

  if (!publicationId) return c.json({ success: false, error: 'publication_id es requerido' }, 400)
  const publication = await getOwnedPublication(c, publicationId, userId)
  if (!publication) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)
  if (!urls.length) return c.json({ success: true, data: { thumbnails: {}, displays: {}, variants: {}, assets: [] } })

  // D1 limita la cantidad de parámetros por sentencia. Se procesan lotes
  // suficientemente pequeños para conservar margen para tenant y publicación.
  const URL_BATCH_SIZE = 80
  const rows: MediaAssetRow[] = []

  for (let offset = 0; offset < urls.length; offset += URL_BATCH_SIZE) {
    const batch = urls.slice(offset, offset + URL_BATCH_SIZE)
    const placeholders = batch.map(() => '?').join(',')
    const result = await c.env.DB.prepare(
      `SELECT *
       FROM media_assets
       WHERE tenant_id = ?
         AND publication_id = ?
         AND public_url IN (${placeholders})
         AND (is_hidden IS NULL OR is_hidden = 0)
         AND deleted_at IS NULL`,
    ).bind(userId, publicationId, ...batch).all<MediaAssetRow>()

    rows.push(...(result.results ?? []))
  }

  const assets = rows.map(mediaAssetResponse)
  const thumbnails: Record<string, string> = {}
  const displays: Record<string, string> = {}
  const variants: Record<string, { original_url: string; display_url: string; thumbnail_url: string | null; optimized_url: string | null }> = {}
  for (const asset of assets) {
    if (asset.public_url && asset.thumbnail_url) thumbnails[asset.public_url] = asset.thumbnail_url
    if (asset.public_url && asset.display_url) displays[asset.public_url] = asset.display_url
    if (asset.public_url) {
      variants[asset.public_url] = {
        original_url: asset.original_url,
        display_url: asset.display_url,
        thumbnail_url: asset.thumbnail_url,
        optimized_url: asset.optimized_url,
      }
    }
  }
  return c.json({ success: true, data: { thumbnails, displays, variants, assets } })
})

upload.post('/media-assets/:assetId/variants', async (c) => {
  const userId = c.get('user').sub
  const assetId = c.req.param('assetId')
  const form = await c.req.formData()
  const publicationId = String(form.get('publication_id') ?? '').trim()
  const display = form.get('display')
  const thumbnail = form.get('thumbnail')
  const metadata = Object.fromEntries(form.entries())

  if (!publicationId) return c.json({ success: false, error: 'publication_id es requerido' }, 400)
  const lookup = await getOwnedMediaAsset(c, userId, assetId, publicationId)
  if (lookup.status === 'missing') return c.json({ success: false, error: 'Imagen no encontrada' }, 404)
  if (lookup.status === 'forbidden') return c.json({ success: false, error: 'No tienes acceso a esta imagen' }, 403)

  const asset = lookup.asset
  const updates: string[] = []
  const values: unknown[] = []
  const now = new Date().toISOString()
  const displayUpload = display instanceof File && !asset.optimized_url
    ? (() => {
      const ext = MEDIA_IMAGE_EXT_BY_TYPE[display.type]
      if (!ext) return { error: 'Tipo de display no permitido.', status: 415 as const }
      if (display.size > IMAGE_MAX_BYTES) return { error: 'El display supera el tamaño máximo permitido.', status: 413 as const }
      const key = `uploads/${userId}/${asset.id}-display.${ext}`

      return {
        file: display,
        key,
        url: `${c.env.R2_PUBLIC_BASE_URL}/${key}`,
      }
    })()
    : null
  const thumbnailUpload = thumbnail instanceof File && !asset.thumbnail_url
    ? (() => {
      const ext = MEDIA_IMAGE_EXT_BY_TYPE[thumbnail.type]
      if (!ext) return { error: 'Tipo de miniatura no permitido.', status: 415 as const }
      if (thumbnail.size > IMAGE_MAX_BYTES) return { error: 'La miniatura supera el tamaño máximo permitido.', status: 413 as const }
      const key = `uploads/${userId}/${asset.id}-thumb.${ext}`

      return {
        file: thumbnail,
        key,
        url: `${c.env.R2_PUBLIC_BASE_URL}/${key}`,
      }
    })()
    : null

  if (displayUpload && 'error' in displayUpload) {
    return c.json({ success: false, error: displayUpload.error }, displayUpload.status)
  }

  if (thumbnailUpload && 'error' in thumbnailUpload) {
    return c.json({ success: false, error: thumbnailUpload.error }, thumbnailUpload.status)
  }

  const pendingVariants = [
    ...(displayUpload && !('error' in displayUpload)
      ? [{ key: displayUpload.key, bytes: displayUpload.file.size }]
      : []),
    ...(thumbnailUpload && !('error' in thumbnailUpload)
      ? [{ key: thumbnailUpload.key, bytes: thumbnailUpload.file.size }]
      : []),
  ]

  if (pendingVariants.length) {
    const { incomingBytes, replacingBytes } =
      variantAdditionalBytes(pendingVariants)
    const storageCheck = await checkTenantStorageLimit(
      c.env.DB,
      userId,
      incomingBytes,
      replacingBytes,
    )

    if (!storageCheck.allowed) {
      return c.json({
        success: false,
        error: storageCheck.message
          ?? 'Almacenamiento insuficiente.',
      }, 403)
    }
  }

  if (displayUpload && !('error' in displayUpload)) {
    const { file, key, url } = displayUpload
    await c.env.MEDIA.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    })
    updates.push('optimized_storage_key = ?', 'optimized_url = ?', 'optimized_mime_type = ?', 'optimized_size_bytes = ?', 'optimized_width = ?', 'optimized_height = ?')
    values.push(
      key,
      url,
      file.type,
      file.size,
      optionalInt(metadata.optimized_width as any),
      optionalInt(metadata.optimized_height as any),
    )
    asset.optimized_storage_key = key
    asset.optimized_url = url
    asset.optimized_mime_type = file.type
    asset.optimized_size_bytes = file.size
    asset.optimized_width = optionalInt(metadata.optimized_width as any)
    asset.optimized_height = optionalInt(metadata.optimized_height as any)
  }

  if (thumbnailUpload && !('error' in thumbnailUpload)) {
    const { file, key, url } = thumbnailUpload
    await c.env.MEDIA.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    })
    updates.push('thumbnail_storage_key = ?', 'thumbnail_url = ?', 'thumbnail_mime_type = ?', 'thumbnail_size_bytes = ?', 'thumbnail_width = ?', 'thumbnail_height = ?')
    values.push(
      key,
      url,
      file.type,
      file.size,
      optionalInt(metadata.thumbnail_width as any),
      optionalInt(metadata.thumbnail_height as any),
    )
    asset.thumbnail_storage_key = key
    asset.thumbnail_url = url
    asset.thumbnail_mime_type = file.type
    asset.thumbnail_size_bytes = file.size
    asset.thumbnail_width = optionalInt(metadata.thumbnail_width as any)
    asset.thumbnail_height = optionalInt(metadata.thumbnail_height as any)
  }

  if (updates.length) {
    updates.push('optimization_status = COALESCE(optimization_status, ?)', 'optimization_version = COALESCE(optimization_version, ?)', 'optimized_at = COALESCE(optimized_at, ?)', 'updated_at = ?')
    values.push(optionalString(metadata.optimization_status as any) ?? 'optimized', optionalString(metadata.optimization_version as any), now, now)
    await c.env.DB.prepare(
      `UPDATE media_assets SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ? AND publication_id = ?`,
    ).bind(...values, asset.id, userId, publicationId).run()
  }

  const updated = await getOwnedMediaAsset(c, userId, asset.id, publicationId)
  return c.json({ success: true, data: { asset: mediaAssetResponse(updated.status === 'owned' ? updated.asset : asset) } })
})

upload.post('/media-assets/usage-by-url', async (c) => {
  const userId = c.get('user').sub
  const reqId = c.req.header('CF-Ray') ?? crypto.randomUUID()
  const body: { publication_id?: string; public_url?: string } = await c.req
    .json<{ publication_id?: string; public_url?: string }>()
    .catch(() => ({}))
  const publicationId = String(body.publication_id ?? '').trim()
  const publicUrl = normalizeStoredAssetUrl(String(body.public_url ?? ''))

  if (!publicationId) return c.json({ success: false, error: 'publication_id es requerido' }, 400)
  if (!publicUrl) return c.json({ success: false, error: 'public_url es requerido' }, 400)

  const publication = await getOwnedPublication(c, publicationId, userId)
  if (!publication) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)

  const now = new Date().toISOString()
  const syntheticAsset: MediaAssetRow = {
    id: publicUrl,
    tenant_id: userId,
    publication_id: publicationId,
    storage_bucket: 'EXTERNAL',
    storage_key: null,
    public_url: publicUrl,
    original_name: assetNameFromUrl(publicUrl),
    mime_type: mimeFromAssetUrl(publicUrl),
    size_bytes: 0,
    sha256: legacyAssetSha(publicUrl),
    width: null,
    height: null,
    created_at: now,
    updated_at: now,
  }

  try {
    const usage = await countMediaAssetUsage(c, syntheticAsset)
    return c.json({
      success: true,
      data: {
        ...usage,
        asset_id: null,
        public_url: publicUrl,
        can_delete_physical: false,
      },
    })
  } catch (error) {
    console.error('[media-assets.usage-by-url] failed', {
      request_id: reqId,
      user_id: userId,
      publication_id: publicationId,
      public_url: publicUrl,
      error: error instanceof Error ? error.message : String(error),
    })
    return c.json({
      success: false,
      code: 'MEDIA_ASSET_USAGE_FAILED',
      error: 'No se pudieron consultar los usos de esta imagen.',
    }, 500)
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
  return permanentlyDeleteMediaAsset(c, userId, lookup.asset)
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
  const replacedThumbnailBytes = (
    lookup.asset.thumbnail_storage_key
    && lookup.asset.thumbnail_storage_key === key
    && lookup.asset.thumbnail_storage_key !== lookup.asset.storage_key
    && lookup.asset.thumbnail_storage_key !== lookup.asset.optimized_storage_key
  )
    ? lookup.asset.thumbnail_size_bytes ?? 0
    : 0
  const storageCheck = await checkTenantStorageLimit(
    c.env.DB,
    userId,
    thumbnail.size,
    replacedThumbnailBytes,
  )
  if (!storageCheck.allowed) {
    return c.json({
      success: false,
      error: storageCheck.message
        ?? 'Almacenamiento insuficiente.',
    }, 403)
  }
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
  const hasFolderId = formData.has('folder_id')
  const parsedFolder = hasFolderId
    ? await parseTargetMediaFolder(c, userId, publicationId, formData.get('folder_id'))
    : { ok: true as const, folderId: undefined as string | null | undefined }
  if (!parsedFolder.ok) return parsedFolder.response

  try {
    const results = []
    for (const file of files) {
      results.push(await storeMediaAsset(c, userId, publicationId, parsedFolder.folderId, file, width, height, thumbnail instanceof File ? thumbnail : null, metadata))
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

  if (!file) {
    return c.json({
      success: false,
      error: 'file field is required',
    }, 400)
  }

  const ext = EXT_BY_TYPE[file.type]

  if (!ext) {
    return c.json({
      success: false,
      error: (
        'Tipo de archivo no permitido. '
        + 'Se aceptan imágenes, audio, video y documentos '
        + '(PDF, ZIP, Office).'
      ),
    }, 415)
  }

  const isImage = file.type.startsWith('image/')
  const maxBytes = isImage
    ? IMAGE_MAX_BYTES
    : MEDIA_MAX_BYTES

  if (file.size > maxBytes) {
    const mb = Math.round(maxBytes / 1024 / 1024)

    return c.json({
      success: false,
      error: `El archivo supera el tamaño máximo de ${mb} MB`,
    }, 413)
  }

  const storageCheck = await checkTenantStorageLimit(
    c.env.DB,
    userId,
    file.size,
  )

  if (!storageCheck.allowed) {
    return c.json({
      success: false,
      error: storageCheck.message
        ?? 'Almacenamiento insuficiente.',
    }, 403)
  }

  const key = `uploads/${userId}/${crypto.randomUUID()}.${ext}`
  const url = `${c.env.R2_PUBLIC_BASE_URL}/${key}`

  let storageObjectId: string | null = null
  let physicalCreated = false

  try {
    // Registrar primero evita que un archivo físico quede sin contabilizar
    // cuando D1 y el rollback de R2 fallan simultáneamente.
    storageObjectId = await registerStorageObject(
      c.env.DB,
      {
        tenantId: userId,
        bucketKey: 'MEDIA',
        objectKey: key,
        sizeBytes: file.size,
        mimeType: file.type,
        category: 'raw_upload',
        metadata: {
          original_name: file.name,
        },
      },
    )

    // Desde que comienza el intento de escritura, el resultado puede
    // ser ambiguo. El rollback debe intentar borrar la clave aunque
    // MEDIA.put lance una excepción antes de devolver el control.
    physicalCreated = true

    await c.env.MEDIA.put(
      key,
      await file.arrayBuffer(),
      {
        httpMetadata: {
          contentType: file.type,
        },
      },
    )

    await linkStorageObjectReference(
      c.env.DB,
      {
        storageObjectId,
        tenantId: userId,
        publicationId: null,
        sourceType: 'raw_upload',
        sourceId: key,
        sourceField: 'object_key',
      },
    )
  } catch (error) {
    let physicalDeleted = !physicalCreated
    let registryCleanupError: unknown = null

    if (physicalCreated) {
      try {
        await c.env.MEDIA.delete(key)
        physicalDeleted = true
      } catch (deleteError) {
        console.error(
          '[upload.raw.create.rollback-r2] failed',
          {
            user_id: userId,
            object_key: key,
            storage_object_id: storageObjectId,
            error: deleteError instanceof Error
              ? deleteError.message
              : String(deleteError),
          },
        )
      }
    }

    if (storageObjectId && physicalDeleted) {
      try {
        await detachStorageReferencesBySource(
          c.env.DB,
          userId,
          'raw_upload',
          key,
        )

        const finalized =
          await finalizeStorageObjectDeletionByPhysicalKey(
            c.env.DB,
            userId,
            'MEDIA',
            key,
          )

        if (!finalized) {
          throw new Error(
            'El registro no pudo cerrarse como deleted',
          )
        }
      } catch (cleanupError) {
        registryCleanupError = cleanupError

        console.error(
          '[upload.raw.create.rollback-registry] failed',
          {
            user_id: userId,
            object_key: key,
            storage_object_id: storageObjectId,
            error: cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
          },
        )
      }
    } else if (storageObjectId && !physicalDeleted) {
      await setStorageObjectLifecycle(
        c.env.DB,
        userId,
        storageObjectId,
        'orphaned',
      ).catch((lifecycleError) => {
        console.error(
          '[upload.raw.create.mark-orphaned] failed',
          {
            user_id: userId,
            object_key: key,
            storage_object_id: storageObjectId,
            error: lifecycleError instanceof Error
              ? lifecycleError.message
              : String(lifecycleError),
          },
        )
      })
    }

    console.error('[upload.raw.create] failed', {
      user_id: userId,
      object_key: key,
      storage_object_id: storageObjectId,
      physical_created: physicalCreated,
      physical_deleted: physicalDeleted,
      registry_cleanup_error:
        registryCleanupError instanceof Error
          ? registryCleanupError.message
          : (
            registryCleanupError
              ? String(registryCleanupError)
              : null
          ),
      error: error instanceof Error
        ? error.message
        : String(error),
    })

    if (!storageObjectId) {
      return c.json({
        success: false,
        code: 'RAW_UPLOAD_REGISTRY_PREPARE_FAILED',
        error: (
          'No se pudo preparar el registro de almacenamiento. '
          + 'No se creó el archivo físico.'
        ),
      }, 500)
    }

    if (!physicalDeleted) {
      return c.json({
        success: false,
        code: 'RAW_UPLOAD_ORPHANED_PHYSICAL_OBJECT',
        error: (
          'No se completó la operación y el archivo físico '
          + 'permanece contabilizado para reconciliación.'
        ),
      }, 500)
    }

    if (registryCleanupError) {
      return c.json({
        success: false,
        code: 'STORAGE_REGISTRY_CREATE_ROLLBACK_PENDING',
        error: (
          'El archivo físico fue retirado, pero el registro '
          + 'requiere reconciliación.'
        ),
      }, 500)
    }

    return c.json({
      success: false,
      code: 'RAW_UPLOAD_REGISTRATION_FAILED',
      error: 'No se pudo completar el registro del archivo.',
    }, 500)
  }

  return c.json({
    success: true,
    data: {
      url,
      key,
      size_bytes: file.size,
      storage_object_id: storageObjectId,
    },
  }, 201)
})

// Borra un archivo de R2. Acepta el `key` directo o una `url` pública (de la que se
// deriva el key). Guarda de propiedad: solo se permite borrar archivos dentro de
// `uploads/<userId>/` del usuario autenticado — nadie puede borrar archivos de otro.
upload.delete('/', async (c) => {
  const userId = c.get('user').sub

  const body = await c.req
    .json<{ key?: string; url?: string }>()
    .catch(() => ({}))

  let key = body.key?.trim()

  // Si llega una URL pública, derivamos el key quitando el prefijo R2.
  if (!key && body.url) {
    const base = c.env.R2_PUBLIC_BASE_URL.replace(/\/+$/, '')
    key = body.url.trim().replace(`${base}/`, '')
  }

  if (!key) {
    return c.json({
      success: false,
      error: 'key o url es requerido',
    }, 400)
  }

  const prefix = `uploads/${userId}/`

  if (!key.startsWith(prefix)) {
    return c.json({
      success: false,
      error: 'No autorizado para borrar este archivo',
    }, 403)
  }

  const registeredObject =
    await getStorageObjectByPhysicalKey(
      c.env.DB,
      userId,
      'MEDIA',
      key,
    )

  if (registeredObject) {
    const rawSourceObjects =
      await listStorageObjectsForSource(
        c.env.DB,
        userId,
        'raw_upload',
        key,
      )

    const rawSourceObject = rawSourceObjects.find(
      (item) => item.id === registeredObject.id,
    )

    const totalReferenceCount =
      await countStorageObjectReferences(
        c.env.DB,
        registeredObject.id,
      )

    if (!rawSourceObject) {
      if (registeredObject.category !== 'raw_upload') {
        return c.json({
          success: false,
          code: 'STORAGE_OBJECT_NOT_RAW_UPLOAD',
          error: (
            'Este archivo pertenece a otro módulo '
            + 'y no puede eliminarse desde esta ruta.'
          ),
        }, 409)
      }

      // Un raw huérfano puede no tener su referencia porque la
      // vinculación falló después de escribir el objeto en R2.
      if (totalReferenceCount > 0) {
        return c.json({
          success: false,
          code: 'STORAGE_OBJECT_IN_USE',
          error: (
            'El archivo está vinculado a otros registros '
            + 'y no puede eliminarse físicamente.'
          ),
        }, 409)
      }
    } else if (
      rawSourceObject.other_reference_count > 0
    ) {
      return c.json({
        success: false,
        code: 'STORAGE_OBJECT_IN_USE',
        error: (
          'El archivo está vinculado a otros registros '
          + 'y no puede eliminarse físicamente.'
        ),
      }, 409)
    }
  }

  try {
    await c.env.MEDIA.delete(key)
  } catch (error) {
    console.error('[upload.raw.delete.r2] failed', {
      user_id: userId,
      object_key: key,
      error: error instanceof Error
        ? error.message
        : String(error),
    })

    return c.json({
      success: false,
      error: 'No se pudo eliminar el archivo físico.',
    }, 500)
  }

  if (registeredObject) {
    try {
      await detachStorageReferencesBySource(
        c.env.DB,
        userId,
        'raw_upload',
        key,
      )

      const finalized =
        await finalizeStorageObjectDeletionByPhysicalKey(
          c.env.DB,
          userId,
          'MEDIA',
          key,
        )

      if (!finalized) {
        throw new Error(
          'El objeto conserva referencias después del borrado físico',
        )
      }
    } catch (error) {
      console.error('[upload.raw.delete.registry] failed', {
        user_id: userId,
        object_key: key,
        storage_object_id: registeredObject.id,
        error: error instanceof Error
          ? error.message
          : String(error),
      })

      return c.json({
        success: false,
        code: 'STORAGE_REGISTRY_DELETE_PENDING',
        error: (
          'El archivo físico fue eliminado, pero el registro '
          + 'de almacenamiento requiere reconciliación.'
        ),
      }, 500)
    }
  }

  return c.json({
    success: true,
    data: {
      deleted: true,
      storage_registry: registeredObject
        ? 'deleted'
        : 'legacy_unregistered',
    },
  })
})

export default upload
