import { Hono } from 'hono'
import { jwtMiddleware } from '../middleware/jwt'
import { getUserPlan, checkPageLimit } from '../lib/plans'
import type { Env } from '../index'
import type { AuthVariables } from '../middleware/jwt'

type Variables = AuthVariables

const pages = new Hono<{ Bindings: Env; Variables: Variables }>()

pages.use('*', jwtMiddleware)

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
  }>()

  await c.env.DB.prepare(
    `UPDATE pages
     SET title = COALESCE(?, title),
         description = COALESCE(?, description),
         price = COALESCE(?, price),
         page_number = COALESCE(?, page_number),
         canvas_json = COALESCE(?, canvas_json)
     WHERE id = ?`,
  )
    .bind(body.title ?? null, body.description ?? null, body.price ?? null, body.page_number ?? null, body.canvas_json ?? null, pageId)
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

  const page = await c.env.DB.prepare(
    `SELECT pg.id, pg.publication_id FROM pages pg
     JOIN publications pub ON pub.id = pg.publication_id
     WHERE pg.id = ? AND pub.user_id = ?`,
  )
    .bind(pageId, userId)
    .first<{ id: string; publication_id: string }>()
  if (!page) return c.json({ success: false, error: 'Página no encontrada' }, 404)

  await c.env.DB.prepare('DELETE FROM pages WHERE id = ?').bind(pageId).run()
  await c.env.DB.prepare(`UPDATE publications SET updated_at = datetime('now') WHERE id = ?`)
    .bind(page.publication_id)
    .run()

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

export default pages
