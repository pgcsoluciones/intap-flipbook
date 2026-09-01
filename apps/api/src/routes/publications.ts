import { Hono } from 'hono'
import { jwtMiddleware } from '../middleware/jwt'
import { signJwt } from '../lib/jwt'
import { getUserPlan, checkPublicationLimit, checkSoundAllowed } from '../lib/plans'
import { slugify, uniqueSlug } from './auth'
import { countOpenProductDetailReferences, parseCanvasJson } from '../lib/productDetailsCanvas'
import {
  buildJsonColumnUpdateStatement,
  buildMappedCloneInsertStatement,
  buildMappedStorageReferenceStatement,
  cloneMapPairs,
  normalizeCloneColumns,
  quoteCloneIdentifier,
  remapPublicationCanvasJson,
  type CloneSqlStatement,
} from '../lib/publicationClone'
import type { Env } from '../index'
import type { AuthVariables } from '../middleware/jwt'

type Variables = AuthVariables

const publications = new Hono<{ Bindings: Env; Variables: Variables }>()

publications.use('*', jwtMiddleware)

const SOCIAL_TEXT_LIMITS = {
  social_title: 120,
  social_description: 300,
  social_image_url: 2048,
  social_image_source_url: 2048,
  social_image_crop_json: 4096,
} as const

type SocialField = keyof typeof SOCIAL_TEXT_LIMITS

function hasOwn(body: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, field)
}

function normalizeOptionalText(
  body: Record<string, unknown>,
  field: SocialField,
): { ok: true; present: boolean; value: string | null } | { ok: false; error: string } {
  if (!hasOwn(body, field)) return { ok: true, present: false, value: null }

  const value = body[field]
  if (value === null) return { ok: true, present: true, value: null }
  if (typeof value !== 'string') {
    return { ok: false, error: `${field} debe ser texto, null u omitido` }
  }

  const trimmed = value.trim()
  if (!trimmed) return { ok: true, present: true, value: null }
  if (trimmed.length > SOCIAL_TEXT_LIMITS[field]) {
    return { ok: false, error: `${field} no puede exceder ${SOCIAL_TEXT_LIMITS[field]} caracteres` }
  }

  return { ok: true, present: true, value: trimmed }
}

function normalizeOptionalHttpsUrl(
  body: Record<string, unknown>,
  field: 'social_image_url' | 'social_image_source_url',
): { ok: true; present: boolean; value: string | null } | { ok: false; error: string } {
  const normalized = normalizeOptionalText(body, field)
  if (!normalized.ok || !normalized.present || normalized.value === null) return normalized

  try {
    const url = new URL(normalized.value)
    if (url.protocol !== 'https:') {
      return { ok: false, error: `${field} debe ser una URL absoluta https` }
    }
  } catch {
    return { ok: false, error: `${field} debe ser una URL absoluta https` }
  }

  return normalized
}

function normalizeOptionalCropJson(
  body: Record<string, unknown>,
): { ok: true; present: boolean; value: string | null } | { ok: false; error: string } {
  const normalized = normalizeOptionalText(body, 'social_image_crop_json')
  if (!normalized.ok || !normalized.present || normalized.value === null) return normalized

  let parsed: unknown
  try {
    parsed = JSON.parse(normalized.value)
  } catch {
    return { ok: false, error: 'social_image_crop_json debe ser JSON válido' }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'social_image_crop_json debe ser un objeto JSON' }
  }

  const crop = parsed as Record<string, unknown>
  if (
    typeof crop.zoom !== 'number' ||
    !Number.isFinite(crop.zoom) ||
    crop.zoom < 1 ||
    crop.zoom > 5
  ) {
    return { ok: false, error: 'social_image_crop_json.zoom debe ser un número entre 1 y 5' }
  }
  if (typeof crop.offsetX !== 'number' || !Number.isFinite(crop.offsetX)) {
    return { ok: false, error: 'social_image_crop_json.offsetX debe ser un número finito' }
  }
  if (typeof crop.offsetY !== 'number' || !Number.isFinite(crop.offsetY)) {
    return { ok: false, error: 'social_image_crop_json.offsetY debe ser un número finito' }
  }

  return { ok: true, present: true, value: JSON.stringify(crop) }
}


async function uniquePublicationSlugExcluding(
  db: D1Database,
  rawValue: string,
  excludedPublicationId: string,
): Promise<string> {
  const base = slugify(rawValue)
  if (!base) throw new Error('El slug debe contener letras o números')

  let candidate = base
  let suffixNumber = 2
  while (true) {
    const collision = await db.prepare(
      `SELECT id FROM publications
       WHERE public_slug = ? AND id <> ?
       LIMIT 1`,
    ).bind(candidate, excludedPublicationId).first<{ id: string }>()
    if (!collision) return candidate

    const suffix = `-${suffixNumber++}`
    candidate = `${base.slice(0, Math.max(1, 60 - suffix.length))}${suffix}`
  }
}

async function cloneTableColumns(db: D1Database, table: string): Promise<string[]> {
  const quoted = quoteCloneIdentifier(table)
  try {
    const { results } = await db.prepare(`PRAGMA table_info(${quoted})`).all<{ name: string }>()
    return normalizeCloneColumns(results ?? [])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/no such table/i.test(message)) return []
    throw error
  }
}

async function optionalCloneRows<T>(
  db: D1Database,
  sql: string,
  bindings: unknown[] = [],
): Promise<T[]> {
  try {
    const statement = db.prepare(sql)
    const { results } = bindings.length
      ? await statement.bind(...(bindings as any[])).all<T>()
      : await statement.all<T>()
    return results ?? []
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/no such table/i.test(message)) return []
    throw error
  }
}

function prepareCloneSql(db: D1Database, statement: CloneSqlStatement | null): D1PreparedStatement | null {
  if (!statement) return null
  return db.prepare(statement.sql).bind(...(statement.bindings as any[]))
}

function clonePublicationInsertStatement(input: {
  columns: string[]
  sourcePublicationId: string
  userId: string
  newPublicationId: string
  title: string
  publicSlug: string
  soundEnabled: number
}): CloneSqlStatement {
  const bindings: unknown[] = []
  const selectExpressions = input.columns.map((column) => {
    switch (column) {
      case 'id':
        bindings.push(input.newPublicationId)
        return '?'
      case 'user_id':
        bindings.push(input.userId)
        return '?'
      case 'title':
        bindings.push(input.title)
        return '?'
      case 'public_slug':
        bindings.push(input.publicSlug)
        return '?'
      case 'status':
        return "'draft'"
      case 'views_count':
        return '0'
      case 'deleted_at':
        return 'NULL'
      case 'created_at':
      case 'updated_at':
        return "datetime('now')"
      case 'sound_enabled':
        bindings.push(input.soundEnabled)
        return '?'
      default:
        return `source.${quoteCloneIdentifier(column)}`
    }
  })

  bindings.push(input.sourcePublicationId, input.userId)
  return {
    sql: `INSERT INTO publications (${input.columns.map(quoteCloneIdentifier).join(', ')})\n` +
      `SELECT ${selectExpressions.join(', ')}\n` +
      `FROM publications AS source\n` +
      `WHERE source.id = ? AND source.user_id = ?`,
    bindings,
  }
}


function cloneProductInternalName(value: unknown, publicationId: string): string {
  const base = String(value ?? '').trim() || 'Producto'
  const suffix = ` · copia ${publicationId.slice(0, 12)}`
  return `${base.slice(0, Math.max(1, 160 - suffix.length))}${suffix}`
}

async function cleanupStagedProductDetails(
  db: D1Database,
  tenantId: string,
  ids: number[],
): Promise<void> {
  if (!ids.length) return
  await db.prepare(
    `DELETE FROM product_details
     WHERE tenant_id = ?
       AND id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`,
  ).bind(tenantId, JSON.stringify(ids)).run()
}

// GET /api/publications — solo las activas (deleted_at IS NULL)
publications.get('/', async (c) => {
  const userId = c.get('user').sub
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, COUNT(pg.id) as page_count
     FROM publications p
     LEFT JOIN pages pg ON pg.publication_id = p.id
     WHERE p.user_id = ? AND p.deleted_at IS NULL
     GROUP BY p.id
     ORDER BY p.updated_at DESC`,
  )
    .bind(userId)
    .all()
  return c.json({ success: true, data: results })
})

// GET /api/publications/trash — publicaciones en papelera del tenant
publications.get('/trash', async (c) => {
  const userId = c.get('user').sub
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, COUNT(pg.id) as page_count
     FROM publications p
     LEFT JOIN pages pg ON pg.publication_id = p.id
     WHERE p.user_id = ? AND p.deleted_at IS NOT NULL
     GROUP BY p.id
     ORDER BY p.deleted_at DESC`,
  )
    .bind(userId)
    .all()
  return c.json({ success: true, data: results })
})

// POST /api/publications
publications.post('/', async (c) => {
  const userId = c.get('user').sub
  const body = await c.req.json<{
    title: string
    description?: string
    category?: string
    public_slug?: unknown
    sound_enabled?: boolean
  }>()

  if (!body.title?.trim()) {
    return c.json({ success: false, error: 'El título es requerido' }, 400)
  }

  const { plan, customLimits } = await getUserPlan(c.env.DB, userId)

  const pubLimitError = await checkPublicationLimit(c.env.DB, userId, plan, customLimits)
  if (pubLimitError) return c.json({ success: false, error: pubLimitError }, 403)

  // If user explicitly requests sound and plan doesn't support it, silently disable
  const wantsSound = body.sound_enabled !== false
  const soundAllowed = plan.sound_enabled === 1
  const soundValue = wantsSound && soundAllowed ? 1 : 0

  const id = crypto.randomUUID()
  // Slug legible derivado del título (único; agrega -2, -3… si colisiona).
  const slug = await uniqueSlug(c.env.DB, 'publications', slugify(body.title.trim()))

  await c.env.DB.prepare(
    `INSERT INTO publications (id, user_id, title, description, category, public_slug, sound_enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, userId, body.title.trim(), body.description ?? null, body.category ?? null, slug, soundValue)
    .run()

  const pub = await c.env.DB.prepare('SELECT * FROM publications WHERE id = ?').bind(id).first()
  return c.json({
    success: true,
    data: pub,
    ...(wantsSound && !soundAllowed ? { warning: checkSoundAllowed(plan) } : {}),
  }, 201)
})


// POST /api/publications/:id/duplicate — copia editable e independiente del catálogo.
// PROTECTED: no copia analítica, respuestas, leads, reservas ni historial transaccional.
publications.post('/:id/duplicate', async (c) => {
  const userId = c.get('user').sub
  const sourcePublicationId = c.req.param('id')
  const body = await c.req.json<{ title?: unknown; public_slug?: unknown }>().catch(() => null)
  if (!body || typeof body !== 'object') {
    return c.json({ success: false, error: 'JSON inválido' }, 400)
  }

  if (typeof body.title !== 'string' || !body.title.trim()) {
    return c.json({ success: false, error: 'El nombre de la copia es requerido' }, 400)
  }
  const title = body.title.trim()
  if (title.length > 120) {
    return c.json({ success: false, error: 'El nombre no puede exceder 120 caracteres' }, 400)
  }
  if (body.public_slug !== undefined && typeof body.public_slug !== 'string') {
    return c.json({ success: false, error: 'El slug debe ser texto' }, 400)
  }

  const source = await c.env.DB.prepare(
    `SELECT * FROM publications
     WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
  ).bind(sourcePublicationId, userId).first<Record<string, any>>()
  if (!source) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)

  const { plan, customLimits } = await getUserPlan(c.env.DB, userId)
  const publicationLimitError = await checkPublicationLimit(c.env.DB, userId, plan, customLimits)
  if (publicationLimitError) return c.json({ success: false, error: publicationLimitError }, 403)

  const { results: sourcePagesResult } = await c.env.DB.prepare(
    'SELECT * FROM pages WHERE publication_id = ? ORDER BY page_number ASC, id ASC',
  ).bind(sourcePublicationId).all<Record<string, any>>()
  const sourcePages = sourcePagesResult ?? []
  const effectiveMaxPages = customLimits.max_pages ?? plan.max_pages_per_pub
  if (effectiveMaxPages != null && sourcePages.length > effectiveMaxPages) {
    return c.json({
      success: false,
      error: `Tu plan ${plan.name} permite máximo ${effectiveMaxPages} páginas por publicación. La copia tendría ${sourcePages.length}.`,
    }, 403)
  }

  const slugBase = slugify((body.public_slug as string | undefined)?.trim() || title)
  if (!slugBase) {
    return c.json({ success: false, error: 'El slug debe contener letras o números' }, 400)
  }
  const publicSlug = await uniqueSlug(c.env.DB, 'publications', slugBase)
  const newPublicationId = crypto.randomUUID()
  const soundEnabled = source.sound_enabled && plan.sound_enabled === 1 ? 1 : 0

  const pageIdMap = new Map<string, string>()
  sourcePages.forEach((page) => pageIdMap.set(String(page.id), crypto.randomUUID()))

  const sourceMarkers = await optionalCloneRows<Record<string, any>>(
    c.env.DB,
    'SELECT * FROM dynamic_markers WHERE publication_id = ? ORDER BY created_at ASC, id ASC',
    [sourcePublicationId],
  )
  const markerIdMap = new Map<string, string>()
  sourceMarkers.forEach((marker) => markerIdMap.set(String(marker.id), crypto.randomUUID()))

  const sourceMediaFolders = await optionalCloneRows<Record<string, any>>(
    c.env.DB,
    'SELECT * FROM media_folders WHERE tenant_id = ? AND publication_id = ? ORDER BY created_at ASC, id ASC',
    [userId, sourcePublicationId],
  )
  const mediaFolderIdMap = new Map<string, string>()
  sourceMediaFolders.forEach((folder) => mediaFolderIdMap.set(String(folder.id), crypto.randomUUID()))

  const sourceMediaAssetsAll = await optionalCloneRows<Record<string, any>>(
    c.env.DB,
    'SELECT * FROM media_assets WHERE tenant_id = ? AND publication_id = ? ORDER BY created_at ASC, id ASC',
    [userId, sourcePublicationId],
  )
  const sourceMediaAssets = sourceMediaAssetsAll.filter((asset) => !asset.deleted_at && asset.is_hidden !== 1)
  const mediaAssetIdMap = new Map<string, string>()
  sourceMediaAssets.forEach((asset) => mediaAssetIdMap.set(String(asset.id), crypto.randomUUID()))

  const sourceUnits = await optionalCloneRows<Record<string, any>>(
    c.env.DB,
    'SELECT * FROM units WHERE publication_id = ? ORDER BY created_at ASC, id ASC',
    [sourcePublicationId],
  )
  const unitIdMap = new Map<string, string>()
  sourceUnits.forEach((unit) => unitIdMap.set(String(unit.id), crypto.randomUUID()))


  const usedProductDetailIds = new Set<number>()
  sourcePages.forEach((page) => {
    const refs = countOpenProductDetailReferences(parseCanvasJson(page.canvas_json))
    refs.forEach((_count, detailId) => usedProductDetailIds.add(detailId))
  })

  const sourceProductDetails = usedProductDetailIds.size
    ? await optionalCloneRows<Record<string, any>>(
        c.env.DB,
        `SELECT * FROM product_details
         WHERE tenant_id = ?
           AND id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
         ORDER BY id ASC`,
        [userId, JSON.stringify(Array.from(usedProductDetailIds))],
      )
    : []

  if (sourceProductDetails.length !== usedProductDetailIds.size) {
    return c.json({
      success: false,
      error: 'El catálogo contiene detalles de producto heredados que ya no están disponibles. Corrige esos vínculos antes de duplicar.',
    }, 409)
  }

  const [
    publicationColumns,
    pageColumns,
    markerColumns,
    mediaFolderColumns,
    mediaAssetColumns,
    unitColumns,
    storageReferenceColumns,
  ] = await Promise.all([
    cloneTableColumns(c.env.DB, 'publications'),
    cloneTableColumns(c.env.DB, 'pages'),
    cloneTableColumns(c.env.DB, 'dynamic_markers'),
    cloneTableColumns(c.env.DB, 'media_folders'),
    cloneTableColumns(c.env.DB, 'media_assets'),
    cloneTableColumns(c.env.DB, 'units'),
    cloneTableColumns(c.env.DB, 'storage_object_references'),
  ])

  if (!publicationColumns.length || !pageColumns.length) {
    return c.json({ success: false, error: 'La base de datos no está lista para duplicar publicaciones' }, 500)
  }

  const statements: D1PreparedStatement[] = []
  const addStatement = (statement: CloneSqlStatement | null) => {
    const prepared = prepareCloneSql(c.env.DB, statement)
    if (prepared) statements.push(prepared)
  }

  addStatement(clonePublicationInsertStatement({
    columns: publicationColumns,
    sourcePublicationId,
    userId,
    newPublicationId,
    title,
    publicSlug,
    soundEnabled,
  }))

  addStatement(buildMappedCloneInsertStatement({
    table: 'pages',
    columns: pageColumns,
    mapRows: sourcePages.map((page) => ({
      old_id: String(page.id),
      new_id: pageIdMap.get(String(page.id))!,
    })),
    mapFields: ['old_id', 'new_id'],
    overrides: {
      id: { sql: 'map.new_id' },
      publication_id: { sql: '?', bindings: [newPublicationId] },
      deleted_at: { sql: 'NULL' },
      created_at: { sql: "datetime('now')" },
      updated_at: { sql: "datetime('now')" },
    },
  }))

  if (mediaFolderColumns.length) {
    addStatement(buildMappedCloneInsertStatement({
      table: 'media_folders',
      columns: mediaFolderColumns,
      mapRows: sourceMediaFolders.map((folder) => ({
        old_id: String(folder.id),
        new_id: mediaFolderIdMap.get(String(folder.id))!,
      })),
      mapFields: ['old_id', 'new_id'],
      overrides: {
        id: { sql: 'map.new_id' },
        publication_id: { sql: '?', bindings: [newPublicationId] },
        created_at: { sql: "datetime('now')" },
        updated_at: { sql: "datetime('now')" },
      },
    }))
  }

  if (mediaAssetColumns.length) {
    addStatement(buildMappedCloneInsertStatement({
      table: 'media_assets',
      columns: mediaAssetColumns,
      mapRows: sourceMediaAssets.map((asset) => ({
        old_id: String(asset.id),
        new_id: mediaAssetIdMap.get(String(asset.id))!,
        new_folder_id: asset.folder_id ? (mediaFolderIdMap.get(String(asset.folder_id)) ?? null) : null,
      })),
      mapFields: ['old_id', 'new_id', 'new_folder_id'],
      overrides: {
        id: { sql: 'map.new_id' },
        publication_id: { sql: '?', bindings: [newPublicationId] },
        folder_id: { sql: 'map.new_folder_id' },
        deleted_at: { sql: 'NULL' },
        is_hidden: { sql: '0' },
        created_at: { sql: "datetime('now')" },
        updated_at: { sql: "datetime('now')" },
      },
    }))
  }

  if (markerColumns.length) {
    addStatement(buildMappedCloneInsertStatement({
      table: 'dynamic_markers',
      columns: markerColumns,
      mapRows: sourceMarkers.map((marker) => ({
        old_id: String(marker.id),
        new_id: markerIdMap.get(String(marker.id))!,
        new_page_id: marker.page_id ? (pageIdMap.get(String(marker.page_id)) ?? null) : null,
      })),
      mapFields: ['old_id', 'new_id', 'new_page_id'],
      overrides: {
        id: { sql: 'map.new_id' },
        publication_id: { sql: '?', bindings: [newPublicationId] },
        page_id: { sql: 'map.new_page_id' },
        cloned_from_marker_id: { sql: 'source.id' },
        created_at: { sql: "datetime('now')" },
        updated_at: { sql: "datetime('now')" },
      },
    }))
  }

  if (unitColumns.length) {
    addStatement(buildMappedCloneInsertStatement({
      table: 'units',
      columns: unitColumns,
      mapRows: sourceUnits.map((unit) => ({
        old_id: String(unit.id),
        new_id: unitIdMap.get(String(unit.id))!,
        new_page_id: unit.page_id ? (pageIdMap.get(String(unit.page_id)) ?? null) : null,
      })),
      mapFields: ['old_id', 'new_id', 'new_page_id'],
      overrides: {
        id: { sql: 'map.new_id' },
        publication_id: { sql: '?', bindings: [newPublicationId] },
        page_id: { sql: 'map.new_page_id' },
        created_at: { sql: "datetime('now')" },
        updated_at: { sql: "datetime('now')" },
      },
    }))
  }

  const productDetailIdMap = new Map<number, number>()
  const stagedProductDetailIds: number[] = []

  try {
    if (sourceProductDetails.length) {
      const productResults = await c.env.DB.batch(sourceProductDetails.map((detail) => c.env.DB.prepare(
        `INSERT INTO product_details (
          tenant_id,
          internal_name,
          title,
          description,
          price,
          image_url,
          accent_color,
          cta_type,
          cta_label,
          cta_target,
          status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        userId,
        cloneProductInternalName(detail.internal_name, newPublicationId),
        detail.title,
        detail.description ?? null,
        detail.price ?? null,
        detail.image_url ?? null,
        detail.accent_color ?? '#4F46E5',
        detail.cta_type ?? null,
        detail.cta_label ?? null,
        detail.cta_target ?? null,
        detail.status === 'active' ? 'active' : 'inactive',
      )))

      productResults.forEach((result, index) => {
        const newId = Number(result.meta.last_row_id)
        const oldId = Number(sourceProductDetails[index]?.id)
        if (!Number.isInteger(newId) || newId <= 0 || !Number.isInteger(oldId) || oldId <= 0) {
          throw new Error('D1 no devolvió un id válido al clonar un detalle de producto')
        }
        stagedProductDetailIds.push(newId)
        productDetailIdMap.set(oldId, newId)
      })

      if (productDetailIdMap.size !== sourceProductDetails.length) {
        throw new Error('No se pudo completar el mapa de detalles de producto')
      }
    }

    if (pageColumns.includes('canvas_json')) {
      addStatement(buildJsonColumnUpdateStatement({
        table: 'pages',
        valueColumn: 'canvas_json',
        rows: sourcePages.map((page) => ({
          id: pageIdMap.get(String(page.id))!,
          value: remapPublicationCanvasJson(page.canvas_json, markerIdMap, productDetailIdMap),
        })),
      }))
    }

    if (storageReferenceColumns.length) {
      const storageMaps = [
        [{ old_id: sourcePublicationId, new_id: newPublicationId }],
        cloneMapPairs(pageIdMap),
        cloneMapPairs(markerIdMap),
        cloneMapPairs(mediaFolderIdMap),
        cloneMapPairs(mediaAssetIdMap),
        cloneMapPairs(unitIdMap),
      ]
      storageMaps.forEach((mapRows) => {
        addStatement(buildMappedStorageReferenceStatement(mapRows, newPublicationId, sourcePublicationId))
      })
    }

    // El catálogo y sus dependencias propias se escriben atómicamente. Los
    // product_details heredados son tenant-global y se preparan antes solo para
    // obtener sus IDs AUTOINCREMENT; si este batch falla, se eliminan abajo.
    await c.env.DB.batch(statements)
  } catch (error) {
    if (stagedProductDetailIds.length) {
      try {
        await cleanupStagedProductDetails(c.env.DB, userId, stagedProductDetailIds)
      } catch (cleanupError) {
        console.error('[publications.duplicate] staged product detail cleanup failed', {
          source_publication_id: sourcePublicationId,
          target_publication_id: newPublicationId,
          user_id: userId,
          staged_product_detail_ids: stagedProductDetailIds,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        })
      }
    }

    console.error('[publications.duplicate] transaction failed', {
      source_publication_id: sourcePublicationId,
      target_publication_id: newPublicationId,
      user_id: userId,
      error: error instanceof Error ? error.message : String(error),
    })
    return c.json({ success: false, error: 'No se pudo completar la duplicación. El original no fue modificado.' }, 500)
  }

  const created = await c.env.DB.prepare(
    `SELECT p.*, COUNT(pg.id) AS page_count
     FROM publications p
     LEFT JOIN pages pg ON pg.publication_id = p.id
     WHERE p.id = ? AND p.user_id = ?
     GROUP BY p.id`,
  ).bind(newPublicationId, userId).first<Record<string, any>>()

  return c.json({
    success: true,
    data: created,
    clone_summary: {
      pages: sourcePages.length,
      dynamic_markers: sourceMarkers.length,
      media_folders: sourceMediaFolders.length,
      media_assets: sourceMediaAssets.length,
      product_details: sourceProductDetails.length,
      legacy_product_details_reused: false,
      units: sourceUnits.length,
      copied_history: false,
      reused_physical_media: true,
    },
    ...(source.sound_enabled && !soundEnabled ? { warning: checkSoundAllowed(plan) } : {}),
  }, 201)
})

// GET /api/publications/:id/preview-access
// Preview-only: issues a short-lived, read-only viewer token for draft QA without publishing.
publications.get('/:id/preview-access', async (c) => {
  if ((c.env.APP_ENV ?? 'production') !== 'preview') {
    return c.json({ success: false, error: 'Preview access is only available in preview' }, 404)
  }

  const userId = c.get('user').sub
  const pub = await c.env.DB.prepare(
    `SELECT id, user_id, public_slug
     FROM publications
     WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
  )
    .bind(c.req.param('id'), userId)
    .first<{ id: string; user_id: string; public_slug: string | null }>()

  if (!pub) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)
  if (!pub.public_slug) return c.json({ success: false, error: 'La publicación no tiene slug público' }, 400)

  const { count } = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM pages WHERE publication_id = ?',
  )
    .bind(pub.id)
    .first<{ count: number }>() ?? { count: 0 }

  if (count < 1) {
    return c.json({ success: false, error: 'La publicación debe tener al menos una página para vista previa' }, 400)
  }

  const token = await signJwt({
    sub: userId,
    email: 'preview@intap.local',
    kind: 'publication_preview',
    publication_id: pub.id,
    public_slug: pub.public_slug,
  } as any, c.env.JWT_SECRET, 1 / 24)

  return c.json({
    success: true,
    data: {
      token,
      public_slug: pub.public_slug,
      expires_in_seconds: 3600,
    },
  })
})

// GET /api/publications/:id
publications.get('/:id', async (c) => {
  const userId = c.get('user').sub
  const pub = await c.env.DB.prepare('SELECT * FROM publications WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), userId)
    .first()
  if (!pub) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)

  const { results: pages } = await c.env.DB.prepare(
    'SELECT * FROM pages WHERE publication_id = ? ORDER BY page_number ASC',
  )
    .bind(c.req.param('id'))
    .all()

  return c.json({ success: true, data: { ...pub, pages } })
})

// PUT /api/publications/:id
publications.put('/:id', async (c) => {
  const userId = c.get('user').sub
  const body = await c.req.json<{
    title?: string
    description?: string
    category?: string
    sound_enabled?: boolean
    cover_image_url?: string
    project_phone?: string
    project_whatsapp?: string
    project_location?: string
    project_address?: string
    project_developer?: string
    project_website?: string
    social_title?: unknown
    social_description?: unknown
    social_image_url?: unknown
    social_image_source_url?: unknown
    social_image_crop_json?: unknown
  }>()
  const rawBody = body as Record<string, unknown>

  const pub = await c.env.DB.prepare('SELECT id FROM publications WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), userId)
    .first()
  if (!pub) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)


  const publicSlugPresent = hasOwn(rawBody, 'public_slug')
  let publicSlugValue: string | null = null
  if (publicSlugPresent) {
    if (typeof rawBody.public_slug !== 'string') {
      return c.json({ success: false, error: 'public_slug debe ser texto' }, 400)
    }
    try {
      publicSlugValue = await uniquePublicationSlugExcluding(
        c.env.DB,
        rawBody.public_slug,
        c.req.param('id'),
      )
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 400)
    }
  }

  let soundValue: number | null = null
  let soundWarning: string | undefined

  if (body.sound_enabled !== undefined) {
    if (body.sound_enabled) {
      const { plan } = await getUserPlan(c.env.DB, userId)
      const err = checkSoundAllowed(plan)
      if (err) {
        soundValue = 0
        soundWarning = err
      } else {
        soundValue = 1
      }
    } else {
      soundValue = 0
    }
  }

  const socialTitle = normalizeOptionalText(rawBody, 'social_title')
  if (!socialTitle.ok) return c.json({ success: false, error: socialTitle.error }, 400)
  const socialDescription = normalizeOptionalText(rawBody, 'social_description')
  if (!socialDescription.ok) return c.json({ success: false, error: socialDescription.error }, 400)
  const socialImageUrl = normalizeOptionalHttpsUrl(rawBody, 'social_image_url')
  if (!socialImageUrl.ok) return c.json({ success: false, error: socialImageUrl.error }, 400)
  const socialImageSourceUrl = normalizeOptionalHttpsUrl(rawBody, 'social_image_source_url')
  if (!socialImageSourceUrl.ok) return c.json({ success: false, error: socialImageSourceUrl.error }, 400)
  const socialImageCropJson = normalizeOptionalCropJson(rawBody)
  if (!socialImageCropJson.ok) return c.json({ success: false, error: socialImageCropJson.error }, 400)

  const socialChanged =
    socialTitle.present ||
    socialDescription.present ||
    socialImageUrl.present ||
    socialImageSourceUrl.present ||
    socialImageCropJson.present

  try {
    await c.env.DB.prepare(
    `UPDATE publications
     SET title = COALESCE(?, title),
         description = COALESCE(?, description),
         category = COALESCE(?, category),
         public_slug = COALESCE(?, public_slug),
         sound_enabled = COALESCE(?, sound_enabled),
         cover_image_url = COALESCE(?, cover_image_url),
         project_phone = COALESCE(?, project_phone),
         project_whatsapp = COALESCE(?, project_whatsapp),
         project_location = COALESCE(?, project_location),
         project_address = COALESCE(?, project_address),
         project_developer = COALESCE(?, project_developer),
         project_website = COALESCE(?, project_website),
         social_title = CASE WHEN ? THEN ? ELSE social_title END,
         social_description = CASE WHEN ? THEN ? ELSE social_description END,
         social_image_url = CASE WHEN ? THEN ? ELSE social_image_url END,
         social_image_source_url = CASE WHEN ? THEN ? ELSE social_image_source_url END,
         social_image_crop_json = CASE WHEN ? THEN ? ELSE social_image_crop_json END,
         social_updated_at = CASE WHEN ? THEN datetime('now') ELSE social_updated_at END,
         updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(
      body.title ?? null,
      body.description ?? null,
      body.category ?? null,
      publicSlugValue,
      soundValue,
      body.cover_image_url ?? null,
      body.project_phone ?? null,
      body.project_whatsapp ?? null,
      body.project_location ?? null,
      body.project_address ?? null,
      body.project_developer ?? null,
      body.project_website ?? null,
      socialTitle.present ? 1 : 0,
      socialTitle.value,
      socialDescription.present ? 1 : 0,
      socialDescription.value,
      socialImageUrl.present ? 1 : 0,
      socialImageUrl.value,
      socialImageSourceUrl.present ? 1 : 0,
      socialImageSourceUrl.value,
      socialImageCropJson.present ? 1 : 0,
      socialImageCropJson.value,
      socialChanged ? 1 : 0,
      c.req.param('id'),
    )
    .run()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[publications.update] failed', {
      publication_id: c.req.param('id'),
      user_id: userId,
      public_slug_present: publicSlugPresent,
      error: message,
    })
    return c.json({
      success: false,
      error: (c.env.APP_ENV ?? 'production') === 'preview'
        ? `No se pudo actualizar la publicación en Preview: ${message}`
        : 'No se pudo actualizar la publicación',
    }, 500)
  }

  const updated = await c.env.DB.prepare('SELECT * FROM publications WHERE id = ?')
    .bind(c.req.param('id'))
    .first()
  return c.json({ success: true, data: updated, ...(soundWarning ? { warning: soundWarning } : {}) })
})

// PATCH /api/publications/:id/restore — recupera de la papelera
// (rutas específicas van ANTES de /:id para evitar que Hono las capture con el parámetro dinámico)
publications.patch('/:id/restore', async (c) => {
  const userId = c.get('user').sub
  const pub = await c.env.DB.prepare(
    'SELECT id FROM publications WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL',
  )
    .bind(c.req.param('id'), userId)
    .first()
  if (!pub) return c.json({ success: false, error: 'Publicación no encontrada en la papelera' }, 404)

  await c.env.DB.prepare(
    `UPDATE publications SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(c.req.param('id'))
    .run()

  return c.json({ success: true, data: { restored: true } })
})

// DELETE /api/publications/:id/permanent — borrado físico definitivo e irreversible
publications.delete('/:id/permanent', async (c) => {
  try {
    const userId = c.get('user').sub
    const pubId = c.req.param('id')

    const pub = await c.env.DB.prepare(
      'SELECT id FROM publications WHERE id = ? AND user_id = ?',
    )
      .bind(pubId, userId)
      .first()

    if (!pub) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)

    // Borrar tablas hijas (ignorar si la tabla aún no existe en esta instancia de D1)
    const safeDelete = async (sql: string) => {
      try { await c.env.DB.prepare(sql).bind(pubId).run() } catch { /* tabla opcional */ }
    }
    await safeDelete('DELETE FROM page_events WHERE publication_id = ?')
    await safeDelete('DELETE FROM publication_views WHERE publication_id = ?')
    await safeDelete('DELETE FROM form_responses WHERE publication_id = ?')
    await c.env.DB.prepare('DELETE FROM pages WHERE publication_id = ?').bind(pubId).run()
    await c.env.DB.prepare('DELETE FROM publications WHERE id = ?').bind(pubId).run()

    return c.json({ success: true, data: { deleted: true } })
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    return c.json({ success: false, error: 'Error interno al eliminar: ' + msg }, 500)
  }
})

// DELETE /api/publications/:id — soft delete: mueve a papelera (no borra datos)
publications.delete('/:id', async (c) => {
  const userId = c.get('user').sub
  const pub = await c.env.DB.prepare(
    'SELECT id FROM publications WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
  )
    .bind(c.req.param('id'), userId)
    .first()
  if (!pub) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)

  await c.env.DB.prepare(
    `UPDATE publications SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(c.req.param('id'))
    .run()

  return c.json({ success: true, data: { trashed: true } })
})

// POST /api/publications/:id/publish
publications.post('/:id/publish', async (c) => {
  const userId = c.get('user').sub
  const pub = await c.env.DB.prepare('SELECT id FROM publications WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), userId)
    .first()
  if (!pub) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)

  // Must have at least one page
  const { count } = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM pages WHERE publication_id = ?'
  ).bind(c.req.param('id')).first<{ count: number }>() ?? { count: 0 }
  if (count === 0) {
    return c.json({ success: false, error: 'La publicación debe tener al menos una página antes de publicarse' }, 400)
  }

  await c.env.DB.prepare(
    `UPDATE publications SET status = 'published', updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(c.req.param('id'))
    .run()

  const updated = await c.env.DB.prepare('SELECT * FROM publications WHERE id = ?')
    .bind(c.req.param('id'))
    .first()
  return c.json({ success: true, data: updated })
})

export default publications
