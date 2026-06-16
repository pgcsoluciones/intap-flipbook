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
  }>()

  await c.env.DB.prepare(
    `UPDATE pages
     SET title = COALESCE(?, title),
         description = COALESCE(?, description),
         price = COALESCE(?, price),
         page_number = COALESCE(?, page_number)
     WHERE id = ?`,
  )
    .bind(body.title ?? null, body.description ?? null, body.price ?? null, body.page_number ?? null, pageId)
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

export default pages
