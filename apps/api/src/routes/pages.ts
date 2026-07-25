import { Hono } from 'hono'
import { jwtMiddleware } from '../middleware/jwt'
import { getUserPlan, checkPageLimit, checkPublicationLimit } from '../lib/plans'
import type { Env } from '../index'
import type { AuthVariables } from '../middleware/jwt'

type Variables = AuthVariables

const pages = new Hono<{ Bindings: Env; Variables: Variables }>()

pages.use('*', jwtMiddleware)

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function normalizeCanvasJson(value: unknown) {
  const fallback = { version: '5.3.0', objects: [] }
  const source = value == null ? fallback : value
  if (typeof source === 'string') {
    try {
      const parsed = JSON.parse(source)
      if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as any).objects)) return null
      return JSON.stringify(parsed)
    } catch {
      return null
    }
  }
  if (!source || typeof source !== 'object' || !Array.isArray((source as any).objects)) return null
  return JSON.stringify(source)
}

function collectOpenProductDetailIds(
  value: unknown,
  out = new Set<number>(),
): Set<number> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectOpenProductDetailIds(item, out))
    return out
  }

  if (!value || typeof value !== 'object') return out

  const record = value as Record<string, unknown>
  const data = (
    record.data
    && typeof record.data === 'object'
    && !Array.isArray(record.data)
  )
    ? record.data as Record<string, unknown>
    : null

  const actionCandidates = [
    record.action,
    data?.action,
  ]

  for (const action of actionCandidates) {
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
      continue
    }

    const actionRecord = action as Record<string, unknown>

    if (actionRecord.type !== 'open_product_detail') continue

    const rawId = actionRecord.detail_id
    if (rawId === null || rawId === undefined || rawId === '') continue

    const parsed = typeof rawId === 'number' ? rawId : Number(rawId)

    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error('detail_id debe ser un número positivo')
    }

    out.add(parsed)
  }

  Object.values(record).forEach((child) =>
    collectOpenProductDetailIds(child, out)
  )

  return out
}

async function validateProductDetailCanvasActions(
  db: D1Database,
  canvasJson: string | undefined,
  userId: string,
) {
  if (!canvasJson || !canvasJson.includes('open_product_detail')) return

  let parsed: unknown

  try {
    parsed = JSON.parse(canvasJson)
  } catch {
    return
  }

  const ids = Array.from(collectOpenProductDetailIds(parsed))
  if (!ids.length) return

  const placeholders = ids.map(() => '?').join(', ')

  const { results } = await db.prepare(
    `SELECT id, tenant_id
     FROM product_details
     WHERE id IN (${placeholders})`,
  ).bind(...ids).all<{ id: number; tenant_id: string }>()

  const rows = results ?? []
  const existingIds = new Set(rows.map((row) => Number(row.id)))

  const missingId = ids.find((id) => !existingIds.has(id))
  if (missingId) {
    throw new Error('El detalle de producto vinculado ya no existe')
  }

  const foreign = rows.find((row) => row.tenant_id !== userId)
  if (foreign) {
    throw new Error(
      'No puedes vincular un detalle de producto de otro tenant'
    )
  }
}

// POST /api/publications/:pubId/pages/batch
pages.post('/publications/:pubId/pages/batch', async (c) => {
  const userId = c.get('user').sub
  const pubId = c.req.param('pubId')
  const reqId = c.req.header('CF-Ray') ?? crypto.randomUUID()

  const pub = await c.env.DB.prepare('SELECT id FROM publications WHERE id = ? AND user_id = ?')
    .bind(pubId, userId)
    .first<{ id: string }>()
  if (!pub) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)

  const body = await c.req.json<{
    pages?: Array<{
      image_url?: string
      canvas_json?: unknown
      size_bytes?: number
      title?: string
      description?: string
      price?: string
    }>
  }>()

  const requestedPages = Array.isArray(body.pages) ? body.pages : []
  if (!requestedPages.length) {
    return c.json({ success: false, error: 'pages debe contener al menos una página' }, 400)
  }

  const normalized = requestedPages.map((page, index) => {
    const imageUrl = String(page?.image_url ?? '').trim()
    const canvasJson = normalizeCanvasJson(page?.canvas_json)
    if (!imageUrl) return { index, error: 'image_url es requerido' }
    if (!canvasJson) return { index, error: 'canvas_json inválido' }
    return {
      index,
      image_url: imageUrl,
      canvas_json: canvasJson,
      size_bytes: Number.isFinite(page.size_bytes ?? 0) ? page.size_bytes ?? 0 : 0,
      title: page.title ?? null,
      description: page.description ?? null,
      price: page.price ?? null,
    }
  })

  const invalid = normalized.find((page) => 'error' in page)
  if (invalid && 'error' in invalid) {
    return c.json({ success: false, error: `Página ${invalid.index + 1}: ${invalid.error}` }, 400)
  }

  try {
    for (const page of normalized) {
      if ('error' in page) continue

      await validateProductDetailCanvasActions(
        c.env.DB,
        page.canvas_json,
        userId,
      )
    }
  } catch (error) {
    return c.json({
      success: false,
      error: errorMessage(error),
    }, 400)
  }

  const { plan, customLimits } = await getUserPlan(c.env.DB, userId)
  const effectiveMaxPages = customLimits.max_pages ?? plan.max_pages_per_pub
  const currentCountRow = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM pages WHERE publication_id = ?',
  ).bind(pubId).first<{ count: number }>()
  const currentCount = currentCountRow?.count ?? 0
  if (effectiveMaxPages !== null && currentCount + normalized.length > effectiveMaxPages) {
    return c.json({
      success: false,
      error: `Tu plan ${plan.name} permite máximo ${effectiveMaxPages} páginas por publicación. Actualiza tu plan para agregar más.`,
    }, 403)
  }

  const ids = normalized.map(() => crypto.randomUUID())
  try {
    await c.env.DB.batch([
      ...normalized.map((page, index) => {
        if ('error' in page) throw new Error(page.error)
        return c.env.DB.prepare(
          `INSERT INTO pages (
             id, publication_id, page_number, image_url, size_bytes, title, description, price, canvas_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          ids[index],
          pubId,
          currentCount + index + 1,
          page.image_url,
          page.size_bytes,
          page.title,
          page.description,
          page.price,
          page.canvas_json,
        )
      }),
      c.env.DB.prepare(`UPDATE publications SET updated_at = datetime('now') WHERE id = ?`).bind(pubId),
    ])

    const placeholders = ids.map(() => '?').join(',')
    const { results } = await c.env.DB.prepare(
      `SELECT *
       FROM pages
       WHERE publication_id = ?
         AND id IN (${placeholders})
       ORDER BY page_number ASC, created_at ASC, id ASC`,
    ).bind(pubId, ...ids).all()

    const byId = new Map((results ?? []).map((page: any) => [page.id, page]))
    const createdPages = ids.map((id) => byId.get(id)).filter(Boolean)
    return c.json({ success: true, pages: createdPages, data: { pages: createdPages } }, 201)
  } catch (error) {
    console.error('[pages.batchCreate] failed', {
      request_id: reqId,
      user_id: userId,
      publication_id: pubId,
      requested_pages: requestedPages.length,
      error: errorMessage(error),
    })
    return c.json({
      success: false,
      code: 'PAGES_BATCH_CREATE_FAILED',
      error: 'No se pudieron crear las páginas.',
    }, 500)
  }
})

// POST /api/publications/:pubId/pages
pages.post('/publications/:pubId/pages', async (c) => {
  const userId = c.get('user').sub
  const pubId = c.req.param('pubId')

  const pub = await c.env.DB.prepare('SELECT id FROM publications WHERE id = ? AND user_id = ?')
    .bind(pubId, userId)
    .first<{ id: string }>()
  if (!pub) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)

  const { plan } = await getUserPlan(c.env.DB, userId)
  const pageLimitError = await checkPageLimit(c.env.DB, pubId, plan)
  if (pageLimitError) return c.json({ success: false, error: pageLimitError }, 403)

  const body = await c.req.json<{
    image_url: string
    size_bytes?: number
    title?: string
    description?: string
    price?: string
    page_number?: number
  }>()

  if (!body.image_url) {
    return c.json({ success: false, error: 'image_url es requerido' }, 400)
  }

  const { count } = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM pages WHERE publication_id = ?',
  )
    .bind(pubId)
    .first<{ count: number }>() ?? { count: 0 }

  const pageNumber = body.page_number ?? count + 1
  const id = crypto.randomUUID()

  await c.env.DB.prepare(
    `INSERT INTO pages (id, publication_id, page_number, image_url, size_bytes, title, description, price)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, pubId, pageNumber, body.image_url, body.size_bytes ?? 0, body.title ?? null, body.description ?? null, body.price ?? null)
    .run()

  await c.env.DB.prepare(`UPDATE publications SET updated_at = datetime('now') WHERE id = ?`)
    .bind(pubId)
    .run()

  const page = await c.env.DB.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first()
  return c.json({ success: true, data: page }, 201)
})

// PUT /api/pages/:pageId
pages.put('/pages/:pageId', async (c) => {
  const userId = c.get('user').sub
  const pageId = c.req.param('pageId')

  const page = await c.env.DB.prepare(
    `SELECT pg.id, pg.publication_id FROM pages pg
     JOIN publications pub ON pub.id = pg.publication_id
     WHERE pg.id = ? AND pub.user_id = ?`,
  )
    .bind(pageId, userId)
    .first<{ id: string; publication_id: string }>()
  if (!page) return c.json({ success: false, error: 'Página no encontrada' }, 404)

  const body = await c.req.json<{
    title?: string
    description?: string
    price?: string
    page_number?: number
    canvas_json?: string
    cover_json?: string
  }>()

  try {
    await validateProductDetailCanvasActions(
      c.env.DB,
      body.canvas_json,
      userId,
    )
  } catch (error) {
    return c.json({
      success: false,
      error: errorMessage(error),
    }, 400)
  }

  await c.env.DB.prepare(
    `UPDATE pages
     SET title = COALESCE(?, title),
         description = COALESCE(?, description),
         price = COALESCE(?, price),
         page_number = COALESCE(?, page_number),
         canvas_json = COALESCE(?, canvas_json),
         cover_json = COALESCE(?, cover_json)
     WHERE id = ?`,
  )
    .bind(body.title ?? null, body.description ?? null, body.price ?? null, body.page_number ?? null, body.canvas_json ?? null, body.cover_json ?? null, pageId)
    .run()

  await c.env.DB.prepare(`UPDATE publications SET updated_at = datetime('now') WHERE id = ?`)
    .bind(page.publication_id)
    .run()

  const updated = await c.env.DB.prepare('SELECT * FROM pages WHERE id = ?').bind(pageId).first()
  return c.json({ success: true, data: updated })
})

// DELETE /api/pages/:pageId
pages.delete('/pages/:pageId', async (c) => {
  const userId = c.get('user').sub
  const pageId = c.req.param('pageId')
  const reqId = c.req.header('CF-Ray') ?? crypto.randomUUID()

  const page = await c.env.DB.prepare(
    `SELECT pg.id, pg.publication_id FROM pages pg
     JOIN publications pub ON pub.id = pg.publication_id
     WHERE pg.id = ? AND pub.user_id = ?`,
  )
    .bind(pageId, userId)
    .first<{ id: string; publication_id: string }>()
  if (!page) return c.json({ success: false, error: 'Página no encontrada' }, 404)

  type OptionalPageTable = 'units' | 'appointment_calendar_bookings' | 'lead_intakes'

  const optionalTableExists = async (tableName: OptionalPageTable) => {
    const row = await c.env.DB.prepare(
      `SELECT 1 AS found
       FROM sqlite_master
       WHERE type = 'table' AND name = ?
       LIMIT 1`,
    ).bind(tableName).first<{ found: number }>()

    return Boolean(row?.found)
  }

  const countHistoryRows = async (
    tableName: 'appointment_calendar_bookings' | 'lead_intakes',
  ) => {
    if (!(await optionalTableExists(tableName))) return 0

    const row = await c.env.DB.prepare(
      `SELECT COUNT(DISTINCT history.id) AS count
       FROM dynamic_markers dm
       LEFT JOIN ${tableName} history ON history.marker_id = dm.id
       WHERE dm.page_id = ?`,
    ).bind(pageId).first<{ count: number }>()

    return Number(row?.count ?? 0)
  }

  const loadPageHistory = async () => {
    const [bookingsCount, leadIntakesCount] = await Promise.all([
      countHistoryRows('appointment_calendar_bookings'),
      countHistoryRows('lead_intakes'),
    ])

    return {
      bookings_count: bookingsCount,
      lead_intakes_count: leadIntakesCount,
    }
  }

  try {
    const [history, hasUnitsTable] = await Promise.all([
      loadPageHistory(),
      optionalTableExists('units'),
    ])

    if (history.bookings_count > 0 || history.lead_intakes_count > 0) {
      return c.json({
        success: false,
        code: 'PAGE_HAS_HISTORY',
        error: 'Esta página tiene solicitudes o reservas vinculadas y no puede eliminarse.',
      }, 409)
    }

    const { results: remainingPages } = await c.env.DB.prepare(
      `SELECT id
       FROM pages
       WHERE publication_id = ?
         AND id <> ?
       ORDER BY page_number ASC, created_at ASC, id ASC`,
    ).bind(page.publication_id, pageId).all<{ id: string }>()

    const statements = [
      ...(hasUnitsTable
        ? [c.env.DB.prepare('UPDATE units SET page_id = NULL WHERE page_id = ?').bind(pageId)]
        : []),
      c.env.DB.prepare(
        `UPDATE dynamic_markers
         SET cloned_from_marker_id = NULL
         WHERE cloned_from_marker_id IN (
           SELECT id
           FROM dynamic_markers
           WHERE page_id = ?
         )`,
      ).bind(pageId),
      c.env.DB.prepare('DELETE FROM dynamic_markers WHERE page_id = ?').bind(pageId),
      c.env.DB.prepare('DELETE FROM pages WHERE id = ?').bind(pageId),
      ...remainingPages.map((remainingPage, index) =>
        c.env.DB.prepare('UPDATE pages SET page_number = ? WHERE id = ?')
          .bind(index + 1, remainingPage.id),
      ),
      c.env.DB.prepare(`UPDATE publications SET updated_at = datetime('now') WHERE id = ?`)
        .bind(page.publication_id),
    ]

    await c.env.DB.batch(statements)
  } catch (error) {
    const history = await loadPageHistory().catch(() => null)

    if ((history?.bookings_count ?? 0) > 0 || (history?.lead_intakes_count ?? 0) > 0) {
      return c.json({
        success: false,
        code: 'PAGE_HAS_HISTORY',
        error: 'Esta página tiene solicitudes o reservas vinculadas y no puede eliminarse.',
      }, 409)
    }

    console.error('[pages.delete] failed', {
      request_id: reqId,
      user_id: userId,
      publication_id: page.publication_id,
      page_id: pageId,
      error: errorMessage(error),
    })
    return c.json({
      success: false,
      code: 'PAGE_DELETE_FAILED',
      error: 'No se pudo eliminar la página.',
    }, 500)
  }

  return c.json({ success: true, data: { deleted: true } })
})

// POST /api/pages/reorder
pages.post('/pages/reorder', async (c) => {
  const userId = c.get('user').sub
  const body = await c.req.json<{ publication_id: string; page_ids: string[] }>()

  if (!body.publication_id || !Array.isArray(body.page_ids) || body.page_ids.length === 0) {
    return c.json({ success: false, error: 'publication_id y page_ids son requeridos' }, 400)
  }

  const pub = await c.env.DB.prepare('SELECT id FROM publications WHERE id = ? AND user_id = ?')
    .bind(body.publication_id, userId)
    .first()
  if (!pub) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)

  const stmts = body.page_ids.map((pageId, index) =>
    c.env.DB.prepare('UPDATE pages SET page_number = ? WHERE id = ? AND publication_id = ?').bind(
      index + 1,
      pageId,
      body.publication_id,
    ),
  )
  await c.env.DB.batch(stmts)

  await c.env.DB.prepare(`UPDATE publications SET updated_at = datetime('now') WHERE id = ?`)
    .bind(body.publication_id)
    .run()

  return c.json({ success: true, data: { reordered: true } })
})

// ─── RUTAS TENANT (montadas en /api) ──────────────────────────────────────────
// Antes vivían en publications.ts (/api/publications) donde quedaban inaccesibles:
// el frontend las llama en /api/X y además /:id las tapaba. Ahora están aquí.

// GET /api/templates — plantillas activas con campo `locked` según plan + módulos
pages.get('/templates', async (c) => {
  const userId = c.get('user').sub

  const { results: allTemplates } = await c.env.DB.prepare(
    `SELECT * FROM templates WHERE active = 1 ORDER BY sort_order`,
  ).all()

  // Verificar acceso por módulos. Si falla (tablas inexistentes o plan inválido), todo desbloqueado.
  let modulesAvailable = false
  let planModuleKeys = new Set<string>()
  let globallyDisabled = new Set<string>()

  try {
    const { planId } = await getUserPlan(c.env.DB, userId)
    const [pmRes, gmRes] = await Promise.all([
      c.env.DB.prepare(`SELECT module_key FROM plan_modules WHERE plan_id = ?`).bind(planId).all<{ module_key: string }>(),
      c.env.DB.prepare(`SELECT key FROM modules WHERE active_globally = 0`).all<{ key: string }>(),
    ])
    modulesAvailable = true
    planModuleKeys = new Set(pmRes.results.map((r) => r.module_key))
    globallyDisabled = new Set(gmRes.results.map((r) => r.key))
  } catch {
    // getUserPlan falló o tablas modules/plan_modules no existen — sin restricciones
  }

  const data = allTemplates.map((t: any) => {
    const planReq = (t.plan_required ?? 'free') as string
    const moduleKey = planReq === 'all' || planReq.includes('free') ? 'templates_basic' : 'templates_pro'
    const locked = modulesAvailable && (globallyDisabled.has(moduleKey) || !planModuleKeys.has(moduleKey))
    return { ...t, locked }
  })

  return c.json({ success: true, data })
})

// GET /api/resources — editor_elements activos (para tenant)
pages.get('/resources', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM editor_elements WHERE active = 1 ORDER BY sort_order`,
  ).all()
  return c.json({ success: true, data: results })
})

// GET /api/tutorials — tutorials activos
pages.get('/tutorials', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM tutorials WHERE active = 1 ORDER BY sort_order`,
  ).all()
  return c.json({ success: true, data: results })
})

// POST /api/tutorials/:id/view — marcar tutorial como visto
pages.post('/tutorials/:id/view', async (c) => {
  const userId = c.get('user').sub
  const tutorialId = c.req.param('id')
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO tutorial_views (user_id, tutorial_id) VALUES (?, ?)`,
  )
    .bind(userId, tutorialId)
    .run()
  return c.json({ success: true })
})

// GET /api/promotions — promociones activas para el plan del tenant
pages.get('/promotions', async (c) => {
  const userId = c.get('user').sub

  const user = await c.env.DB.prepare(
    `SELECT plan_id FROM users WHERE id = ?`,
  )
    .bind(userId)
    .first<{ plan_id: string }>()

  const userPlan = user?.plan_id ?? 'free'

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM promotions
     WHERE status = 'active'
       AND datetime('now') BETWEEN starts_at AND ends_at`,
  ).all<{ target_plans: string; [key: string]: unknown }>()

  const filtered = results.filter((promo) => {
    if (promo.target_plans === 'all') return true
    try {
      const plans: string[] = JSON.parse(promo.target_plans as string)
      return plans.includes(userPlan)
    } catch {
      return false
    }
  })

  return c.json({ success: true, data: filtered })
})

// POST /api/templates/:id/apply — aplica una plantilla a una publicación
// body: { publication_id?: string, title?: string }
//   - si viene publication_id → agrega las páginas de la plantilla a esa publicación
//   - si no → crea una publicación nueva con `title` y le copia las páginas
pages.post('/templates/:id/apply', async (c) => {
  const userId = c.get('user').sub
  const templateId = c.req.param('id')
  const body = await c.req.json<{ publication_id?: string; title?: string }>().catch(() => ({}))

  const tpl = await c.env.DB.prepare('SELECT * FROM templates WHERE id = ? AND active = 1')
    .bind(templateId)
    .first<{ id: number; name: string; cover_url: string | null; plan_required: string | null }>()
  if (!tpl) return c.json({ success: false, error: 'Plantilla no encontrada' }, 404)

  // Verificar acceso por módulos (si las tablas existen). Bloqueada → 403.
  try {
    const { planId } = await getUserPlan(c.env.DB, userId)
    const planReq = tpl.plan_required ?? 'free'
    const moduleKey = planReq === 'all' || planReq.includes('free') ? 'templates_basic' : 'templates_pro'
    const [pm, gm] = await Promise.all([
      c.env.DB.prepare('SELECT 1 FROM plan_modules WHERE plan_id = ? AND module_key = ?').bind(planId, moduleKey).first(),
      c.env.DB.prepare('SELECT 1 FROM modules WHERE key = ? AND active_globally = 0').bind(moduleKey).first(),
    ])
    if (gm || !pm) {
      return c.json({ success: false, error: 'Esta plantilla requiere un plan superior.' }, 403)
    }
  } catch {
    // tablas de módulos no disponibles → sin restricción
  }

  // Resolver publicación destino
  let pubId = body.publication_id
  if (pubId) {
    const owned = await c.env.DB.prepare('SELECT id FROM publications WHERE id = ? AND user_id = ?')
      .bind(pubId, userId).first()
    if (!owned) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)
  } else {
    const { plan } = await getUserPlan(c.env.DB, userId)
    const limitErr = await checkPublicationLimit(c.env.DB, userId, plan)
    if (limitErr) return c.json({ success: false, error: limitErr }, 403)
    pubId = crypto.randomUUID()
    const slug = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
    await c.env.DB.prepare(
      `INSERT INTO publications (id, user_id, title, description, public_slug, sound_enabled)
       VALUES (?, ?, ?, ?, ?, 0)`,
    ).bind(pubId, userId, body.title?.trim() || tpl.name, null, slug).run()
  }

  // Páginas de la plantilla (si no hay, usar la portada como única página)
  const { results: tplPages } = await c.env.DB.prepare(
    'SELECT image_url, canvas_json, page_number FROM template_pages WHERE template_id = ? ORDER BY page_number ASC',
  ).bind(templateId).all<{ image_url: string; canvas_json: string | null; page_number: number }>()

  const source = tplPages.length > 0
    ? tplPages
    : (tpl.cover_url ? [{ image_url: tpl.cover_url, canvas_json: null, page_number: 1 }] : [])

  if (source.length === 0) {
    return c.json({ success: false, error: 'La plantilla no tiene páginas.' }, 400)
  }

  // Número de página inicial = páginas existentes + 1
  const { count } = await c.env.DB.prepare('SELECT COUNT(*) as count FROM pages WHERE publication_id = ?')
    .bind(pubId).first<{ count: number }>() ?? { count: 0 }

  const stmts = source.map((p, i) =>
    c.env.DB.prepare(
      `INSERT INTO pages (id, publication_id, page_number, image_url, canvas_json)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), pubId, count + i + 1, p.image_url, p.canvas_json),
  )
  await c.env.DB.batch(stmts)

  await c.env.DB.prepare(`UPDATE publications SET updated_at = datetime('now') WHERE id = ?`)
    .bind(pubId).run()

  return c.json({ success: true, data: { publication_id: pubId, pages_added: source.length } }, 201)
})

// GET /api/responses — respuestas de formularios/cuestionarios del usuario
pages.get('/responses', async (c) => {
  const userId = c.get('user').sub
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT r.id, r.publication_id, r.kind, r.widget_key, r.payload, r.is_read, r.created_at,
              p.title AS publication_title
       FROM form_responses r
       LEFT JOIN publications p ON p.id = r.publication_id
       WHERE r.owner_id = ?
       ORDER BY r.created_at DESC
       LIMIT 500`,
    ).bind(userId).all()
    return c.json({ success: true, data: results })
  } catch {
    return c.json({ success: true, data: [] })
  }
})

// GET /api/responses/unread-count — cantidad de respuestas sin leer
pages.get('/responses/unread-count', async (c) => {
  const userId = c.get('user').sub
  try {
    const row = await c.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM form_responses WHERE owner_id = ? AND is_read = 0`,
    ).bind(userId).first<{ count: number }>()
    return c.json({ success: true, data: { count: row?.count ?? 0 } })
  } catch {
    return c.json({ success: true, data: { count: 0 } })
  }
})

// PATCH /api/responses/:id/read — marca una respuesta como leída
pages.patch('/responses/:id/read', async (c) => {
  const userId = c.get('user').sub
  await c.env.DB.prepare(
    `UPDATE form_responses SET is_read = 1 WHERE id = ? AND owner_id = ?`,
  ).bind(c.req.param('id'), userId).run()
  return c.json({ success: true })
})

// DELETE /api/responses/:id — elimina una respuesta
pages.delete('/responses/:id', async (c) => {
  const userId = c.get('user').sub
  await c.env.DB.prepare(
    `DELETE FROM form_responses WHERE id = ? AND owner_id = ?`,
  ).bind(c.req.param('id'), userId).run()
  return c.json({ success: true })
})

export default pages
