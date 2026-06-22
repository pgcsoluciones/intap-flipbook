import { Hono } from 'hono'
import { jwtMiddleware } from '../middleware/jwt'
import type { Env } from '../index'
import type { AuthVariables } from '../middleware/jwt'

type Variables = AuthVariables

const proposals = new Hono<{ Bindings: Env; Variables: Variables }>()

// POST /api/template-proposals — tenant propone una publicación como plantilla
proposals.post('/api/template-proposals', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const body = await c.req.json<{
    publication_id: string
    title: string
    description?: string
    category?: string
    cover_url?: string
  }>().catch(() => ({}))

  if (!body.publication_id) return c.json({ success: false, error: 'publication_id es requerido' }, 400)
  if (!body.title?.trim()) return c.json({ success: false, error: 'El título es requerido' }, 400)

  // Verificar que la publicación pertenece al usuario y está publicada
  const pub = await c.env.DB.prepare(
    `SELECT id, status, cover_image_url FROM publications WHERE id = ? AND user_id = ? AND deleted_at IS NULL`
  ).bind(body.publication_id, userId).first<{ id: string; status: string; cover_image_url: string | null }>()

  if (!pub) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)
  if (pub.status !== 'published') return c.json({ success: false, error: 'Solo se pueden proponer publicaciones publicadas' }, 400)

  const coverUrl = body.cover_url ?? pub.cover_image_url ?? null

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO template_proposals (user_id, publication_id, title, description, category, cover_url)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(userId, body.publication_id, body.title.trim(), body.description ?? null, body.category ?? null, coverUrl).run()

  return c.json({ success: true, data: { id: meta.last_row_id } }, 201)
})

// GET /api/template-proposals — propuestas del tenant autenticado
proposals.get('/api/template-proposals', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const { results } = await c.env.DB.prepare(
    `SELECT tp.*, p.title as publication_title
     FROM template_proposals tp
     LEFT JOIN publications p ON p.id = tp.publication_id
     WHERE tp.user_id = ?
     ORDER BY tp.created_at DESC`
  ).bind(userId).all()
  return c.json({ success: true, data: results })
})

// GET /admin/template-proposals — todas las propuestas (solo admin)
proposals.get('/admin/template-proposals', jwtMiddleware, async (c) => {
  const user = (c as any).get('user')
  const me = await c.env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(user.sub).first<{ is_admin: number }>()
  if (!me?.is_admin) return c.json({ success: false, error: 'Acceso denegado' }, 403)

  const { results } = await c.env.DB.prepare(
    `SELECT tp.*, u.name as user_name, u.email as user_email,
            p.title as publication_title
     FROM template_proposals tp
     JOIN users u ON u.id = tp.user_id
     LEFT JOIN publications p ON p.id = tp.publication_id
     ORDER BY tp.created_at DESC`
  ).all()
  return c.json({ success: true, data: results })
})

// PATCH /admin/template-proposals/:id/approve — aprobar propuesta (solo admin)
proposals.patch('/admin/template-proposals/:id/approve', jwtMiddleware, async (c) => {
  const user = (c as any).get('user')
  const me = await c.env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(user.sub).first<{ is_admin: number }>()
  if (!me?.is_admin) return c.json({ success: false, error: 'Acceso denegado' }, 403)

  const id = c.req.param('id')

  const proposal = await c.env.DB.prepare(
    `SELECT * FROM template_proposals WHERE id = ? AND status = 'pending'`
  ).bind(id).first<{ id: number; publication_id: string; title: string; description: string | null; category: string | null; cover_url: string | null }>()

  if (!proposal) return c.json({ success: false, error: 'Propuesta no encontrada o ya procesada' }, 404)

  // Copiar publicación como plantilla en templates + template_pages
  const { meta: tplMeta } = await c.env.DB.prepare(
    `INSERT INTO templates (name, plan_required, cover_url, active, sort_order)
     VALUES (?, 'free', ?, 1, 0)`
  ).bind(proposal.title, proposal.cover_url ?? null).run()

  const templateId = tplMeta.last_row_id

  // Copiar páginas de la publicación como template_pages
  const { results: pages } = await c.env.DB.prepare(
    `SELECT image_url, page_number, canvas_json FROM pages WHERE publication_id = ? ORDER BY page_number ASC`
  ).bind(proposal.publication_id).all<{ image_url: string; page_number: number; canvas_json: string | null }>()

  for (const page of pages) {
    await c.env.DB.prepare(
      `INSERT INTO template_pages (template_id, image_url, page_number, canvas_json) VALUES (?, ?, ?, ?)`
    ).bind(templateId, page.image_url, page.page_number, page.canvas_json ?? null).run()
  }

  // Marcar propuesta como aprobada
  await c.env.DB.prepare(
    `UPDATE template_proposals SET status = 'approved', resolved_by = ?, resolved_at = datetime('now') WHERE id = ?`
  ).bind(user.sub, id).run()

  return c.json({ success: true, data: { template_id: templateId } })
})

// PATCH /admin/template-proposals/:id/reject — rechazar propuesta (solo admin)
proposals.patch('/admin/template-proposals/:id/reject', jwtMiddleware, async (c) => {
  const user = (c as any).get('user')
  const me = await c.env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(user.sub).first<{ is_admin: number }>()
  if (!me?.is_admin) return c.json({ success: false, error: 'Acceso denegado' }, 403)

  const id = c.req.param('id')
  const body = await c.req.json<{ admin_notes?: string }>().catch(() => ({}))

  const proposal = await c.env.DB.prepare(
    `SELECT id FROM template_proposals WHERE id = ? AND status = 'pending'`
  ).bind(id).first()

  if (!proposal) return c.json({ success: false, error: 'Propuesta no encontrada o ya procesada' }, 404)

  await c.env.DB.prepare(
    `UPDATE template_proposals SET status = 'rejected', admin_notes = ?, resolved_by = ?, resolved_at = datetime('now') WHERE id = ?`
  ).bind(body.admin_notes ?? null, user.sub, id).run()

  return c.json({ success: true })
})

export default proposals
