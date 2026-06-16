import { Hono } from 'hono'
import { jwtMiddleware } from '../middleware/jwt'
import type { Env } from '../index'
import type { AuthVariables } from '../middleware/jwt'

type Variables = AuthVariables

const publications = new Hono<{ Bindings: Env; Variables: Variables }>()

publications.use('*', jwtMiddleware)

// GET /api/publications
publications.get('/', async (c) => {
  const userId = c.get('user').sub
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, COUNT(pg.id) as page_count
     FROM publications p
     LEFT JOIN pages pg ON pg.publication_id = p.id
     WHERE p.user_id = ?
     GROUP BY p.id
     ORDER BY p.updated_at DESC`,
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
    sound_enabled?: boolean
  }>()

  if (!body.title?.trim()) {
    return c.json({ success: false, error: 'title is required' }, 400)
  }

  // Enforce plan limits
  const user = await c.env.DB.prepare('SELECT plan_id FROM users WHERE id = ?')
    .bind(userId)
    .first<{ plan_id: string }>()
  const plan = await c.env.DB.prepare('SELECT max_publications FROM plans WHERE id = ?')
    .bind(user!.plan_id)
    .first<{ max_publications: number | null }>()

  if (plan?.max_publications !== null) {
    const { count } = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM publications WHERE user_id = ?',
    )
      .bind(userId)
      .first<{ count: number }>() ?? { count: 0 }
    if (count >= plan!.max_publications!) {
      return c.json(
        { success: false, error: `Plan limit reached (max ${plan!.max_publications} publications)` },
        403,
      )
    }
  }

  const id = crypto.randomUUID()
  const slug = generateSlug()

  await c.env.DB.prepare(
    `INSERT INTO publications (id, user_id, title, description, category, public_slug, sound_enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      userId,
      body.title.trim(),
      body.description ?? null,
      body.category ?? null,
      slug,
      body.sound_enabled !== false ? 1 : 0,
    )
    .run()

  const pub = await c.env.DB.prepare('SELECT * FROM publications WHERE id = ?').bind(id).first()
  return c.json({ success: true, data: pub }, 201)
})

// GET /api/publications/:id
publications.get('/:id', async (c) => {
  const userId = c.get('user').sub
  const pub = await c.env.DB.prepare('SELECT * FROM publications WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), userId)
    .first()
  if (!pub) return c.json({ success: false, error: 'Publication not found' }, 404)

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
  }>()

  const pub = await c.env.DB.prepare('SELECT id FROM publications WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), userId)
    .first()
  if (!pub) return c.json({ success: false, error: 'Publication not found' }, 404)

  await c.env.DB.prepare(
    `UPDATE publications
     SET title = COALESCE(?, title),
         description = COALESCE(?, description),
         category = COALESCE(?, category),
         sound_enabled = COALESCE(?, sound_enabled),
         cover_image_url = COALESCE(?, cover_image_url),
         updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(
      body.title ?? null,
      body.description ?? null,
      body.category ?? null,
      body.sound_enabled !== undefined ? (body.sound_enabled ? 1 : 0) : null,
      body.cover_image_url ?? null,
      c.req.param('id'),
    )
    .run()

  const updated = await c.env.DB.prepare('SELECT * FROM publications WHERE id = ?')
    .bind(c.req.param('id'))
    .first()
  return c.json({ success: true, data: updated })
})

// DELETE /api/publications/:id
publications.delete('/:id', async (c) => {
  const userId = c.get('user').sub
  const pub = await c.env.DB.prepare('SELECT id FROM publications WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), userId)
    .first()
  if (!pub) return c.json({ success: false, error: 'Publication not found' }, 404)

  await c.env.DB.prepare('DELETE FROM pages WHERE publication_id = ?').bind(c.req.param('id')).run()
  await c.env.DB.prepare('DELETE FROM publications WHERE id = ?').bind(c.req.param('id')).run()

  return c.json({ success: true, data: { deleted: true } })
})

// POST /api/publications/:id/publish
publications.post('/:id/publish', async (c) => {
  const userId = c.get('user').sub
  const pub = await c.env.DB.prepare('SELECT id FROM publications WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), userId)
    .first()
  if (!pub) return c.json({ success: false, error: 'Publication not found' }, 404)

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

function generateSlug(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 10)
}

export default publications
