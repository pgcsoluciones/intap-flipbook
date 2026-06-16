import { Hono } from 'hono'
import { jwtMiddleware } from '../middleware/jwt'
import type { Env } from '../index'
import type { AuthVariables } from '../middleware/jwt'

const admin = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

admin.use('*', jwtMiddleware)

// Middleware: verify is_admin
admin.use('*', async (c, next) => {
  const userId = c.get('user').sub
  const user = await c.env.DB.prepare('SELECT is_admin FROM users WHERE id = ?')
    .bind(userId)
    .first<{ is_admin: number }>()
  if (!user?.is_admin) return c.json({ success: false, error: 'Acceso denegado' }, 403)
  return next()
})

// GET /admin/users — list all users with usage stats
admin.get('/users', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT
      u.id, u.email, u.name, u.plan_id, u.is_admin, u.created_at,
      COUNT(DISTINCT p.id) as pub_count,
      COALESCE(SUM(pg.size_bytes), 0) as total_bytes
    FROM users u
    LEFT JOIN publications p ON p.user_id = u.id
    LEFT JOIN pages pg ON pg.publication_id = p.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all()
  return c.json({ success: true, data: results })
})

// PUT /admin/users/:id/plan — change user plan
admin.put('/users/:id/plan', async (c) => {
  const body = await c.req.json<{ plan_id: string }>()
  if (!body.plan_id) return c.json({ success: false, error: 'plan_id es requerido' }, 400)

  const plan = await c.env.DB.prepare('SELECT id FROM plans WHERE id = ?')
    .bind(body.plan_id)
    .first()
  if (!plan) return c.json({ success: false, error: 'Plan no encontrado' }, 404)

  await c.env.DB.prepare('UPDATE users SET plan_id = ? WHERE id = ?')
    .bind(body.plan_id, c.req.param('id'))
    .run()

  const updated = await c.env.DB.prepare('SELECT id, email, name, plan_id, is_admin FROM users WHERE id = ?')
    .bind(c.req.param('id'))
    .first()
  return c.json({ success: true, data: updated })
})

// PUT /admin/users/:id/admin — toggle admin flag
admin.put('/users/:id/admin', async (c) => {
  const body = await c.req.json<{ is_admin: boolean }>()
  await c.env.DB.prepare('UPDATE users SET is_admin = ? WHERE id = ?')
    .bind(body.is_admin ? 1 : 0, c.req.param('id'))
    .run()
  return c.json({ success: true })
})

// DELETE /admin/users/:id — delete user and all their data
admin.delete('/users/:id', async (c) => {
  const targetId = c.req.param('id')
  // Delete pages → publications → user
  await c.env.DB.prepare(`
    DELETE FROM pages WHERE publication_id IN (SELECT id FROM publications WHERE user_id = ?)
  `).bind(targetId).run()
  await c.env.DB.prepare('DELETE FROM publications WHERE user_id = ?').bind(targetId).run()
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(targetId).run()
  return c.json({ success: true, data: { deleted: true } })
})

// GET /admin/stats — global stats
admin.get('/stats', async (c) => {
  const [users, pubs, pages] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM publications').first<{ count: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as count, COALESCE(SUM(size_bytes),0) as bytes FROM pages').first<{ count: number; bytes: number }>(),
  ])
  const byPlan = await c.env.DB.prepare(`
    SELECT plan_id, COUNT(*) as count FROM users GROUP BY plan_id
  `).all()
  return c.json({
    success: true,
    data: {
      users: users?.count ?? 0,
      publications: pubs?.count ?? 0,
      pages: pages?.count ?? 0,
      storage_mb: parseFloat(((pages?.bytes ?? 0) / 1024 / 1024).toFixed(2)),
      by_plan: byPlan.results,
    },
  })
})

export default admin
