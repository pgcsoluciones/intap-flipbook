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

// ─── USERS ────────────────────────────────────────────────────────────────────

// GET /admin/users — list all users with usage stats
admin.get('/users', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT
      u.id, u.email, u.name, u.plan_id, u.is_admin, u.status,
      u.created_at, u.plan_expires_at,
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

// GET /admin/users/:id — tenant detail with payments
admin.get('/users/:id', async (c) => {
  const id = c.req.param('id')
  const user = await c.env.DB.prepare(`
    SELECT u.id, u.email, u.name, u.plan_id, u.is_admin, u.status,
      u.created_at, u.plan_expires_at, u.grace_period_days,
      COUNT(DISTINCT p.id) as pub_count,
      COALESCE(SUM(pg.size_bytes), 0) as total_bytes
    FROM users u
    LEFT JOIN publications p ON p.user_id = u.id
    LEFT JOIN pages pg ON pg.publication_id = p.id
    WHERE u.id = ?
    GROUP BY u.id
  `).bind(id).first()
  if (!user) return c.json({ success: false, error: 'Tenant no encontrado' }, 404)

  const { results: payments } = await c.env.DB.prepare(`
    SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC
  `).bind(id).all()

  return c.json({ success: true, data: { ...user, payments } })
})

// PUT /admin/users/:id/plan — change user plan
admin.put('/users/:id/plan', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ plan_id: string }>()
  if (!body.plan_id) return c.json({ success: false, error: 'plan_id es requerido' }, 400)

  const plan = await c.env.DB.prepare('SELECT id FROM plans WHERE id = ?').bind(body.plan_id).first()
  if (!plan) return c.json({ success: false, error: 'Plan no encontrado' }, 404)

  const adminId = c.get('user').sub
  const current = await c.env.DB.prepare('SELECT plan_id FROM users WHERE id = ?').bind(id).first<{ plan_id: string }>()

  await c.env.DB.prepare('UPDATE users SET plan_id = ? WHERE id = ?').bind(body.plan_id, id).run()
  await c.env.DB.prepare(
    'INSERT INTO plan_history (user_id, from_plan, to_plan, changed_by, reason) VALUES (?,?,?,?,?)'
  ).bind(id, current?.plan_id ?? null, body.plan_id, adminId, 'admin_manual').run()

  return c.json({ success: true })
})

// PUT /admin/users/:id/status — change user status
admin.put('/users/:id/status', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ status: string }>()
  const valid = ['active', 'suspended', 'degraded']
  if (!valid.includes(body.status)) return c.json({ success: false, error: 'Estado inválido' }, 400)

  await c.env.DB.prepare('UPDATE users SET status = ? WHERE id = ?').bind(body.status, id).run()
  return c.json({ success: true })
})

// PUT /admin/users/:id/limits — custom limits override (stored in plan or future column)
admin.put('/users/:id/limits', async (c) => {
  // Currently stored as a plan change note; full custom limits require additional columns
  const id = c.req.param('id')
  const body = await c.req.json<{ max_publications?: number | null; max_pages?: number | null; max_storage_mb?: number | null }>()
  // For now we store as a note in plan_history
  const adminId = c.get('user').sub
  await c.env.DB.prepare(
    'INSERT INTO plan_history (user_id, from_plan, to_plan, changed_by, reason) VALUES (?,?,?,?,?)'
  ).bind(id, null, 'custom', adminId, JSON.stringify(body)).run()
  return c.json({ success: true })
})

// PUT /admin/users/:id/admin — toggle admin flag
admin.put('/users/:id/admin', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ is_admin: boolean }>()
  await c.env.DB.prepare('UPDATE users SET is_admin = ? WHERE id = ?').bind(body.is_admin ? 1 : 0, id).run()
  return c.json({ success: true })
})

// DELETE /admin/users/:id — delete user and all their data
admin.delete('/users/:id', async (c) => {
  const targetId = c.req.param('id')
  await c.env.DB.prepare(
    `DELETE FROM pages WHERE publication_id IN (SELECT id FROM publications WHERE user_id = ?)`
  ).bind(targetId).run()
  await c.env.DB.prepare('DELETE FROM publications WHERE user_id = ?').bind(targetId).run()
  await c.env.DB.prepare('DELETE FROM payments WHERE user_id = ?').bind(targetId).run()
  await c.env.DB.prepare('DELETE FROM plan_requests WHERE user_id = ?').bind(targetId).run()
  await c.env.DB.prepare('DELETE FROM notifications WHERE user_id = ?').bind(targetId).run()
  await c.env.DB.prepare('DELETE FROM referrals WHERE referrer_id = ? OR referred_id = ?').bind(targetId, targetId).run()
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(targetId).run()
  return c.json({ success: true, data: { deleted: true } })
})

// ─── PLAN REQUESTS ────────────────────────────────────────────────────────────

// GET /admin/plan-requests
admin.get('/plan-requests', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT pr.*, u.email, u.name
    FROM plan_requests pr
    JOIN users u ON u.id = pr.user_id
    ORDER BY pr.created_at DESC
  `).all()
  return c.json({ success: true, data: results })
})

// PUT /admin/plan-requests/:id
admin.put('/plan-requests/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ action: 'approve' | 'reject'; notes?: string }>()
  const adminId = c.get('user').sub

  const req = await c.env.DB.prepare('SELECT * FROM plan_requests WHERE id = ?')
    .bind(id).first<{ user_id: string; requested_plan: string; status: string }>()
  if (!req) return c.json({ success: false, error: 'Solicitud no encontrada' }, 404)

  const newStatus = body.action === 'approve' ? 'approved' : 'rejected'
  await c.env.DB.prepare(
    'UPDATE plan_requests SET status = ?, resolved_at = datetime(\'now\'), resolved_by = ?, notes = COALESCE(?, notes) WHERE id = ?'
  ).bind(newStatus, adminId, body.notes ?? null, id).run()

  if (body.action === 'approve') {
    const current = await c.env.DB.prepare('SELECT plan_id FROM users WHERE id = ?')
      .bind(req.user_id).first<{ plan_id: string }>()
    await c.env.DB.prepare('UPDATE users SET plan_id = ? WHERE id = ?')
      .bind(req.requested_plan, req.user_id).run()
    await c.env.DB.prepare(
      'INSERT INTO plan_history (user_id, from_plan, to_plan, changed_by, reason) VALUES (?,?,?,?,?)'
    ).bind(req.user_id, current?.plan_id ?? null, req.requested_plan, adminId, 'plan_request_approved').run()
  }

  return c.json({ success: true })
})

// ─── PLANS ────────────────────────────────────────────────────────────────────

// GET /admin/plans
admin.get('/plans', async (c) => {
  const { results: plans } = await c.env.DB.prepare('SELECT * FROM plans ORDER BY price_usd ASC').all()
  const { results: counts } = await c.env.DB.prepare(
    'SELECT plan_id, COUNT(*) as count FROM users GROUP BY plan_id'
  ).all<{ plan_id: string; count: number }>()
  const countMap = Object.fromEntries(counts.map((r) => [r.plan_id, r.count]))
  const data = plans.map((p: any) => ({ ...p, tenant_count: countMap[p.id] ?? 0 }))
  return c.json({ success: true, data })
})

// POST /admin/plans
admin.post('/plans', async (c) => {
  const body = await c.req.json<any>()
  const id = body.id ?? body.name?.toLowerCase().replace(/\s+/g, '_')
  await c.env.DB.prepare(`
    INSERT INTO plans (id, name, max_publications, max_pages_per_pub, max_storage_mb, custom_domain, sound_enabled, price_usd, status)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).bind(
    id, body.name,
    body.max_publications ?? null, body.max_pages_per_pub ?? null, body.max_storage_mb ?? null,
    body.custom_domain ? 1 : 0, body.sound_enabled ? 1 : 0,
    body.price_usd ?? 0, body.status ?? 'active'
  ).run()
  return c.json({ success: true, data: { id } })
})

// PUT /admin/plans/:id
admin.put('/plans/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<any>()
  await c.env.DB.prepare(`
    UPDATE plans SET
      name = ?, max_publications = ?, max_pages_per_pub = ?, max_storage_mb = ?,
      custom_domain = ?, sound_enabled = ?, price_usd = ?, status = ?
    WHERE id = ?
  `).bind(
    body.name,
    body.max_publications ?? null, body.max_pages_per_pub ?? null, body.max_storage_mb ?? null,
    body.custom_domain ? 1 : 0, body.sound_enabled ? 1 : 0,
    body.price_usd ?? 0, body.status ?? 'active',
    id
  ).run()
  return c.json({ success: true })
})

// ─── PAYMENTS ─────────────────────────────────────────────────────────────────

// GET /admin/payments
admin.get('/payments', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT p.*, u.email, u.name
    FROM payments p
    JOIN users u ON u.id = p.user_id
    ORDER BY p.created_at DESC
    LIMIT 500
  `).all()
  return c.json({ success: true, data: results })
})

// POST /admin/payments — register manual payment
admin.post('/payments', async (c) => {
  const body = await c.req.json<any>()
  const adminId = c.get('user').sub
  const { meta } = await c.env.DB.prepare(`
    INSERT INTO payments (user_id, amount, currency, method, reference, status, plan_paid, period_days, notes, registered_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).bind(
    body.user_id, body.amount, body.currency ?? 'USD',
    body.method, body.reference ?? null, body.status ?? 'paid',
    body.plan_paid, body.period_days ?? 30, body.notes ?? null, adminId
  ).run()

  if (body.status === 'paid') {
    const current = await c.env.DB.prepare('SELECT plan_id FROM users WHERE id = ?')
      .bind(body.user_id).first<{ plan_id: string }>()
    await c.env.DB.prepare('UPDATE users SET plan_id = ? WHERE id = ?')
      .bind(body.plan_paid, body.user_id).run()
    await c.env.DB.prepare(
      'INSERT INTO plan_history (user_id, from_plan, to_plan, changed_by, reason) VALUES (?,?,?,?,?)'
    ).bind(body.user_id, current?.plan_id ?? null, body.plan_paid, adminId, 'manual_payment').run()
  }

  return c.json({ success: true, data: { id: meta.last_row_id } })
})

// ─── GATEWAYS ─────────────────────────────────────────────────────────────────

// GET /admin/gateways
admin.get('/gateways', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM payment_gateways ORDER BY sort_order ASC').all()
  return c.json({ success: true, data: results })
})

// PUT /admin/gateways/:id
admin.put('/gateways/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<any>()
  const existing = await c.env.DB.prepare('SELECT id FROM payment_gateways WHERE id = ?').bind(id).first()
  if (!existing) {
    await c.env.DB.prepare(
      'INSERT INTO payment_gateways (name, type, config_json, instructions, active, sort_order) VALUES (?,?,?,?,?,?)'
    ).bind(body.name, body.type, JSON.stringify(body.config ?? {}), body.instructions ?? null, body.active ? 1 : 0, body.sort_order ?? 0).run()
  } else {
    await c.env.DB.prepare(
      'UPDATE payment_gateways SET name = ?, config_json = ?, instructions = ?, sort_order = ? WHERE id = ?'
    ).bind(body.name, JSON.stringify(body.config ?? {}), body.instructions ?? null, body.sort_order ?? 0, id).run()
  }
  return c.json({ success: true })
})

// PATCH /admin/gateways/:id/toggle
admin.patch('/gateways/:id/toggle', async (c) => {
  const id = c.req.param('id')
  const gw = await c.env.DB.prepare('SELECT active FROM payment_gateways WHERE id = ?')
    .bind(id).first<{ active: number }>()
  if (!gw) return c.json({ success: false, error: 'Pasarela no encontrada' }, 404)
  await c.env.DB.prepare('UPDATE payment_gateways SET active = ? WHERE id = ?')
    .bind(gw.active ? 0 : 1, id).run()
  return c.json({ success: true })
})

// ─── MODULES ──────────────────────────────────────────────────────────────────

// GET /admin/modules
admin.get('/modules', async (c) => {
  const { results: mods } = await c.env.DB.prepare('SELECT * FROM modules ORDER BY id ASC').all()
  const { results: pm } = await c.env.DB.prepare('SELECT * FROM plan_modules').all<{ plan_id: string; module_key: string }>()
  const planMap: Record<string, string[]> = {}
  for (const r of pm) {
    if (!planMap[r.module_key]) planMap[r.module_key] = []
    planMap[r.module_key].push(r.plan_id)
  }
  const data = mods.map((m: any) => ({ ...m, plans: planMap[m.key] ?? [] }))
  return c.json({ success: true, data })
})

// PUT /admin/modules/:key/global — toggle active_globally
admin.put('/modules/:key/global', async (c) => {
  const key = c.req.param('key')
  const body = await c.req.json<{ active_globally: boolean }>()
  await c.env.DB.prepare('UPDATE modules SET active_globally = ? WHERE key = ?')
    .bind(body.active_globally ? 1 : 0, key).run()
  return c.json({ success: true })
})

// PUT /admin/modules/:key/plans — update which plans include this module
admin.put('/modules/:key/plans', async (c) => {
  const key = c.req.param('key')
  const body = await c.req.json<{ plans: string[] }>()
  await c.env.DB.prepare('DELETE FROM plan_modules WHERE module_key = ?').bind(key).run()
  for (const planId of body.plans) {
    await c.env.DB.prepare('INSERT OR IGNORE INTO plan_modules (plan_id, module_key) VALUES (?,?)')
      .bind(planId, key).run()
  }
  return c.json({ success: true })
})

// ─── PROMOTIONS ───────────────────────────────────────────────────────────────

// GET /admin/promotions
admin.get('/promotions', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM promotions ORDER BY created_at DESC').all()
  return c.json({ success: true, data: results })
})

// POST /admin/promotions
admin.post('/promotions', async (c) => {
  const body = await c.req.json<any>()
  const { meta } = await c.env.DB.prepare(`
    INSERT INTO promotions (title, description, benefit_type, benefit_value, target_plans, cta_text, cta_url, promo_code, starts_at, ends_at, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    body.title, body.description, body.benefit_type, String(body.benefit_value),
    typeof body.target_plans === 'string' ? body.target_plans : JSON.stringify(body.target_plans),
    body.cta_text ?? null, body.cta_url ?? null, body.promo_code ?? null,
    body.starts_at, body.ends_at, body.status ?? 'active'
  ).run()
  return c.json({ success: true, data: { id: meta.last_row_id } })
})

// PATCH /admin/promotions/:id/toggle
admin.patch('/promotions/:id/toggle', async (c) => {
  const id = c.req.param('id')
  const p = await c.env.DB.prepare('SELECT status FROM promotions WHERE id = ?')
    .bind(id).first<{ status: string }>()
  if (!p) return c.json({ success: false, error: 'Promoción no encontrada' }, 404)
  const next = p.status === 'active' ? 'paused' : 'active'
  await c.env.DB.prepare('UPDATE promotions SET status = ? WHERE id = ?').bind(next, id).run()
  return c.json({ success: true })
})

// DELETE /admin/promotions/:id
admin.delete('/promotions/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM promotions WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// ─── REFERRALS ────────────────────────────────────────────────────────────────

// GET /admin/referral-config
admin.get('/referral-config', async (c) => {
  const data = await c.env.DB.prepare('SELECT * FROM referral_config WHERE id = 1').first()
  return c.json({ success: true, data })
})

// PUT /admin/referral-config
admin.put('/referral-config', async (c) => {
  const body = await c.req.json<any>()
  await c.env.DB.prepare(`
    UPDATE referral_config SET active = ?, reward_type = ?, reward_value = ?, activation_condition = ?, link_validity_days = ?
    WHERE id = 1
  `).bind(
    body.active ? 1 : 0, body.reward_type, body.reward_value,
    body.activation_condition, body.link_validity_days ?? 0
  ).run()
  return c.json({ success: true })
})

// GET /admin/referrals
admin.get('/referrals', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT r.*, u1.email as referrer_email, u2.email as referred_email
    FROM referrals r
    JOIN users u1 ON u1.id = r.referrer_id
    JOIN users u2 ON u2.id = r.referred_id
    ORDER BY r.created_at DESC
  `).all()
  return c.json({ success: true, data: results })
})

// PUT /admin/referrals/:id — approve or reject
admin.put('/referrals/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ action: 'approve' | 'reject'; reason?: string }>()
  const adminId = c.get('user').sub
  const newStatus = body.action === 'approve' ? 'approved' : 'rejected'
  await c.env.DB.prepare(`
    UPDATE referrals SET status = ?, resolved_at = datetime('now'), resolved_by = ?, reject_reason = ?
    WHERE id = ?
  `).bind(newStatus, adminId, body.reason ?? null, id).run()
  return c.json({ success: true })
})

// ─── BRANDING ─────────────────────────────────────────────────────────────────

// GET /admin/branding
admin.get('/branding', async (c) => {
  const data = await c.env.DB.prepare('SELECT * FROM watermark_config WHERE id = 1').first()
  return c.json({ success: true, data })
})

// PUT /admin/branding
admin.put('/branding', async (c) => {
  const body = await c.req.json<any>()
  await c.env.DB.prepare(`
    UPDATE watermark_config SET text = ?, logo_url = ?, link_url = ?, position = ?, opacity = ?
    WHERE id = 1
  `).bind(
    body.text ?? 'Creado con Intap Flipbook',
    body.logo_url ?? null,
    body.link_url ?? 'https://intapflipbook.com',
    body.position ?? 'bottom-right',
    body.opacity ?? 80
  ).run()
  return c.json({ success: true })
})

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

// GET /admin/notifications — history
admin.get('/notifications', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT n.*, u.email
    FROM notifications n
    LEFT JOIN users u ON u.id = n.user_id
    ORDER BY n.created_at DESC
    LIMIT 200
  `).all()
  return c.json({ success: true, data: results })
})

// POST /admin/notifications — send or schedule
admin.post('/notifications', async (c) => {
  const body = await c.req.json<any>()
  // If user_id is null or 'all', send to all users
  if (!body.user_id || body.user_id === 'all') {
    const { results: users } = await c.env.DB.prepare('SELECT id FROM users WHERE is_admin = 0').all<{ id: string }>()
    for (const u of users) {
      await c.env.DB.prepare(
        'INSERT INTO notifications (user_id, title, message, channel, scheduled_at) VALUES (?,?,?,?,?)'
      ).bind(u.id, body.title, body.message, body.channel ?? 'in_app', body.scheduled_at ?? null).run()
    }
    return c.json({ success: true, data: { sent: users.length } })
  }
  await c.env.DB.prepare(
    'INSERT INTO notifications (user_id, title, message, channel, scheduled_at) VALUES (?,?,?,?,?)'
  ).bind(body.user_id, body.title, body.message, body.channel ?? 'in_app', body.scheduled_at ?? null).run()
  return c.json({ success: true })
})

// ─── RESOURCES ────────────────────────────────────────────────────────────────

// GET /admin/resources
admin.get('/resources', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM editor_elements ORDER BY sort_order ASC, id DESC').all()
  return c.json({ success: true, data: results })
})

// POST /admin/resources
admin.post('/resources', async (c) => {
  const body = await c.req.json<any>()
  const { meta } = await c.env.DB.prepare(
    'INSERT INTO editor_elements (name, type, file_url, plan_required, active, sort_order) VALUES (?,?,?,?,?,?)'
  ).bind(
    body.name, body.type, body.file_url,
    body.plan_required ?? 'free', body.active !== false ? 1 : 0, body.sort_order ?? 0
  ).run()
  return c.json({ success: true, data: { id: meta.last_row_id } })
})

// PUT /admin/resources/:id
admin.put('/resources/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<any>()
  await c.env.DB.prepare(
    'UPDATE editor_elements SET name = ?, type = ?, file_url = ?, plan_required = ?, active = ?, sort_order = ? WHERE id = ?'
  ).bind(body.name, body.type, body.file_url, body.plan_required ?? 'free', body.active !== false ? 1 : 0, body.sort_order ?? 0, id).run()
  return c.json({ success: true })
})

// DELETE /admin/resources/:id
admin.delete('/resources/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM editor_elements WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// ─── STATS ────────────────────────────────────────────────────────────────────

// GET /admin/stats — global stats
admin.get('/stats', async (c) => {
  const [users, pubs, pages] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM publications').first<{ count: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as count, COALESCE(SUM(size_bytes),0) as bytes FROM pages').first<{ count: number; bytes: number }>(),
  ])
  const { results: byPlan } = await c.env.DB.prepare(
    'SELECT plan_id, COUNT(*) as count FROM users GROUP BY plan_id'
  ).all()
  return c.json({
    success: true,
    data: {
      users: users?.count ?? 0,
      publications: pubs?.count ?? 0,
      pages: pages?.count ?? 0,
      storage_mb: parseFloat(((pages?.bytes ?? 0) / 1024 / 1024).toFixed(2)),
      by_plan: byPlan,
    },
  })
})

// GET /admin/stats/top-publications
admin.get('/stats/top-publications', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT p.id, p.title, p.public_slug, p.views_count, u.email
    FROM publications p
    JOIN users u ON u.id = p.user_id
    ORDER BY p.views_count DESC
    LIMIT 10
  `).all()
  return c.json({ success: true, data: results })
})

// GET /admin/stats/recent-views
admin.get('/stats/recent-views', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT pv.*, p.title, p.public_slug
    FROM publication_views pv
    JOIN publications p ON p.id = pv.publication_id
    ORDER BY pv.viewed_at DESC
    LIMIT 20
  `).all()
  return c.json({ success: true, data: results })
})

export default admin
