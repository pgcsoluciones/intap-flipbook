import { Hono } from 'hono'
import { jwtMiddleware } from '../middleware/jwt'
import { getUserPlan, checkPublicationLimit, checkSoundAllowed } from '../lib/plans'
import { slugify, uniqueSlug } from './auth'
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
  }>()

  const pub = await c.env.DB.prepare('SELECT id FROM publications WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), userId)
    .first()
  if (!pub) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)

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
      soundValue,
      body.cover_image_url ?? null,
      c.req.param('id'),
    )
    .run()

  const updated = await c.env.DB.prepare('SELECT * FROM publications WHERE id = ?')
    .bind(c.req.param('id'))
    .first()
  return c.json({ success: true, data: updated, ...(soundWarning ? { warning: soundWarning } : {}) })
})

// DELETE /api/publications/:id
publications.delete('/:id', async (c) => {
  const userId = c.get('user').sub
  const pub = await c.env.DB.prepare('SELECT id FROM publications WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), userId)
    .first()
  if (!pub) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)

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
