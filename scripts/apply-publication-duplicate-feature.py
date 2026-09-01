from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f'No se encontró anchor: {label}')
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# API: publications route
# ---------------------------------------------------------------------------
p = Path('apps/api/src/routes/publications.ts')
s = p.read_text()

s = replace_once(
    s,
    "import { slugify, uniqueSlug } from './auth'\nimport type { Env } from '../index'",
    "import { slugify, uniqueSlug } from './auth'\n"
    "import { countOpenProductDetailReferences, parseCanvasJson } from '../lib/productDetailsCanvas'\n"
    "import {\n"
    "  buildJsonColumnUpdateStatement,\n"
    "  buildMappedCloneInsertStatement,\n"
    "  buildMappedStorageReferenceStatement,\n"
    "  cloneMapPairs,\n"
    "  cloneNumericMapPairs,\n"
    "  normalizeCloneColumns,\n"
    "  quoteCloneIdentifier,\n"
    "  remapPublicationCanvasJson,\n"
    "  type CloneSqlStatement,\n"
    "} from '../lib/publicationClone'\n"
    "import type { Env } from '../index'",
    'publications imports',
)

helpers = r'''
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

function randomSqlitePositiveInteger(used: Set<number>): number {
  const values = new Uint32Array(2)
  let candidate = 0
  do {
    crypto.getRandomValues(values)
    const high = values[0] & 0x001fffff
    candidate = high * 0x100000000 + values[1]
  } while (!candidate || used.has(candidate))
  used.add(candidate)
  return candidate
}

function cloneProductInternalName(value: unknown, publicationId: string): string {
  const base = String(value ?? '').trim() || 'Producto'
  const suffix = ` · copia ${publicationId.slice(0, 8)}`
  return `${base.slice(0, Math.max(1, 160 - suffix.length))}${suffix}`
}

function storageReferencePairsFromNumericMap(map: ReadonlyMap<number, number>) {
  return cloneNumericMapPairs(map).map((item) => ({
    old_id: String(item.old_id),
    new_id: String(item.new_id),
  }))
}
'''

s = replace_once(
    s,
    '// GET /api/publications — solo las activas (deleted_at IS NULL)',
    helpers + '\n// GET /api/publications — solo las activas (deleted_at IS NULL)',
    'publication clone helpers insertion',
)

duplicate_route = r'''
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
  const usedGeneratedProductIds = new Set<number>()
  const productDetailIdMap = new Map<number, number>()
  sourceProductDetails.forEach((detail) => {
    productDetailIdMap.set(Number(detail.id), randomSqlitePositiveInteger(usedGeneratedProductIds))
  })

  const [
    publicationColumns,
    pageColumns,
    markerColumns,
    mediaFolderColumns,
    mediaAssetColumns,
    unitColumns,
    productDetailColumns,
    storageReferenceColumns,
  ] = await Promise.all([
    cloneTableColumns(c.env.DB, 'publications'),
    cloneTableColumns(c.env.DB, 'pages'),
    cloneTableColumns(c.env.DB, 'dynamic_markers'),
    cloneTableColumns(c.env.DB, 'media_folders'),
    cloneTableColumns(c.env.DB, 'media_assets'),
    cloneTableColumns(c.env.DB, 'units'),
    cloneTableColumns(c.env.DB, 'product_details'),
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

  if (productDetailColumns.length) {
    addStatement(buildMappedCloneInsertStatement({
      table: 'product_details',
      columns: productDetailColumns,
      mapRows: sourceProductDetails.map((detail) => ({
        old_id: Number(detail.id),
        new_id: productDetailIdMap.get(Number(detail.id))!,
        new_internal_name: cloneProductInternalName(detail.internal_name, newPublicationId),
      })),
      mapFields: ['old_id', 'new_id', 'new_internal_name'],
      overrides: {
        id: { sql: 'map.new_id' },
        internal_name: { sql: 'map.new_internal_name' },
        created_at: { sql: "datetime('now')" },
        updated_at: { sql: "datetime('now')" },
      },
    }))
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
      storageReferencePairsFromNumericMap(productDetailIdMap),
    ]
    storageMaps.forEach((mapRows) => {
      addStatement(buildMappedStorageReferenceStatement(mapRows, newPublicationId, sourcePublicationId))
    })
  }

  try {
    // D1 batch es atómico: si una copia dependiente falla, no queda una publicación parcial.
    await c.env.DB.batch(statements)
  } catch (error) {
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
      units: sourceUnits.length,
      copied_history: false,
      reused_physical_media: true,
    },
    ...(source.sound_enabled && !soundEnabled ? { warning: checkSoundAllowed(plan) } : {}),
  }, 201)
})

'''

s = replace_once(
    s,
    '// GET /api/publications/:id/preview-access',
    duplicate_route + '// GET /api/publications/:id/preview-access',
    'duplicate route insertion',
)

s = replace_once(
    s,
    "    category?: string\n    sound_enabled?: boolean",
    "    category?: string\n    public_slug?: unknown\n    sound_enabled?: boolean",
    'PUT body public_slug',
)

slug_update = r'''
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
'''

s = replace_once(
    s,
    "  if (!pub) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)\n\n  let soundValue: number | null = null",
    "  if (!pub) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)\n\n" + slug_update + "\n  let soundValue: number | null = null",
    'slug update validation',
)

s = replace_once(
    s,
    "         category = COALESCE(?, category),\n         sound_enabled = COALESCE(?, sound_enabled),",
    "         category = COALESCE(?, category),\n"
    "         public_slug = CASE WHEN ? THEN ? ELSE public_slug END,\n"
    "         sound_enabled = COALESCE(?, sound_enabled),",
    'PUT SQL slug',
)

s = replace_once(
    s,
    "      body.category ?? null,\n      soundValue,",
    "      body.category ?? null,\n"
    "      publicSlugPresent ? 1 : 0,\n"
    "      publicSlugValue,\n"
    "      soundValue,",
    'PUT bindings slug',
)

p.write_text(s)


# ---------------------------------------------------------------------------
# Dashboard API client
# ---------------------------------------------------------------------------
p = Path('apps/dashboard/src/lib/api.ts')
s = p.read_text()
s = replace_once(
    s,
    "    create: (body: { title: string; description?: string; category?: string }) =>\n"
    "      request<{ success: true; data: any }>('/api/publications', { method: 'POST', body: JSON.stringify(body) }),\n"
    "    update: (id: string, body: Record<string, unknown>) =>",
    "    create: (body: { title: string; description?: string; category?: string }) =>\n"
    "      request<{ success: true; data: any }>('/api/publications', { method: 'POST', body: JSON.stringify(body) }),\n"
    "    duplicate: (id: string, body: { title: string; public_slug?: string }) =>\n"
    "      request<{ success: true; data: any; clone_summary?: Record<string, unknown>; warning?: string }>(\n"
    "        `/api/publications/${id}/duplicate`,\n"
    "        { method: 'POST', body: JSON.stringify(body) },\n"
    "      ),\n"
    "    update: (id: string, body: Record<string, unknown>) =>",
    'dashboard API duplicate',
)
p.write_text(s)


# ---------------------------------------------------------------------------
# Dashboard Publications UI
# ---------------------------------------------------------------------------
p = Path('apps/dashboard/src/pages/Publications.tsx')
s = p.read_text()
s = replace_once(
    s,
    "import { ensurePdfJs } from '../lib/externalScripts'",
    "import { ensurePdfJs } from '../lib/externalScripts'\n"
    "import { duplicatePublicationSlug, duplicatePublicationTitle, publicationSlugDraft } from '../lib/publicationDuplicate'",
    'Publications duplicate helpers import',
)

modal_component = r'''
function DuplicatePublicationModal({
  pub,
  onClose,
  onCreated,
}: {
  pub: any
  onClose: () => void
  onCreated: (copy: any) => void
}) {
  const [title, setTitle] = useState(() => duplicatePublicationTitle(pub.title))
  const [slug, setSlug] = useState(() => duplicatePublicationSlug(pub.title))
  const [slugTouched, setSlugTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const cleanTitle = title.trim()
    const cleanSlug = publicationSlugDraft(slug)
    if (!cleanTitle) { setError('El nombre de la copia es requerido.'); return }
    if (!cleanSlug) { setError('El slug debe contener letras o números.'); return }

    setSaving(true)
    setError('')
    try {
      const response = await api.publications.duplicate(pub.id, {
        title: cleanTitle,
        public_slug: cleanSlug,
      })
      onCreated(response.data)
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo duplicar el flipbook.')
      setSaving(false)
    }
  }

  return (
    <div style={s.overlay} onClick={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div style={{ ...s.modal, width: 520 }}>
        <div style={s.modalHeader}>
          <div>
            <h2 style={s.modalTitle}>Duplicar flipbook</h2>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{pub.title}</div>
          </div>
          <button style={s.closeBtn} onClick={onClose} disabled={saving}>✕</button>
        </div>
        <form onSubmit={handleSubmit} style={s.modalForm}>
          <div style={{ padding: '10px 12px', borderRadius: 8, background: '#eef2ff', color: '#3730a3', fontSize: 12, lineHeight: 1.5 }}>
            Se creará una copia independiente en borrador. El original, sus vistas, solicitudes, respuestas y reservas no se modifican ni se copian.
          </div>

          <div style={s.formField}>
            <label style={s.formLabel}>Nombre de la copia *</label>
            <input
              autoFocus
              required
              maxLength={120}
              style={s.formInput}
              value={title}
              disabled={saving}
              onChange={(e) => {
                const nextTitle = e.target.value
                setTitle(nextTitle)
                if (!slugTouched) setSlug(publicationSlugDraft(nextTitle))
              }}
              placeholder="Ej: Catálogo para Hombres"
            />
          </div>

          <div style={s.formField}>
            <label style={s.formLabel}>Slug público *</label>
            <input
              required
              maxLength={60}
              style={s.formInput}
              value={slug}
              disabled={saving}
              onChange={(e) => {
                setSlugTouched(true)
                setSlug(publicationSlugDraft(e.target.value))
              }}
              placeholder="catalogo-para-hombres"
            />
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
              flip.intaprd.com/{slug || 'nuevo-slug'}
            </div>
          </div>

          {saving && (
            <div style={{ fontSize: 12, color: '#4f46e5' }}>
              Duplicando páginas, fichas, multimedia y vínculos…
            </div>
          )}
          {error && <div style={s.errorText}>{error}</div>}

          <div style={s.modalFooter}>
            <button type="button" style={s.btnCancel} onClick={onClose} disabled={saving}>Cancelar</button>
            <button
              type="submit"
              style={{ ...s.btnCreate, opacity: saving ? 0.7 : 1 }}
              disabled={saving || !title.trim() || !slug}
            >
              {saving ? 'Duplicando…' : 'Duplicar y editar →'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

'''

s = replace_once(
    s,
    'function PubCard({ pub, isMobile, onDelete, onPublish, onMoveFolder, onCoverChanged, folders }:',
    modal_component + 'function PubCard({ pub, isMobile, onDelete, onPublish, onMoveFolder, onCoverChanged, folders }:',
    'DuplicatePublicationModal insertion',
)

s = replace_once(
    s,
    "  const [showCoverModal, setShowCoverModal] = useState(false)\n  const isPublished = pub.status === 'published'",
    "  const [showCoverModal, setShowCoverModal] = useState(false)\n"
    "  const [showDuplicateModal, setShowDuplicateModal] = useState(false)\n"
    "  const navigate = useNavigate()\n"
    "  const isPublished = pub.status === 'published'",
    'PubCard duplicate state',
)

s = replace_once(
    s,
    "    {showPropose && <ProposeModal pub={pub} onClose={() => setShowPropose(false)} />}\n"
    "    {showCoverModal && <CoverModal pubId={pub.id} currentCover={pub.cover_image_url} onClose={() => setShowCoverModal(false)} onConfirm={(url) => { onCoverChanged(url); setShowCoverModal(false) }} />}",
    "    {showPropose && <ProposeModal pub={pub} onClose={() => setShowPropose(false)} />}\n"
    "    {showCoverModal && <CoverModal pubId={pub.id} currentCover={pub.cover_image_url} onClose={() => setShowCoverModal(false)} onConfirm={(url) => { onCoverChanged(url); setShowCoverModal(false) }} />}\n"
    "    {showDuplicateModal && (\n"
    "      <DuplicatePublicationModal\n"
    "        pub={pub}\n"
    "        onClose={() => setShowDuplicateModal(false)}\n"
    "        onCreated={(copy) => {\n"
    "          setShowDuplicateModal(false)\n"
    "          navigate(`/publications/${copy.id}/editor`)\n"
    "        }}\n"
    "      />\n"
    "    )}",
    'PubCard duplicate modal render',
)

s = replace_once(
    s,
    "          {isPublished && (\n"
    "            <button\n"
    "              title=\"Proponer como plantilla\"",
    "          <button\n"
    "            title=\"Duplicar flipbook\"\n"
    "            aria-label={`Duplicar ${pub.title}`}\n"
    "            style={{ ...s.actionBtn, color: '#4f46e5', fontWeight: 600 }}\n"
    "            onClick={() => setShowDuplicateModal(true)}\n"
    "          >⧉ Duplicar</button>\n"
    "          {isPublished && (\n"
    "            <button\n"
    "              title=\"Proponer como plantilla\"",
    'duplicate action button',
)

s = replace_once(
    s,
    "  cardActions: { display: 'flex', gap: 4, alignItems: 'center', marginTop: 2 },",
    "  cardActions: { display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', marginTop: 2 },",
    'card actions wrap',
)
p.write_text(s)


# ---------------------------------------------------------------------------
# Settings: slug editable after cloning (and for any publication)
# ---------------------------------------------------------------------------
p = Path('apps/dashboard/src/pages/Settings.tsx')
s = p.read_text()
s = replace_once(
    s,
    "import { api, toCanvasSafeAssetUrl } from '../lib/api'\nimport UnitsPanel from './UnitsPanel'",
    "import { api, toCanvasSafeAssetUrl } from '../lib/api'\n"
    "import { publicationSlugDraft } from '../lib/publicationDuplicate'\n"
    "import UnitsPanel from './UnitsPanel'",
    'Settings slug helper import',
)
s = replace_once(
    s,
    "  const [title, setTitle]           = useState('')\n  const [description, setDesc]      = useState('')",
    "  const [title, setTitle]           = useState('')\n"
    "  const [publicSlug, setPublicSlug] = useState('')\n"
    "  const [description, setDesc]      = useState('')",
    'Settings slug state',
)
s = replace_once(
    s,
    "      setTitle(p.title ?? '')\n      setDesc(p.description ?? '')",
    "      setTitle(p.title ?? '')\n"
    "      setPublicSlug(p.public_slug ?? '')\n"
    "      setDesc(p.description ?? '')",
    'Settings load slug',
)
s = replace_once(
    s,
    "        title,\n        description,\n        category,",
    "        title,\n"
    "        public_slug: publicationSlugDraft(publicSlug),\n"
    "        description,\n"
    "        category,",
    'Settings save slug body',
)
s = replace_once(
    s,
    "      setPub(res.data)\n      setSocialTitle(res.data.social_title ?? '')",
    "      setPub(res.data)\n"
    "      setPublicSlug(res.data.public_slug ?? '')\n"
    "      setSocialTitle(res.data.social_title ?? '')",
    'Settings response slug',
)

slug_field = r'''

            <label style={styles.label}>
              Enlace público (slug) <span style={styles.required}>*</span>
              <input
                style={styles.input}
                value={publicSlug}
                onChange={(e) => setPublicSlug(publicationSlugDraft(e.target.value))}
                required
                maxLength={60}
                placeholder="catalogo-para-hombres"
              />
              <span style={styles.helpText}>flip.intaprd.com/{publicSlug || 'slug-del-flipbook'}</span>
              {pub.status === 'published' && publicSlug !== (pub.public_slug ?? '') && (
                <span style={styles.warnText}>Cambiar el slug modifica el enlace público de esta publicación.</span>
              )}
            </label>
'''

s = replace_once(
    s,
    "            </label>\n\n            <label style={styles.label}>\n              Descripción",
    "            </label>" + slug_field + "\n            <label style={styles.label}>\n              Descripción",
    'Settings slug field',
)
p.write_text(s)


# ---------------------------------------------------------------------------
# Contract tests: route/UI presence and safety invariants
# ---------------------------------------------------------------------------
Path('apps/api/tests/publication-duplicate-contract.test.mjs').write_text(r'''import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(new URL('../src/routes/publications.ts', import.meta.url), 'utf8')

test('duplicate endpoint is tenant-authenticated and plan-limited', () => {
  assert.match(source, /publications\.post\('\/:id\/duplicate'/)
  assert.match(source, /const userId = c\.get\('user'\)\.sub/)
  assert.match(source, /checkPublicationLimit\(c\.env\.DB, userId, plan, customLimits\)/)
  assert.match(source, /sourcePages\.length > effectiveMaxPages/)
})

test('duplicate is atomic and always creates a draft with fresh identity', () => {
  assert.match(source, /await c\.env\.DB\.batch\(statements\)/)
  assert.match(source, /case 'status':[\s\S]*return "'draft'"/)
  assert.match(source, /const newPublicationId = crypto\.randomUUID\(\)/)
  assert.match(source, /views_count'[\s\S]*return '0'/)
})

test('duplicate remaps linked data and reuses physical media safely', () => {
  assert.match(source, /remapPublicationCanvasJson\(page\.canvas_json, markerIdMap, productDetailIdMap\)/)
  assert.match(source, /buildMappedStorageReferenceStatement/)
  assert.match(source, /reused_physical_media: true/)
  assert.match(source, /cloned_from_marker_id: \{ sql: 'source\.id' \}/)
})

test('duplicate does not copy analytics or transactional history', () => {
  const duplicateBlock = source.slice(
    source.indexOf("publications.post('/:id/duplicate'"),
    source.indexOf('// GET /api/publications/:id/preview-access'),
  )
  assert.doesNotMatch(duplicateBlock, /INSERT INTO publication_views/)
  assert.doesNotMatch(duplicateBlock, /INSERT INTO page_events/)
  assert.doesNotMatch(duplicateBlock, /INSERT INTO form_responses/)
  assert.doesNotMatch(duplicateBlock, /INSERT INTO lead_intakes/)
  assert.doesNotMatch(duplicateBlock, /INSERT INTO appointment_calendar_bookings/)
})
''')

Path('apps/dashboard/tests/publication-duplicate-contract.test.mjs').write_text(r'''import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const publications = fs.readFileSync(new URL('../src/pages/Publications.tsx', import.meta.url), 'utf8')
const settings = fs.readFileSync(new URL('../src/pages/Settings.tsx', import.meta.url), 'utf8')
const api = fs.readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8')

test('panel exposes duplicate flow and opens the copy in editor', () => {
  assert.match(publications, /Duplicar flipbook/)
  assert.match(publications, /Duplicar y editar/)
  assert.match(publications, /api\.publications\.duplicate/)
  assert.match(publications, /navigate\(`\/publications\/\$\{copy\.id\}\/editor`\)/)
})

test('duplicate dialog explains isolation from history', () => {
  assert.match(publications, /El original, sus vistas, solicitudes, respuestas y reservas no se modifican ni se copian/)
})

test('slug is editable in duplicate dialog and settings', () => {
  assert.match(publications, /Slug público/)
  assert.match(settings, /Enlace público \(slug\)/)
  assert.match(settings, /public_slug: publicationSlugDraft\(publicSlug\)/)
  assert.match(api, /\/duplicate`/)
})
''')

print('Feature patch applied successfully')
