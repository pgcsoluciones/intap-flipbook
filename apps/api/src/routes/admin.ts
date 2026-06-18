import { Hono } from 'hono'
import { jwtMiddleware } from '../middleware/jwt'
import { signJwt } from '../lib/jwt'
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

// PUT /admin/users/:id/limits — custom limits override per-tenant
admin.put('/users/:id/limits', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ max_publications?: number | null; max_pages?: number | null; max_storage_mb?: number | null }>()
  await c.env.DB.prepare(
    `UPDATE users SET
      custom_max_publications = ?,
      custom_max_pages = ?,
      custom_max_storage_mb = ?
     WHERE id = ?`
  ).bind(
    body.max_publications ?? null,
    body.max_pages ?? null,
    body.max_storage_mb ?? null,
    id
  ).run()
  return c.json({ success: true })
})

// PUT /admin/users/:id/watermark — fuerza mostrar/ocultar la marca de agua por tenant
// 'plan' = según el plan (free=muestra, pago=oculta); 'force_show' = siempre; 'force_hide' = nunca
admin.put('/users/:id/watermark', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ watermark_override?: string }>()
  const allowed = ['plan', 'force_show', 'force_hide']
  const value = allowed.includes(body.watermark_override ?? '') ? body.watermark_override : 'plan'
  await c.env.DB.prepare('UPDATE users SET watermark_override = ? WHERE id = ?').bind(value, id).run()
  return c.json({ success: true })
})

// PUT /admin/users/:id/admin — toggle admin flag
admin.put('/users/:id/admin', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ is_admin: boolean }>()
  await c.env.DB.prepare('UPDATE users SET is_admin = ? WHERE id = ?').bind(body.is_admin ? 1 : 0, id).run()
  return c.json({ success: true })
})

// POST /admin/users/:id/impersonate — emite JWT de corta duración para ese tenant
admin.post('/users/:id/impersonate', async (c) => {
  const id = c.req.param('id')
  const user = await c.env.DB.prepare('SELECT id, email FROM users WHERE id = ?')
    .bind(id).first<{ id: string; email: string }>()
  if (!user) return c.json({ success: false, error: 'Usuario no encontrado' }, 404)
  const token = await signJwt(
    { sub: user.id, email: user.email, impersonated: true },
    c.env.JWT_SECRET,
    1,
  )
  return c.json({ success: true, data: { token, user } })
})

// GET /admin/users/:id/modules — módulos del tenant con estado enabled
admin.get('/users/:id/modules', async (c) => {
  const id = c.req.param('id')
  const { results } = await c.env.DB.prepare(
    `SELECT m.key, m.name, m.description, m.active_globally,
            COALESCE(tm.enabled, m.active_globally) as enabled
     FROM modules m
     LEFT JOIN tenant_modules tm ON tm.module_key = m.key AND tm.user_id = ?
     ORDER BY m.key ASC`
  ).bind(id).all()
  return c.json({ success: true, data: results })
})

// PUT /admin/users/:id/modules/:key — toggle módulo para un tenant específico
admin.put('/users/:id/modules/:key', async (c) => {
  const id = c.req.param('id')
  const key = c.req.param('key')
  const body = await c.req.json<{ enabled: boolean }>()
  await c.env.DB.prepare(
    `INSERT INTO tenant_modules (user_id, module_key, enabled) VALUES (?, ?, ?)
     ON CONFLICT(user_id, module_key) DO UPDATE SET enabled = excluded.enabled`
  ).bind(id, key, body.enabled ? 1 : 0).run()
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
    const planRow = await c.env.DB.prepare('SELECT period_days FROM plans WHERE id = ?')
      .bind(req.requested_plan).first<{ period_days: number | null }>()
    const periodDays = planRow?.period_days ?? 30
    await c.env.DB.prepare(
      `UPDATE users SET plan_id = ?,
        plan_expires_at = datetime(COALESCE(
          CASE WHEN plan_expires_at > datetime('now') THEN plan_expires_at ELSE NULL END,
          datetime('now')
        ), '+' || ? || ' days')
       WHERE id = ?`
    ).bind(req.requested_plan, periodDays, req.user_id).run()
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
    const periodDays = Number(body.period_days ?? 30)
    await c.env.DB.prepare(
      `UPDATE users SET plan_id = ?,
        plan_expires_at = datetime(COALESCE(
          CASE WHEN plan_expires_at > datetime('now') THEN plan_expires_at ELSE NULL END,
          datetime('now')
        ), '+' || ? || ' days')
       WHERE id = ?`
    ).bind(body.plan_paid, periodDays, body.user_id).run()
    await c.env.DB.prepare(
      'INSERT INTO plan_history (user_id, from_plan, to_plan, changed_by, reason) VALUES (?,?,?,?,?)'
    ).bind(body.user_id, current?.plan_id ?? null, body.plan_paid, adminId, 'manual_payment').run()
  }

  return c.json({ success: true, data: { id: meta.last_row_id } })
})

// ─── GATEWAYS ─────────────────────────────────────────────────────────────────
// Las pasarelas son un conjunto fijo de 5 tipos. Se identifican por `type`
// (no por id autoincremental) para que el frontend pueda crearlas/togglearlas
// aunque todavía no existan en D1 (upsert por type).

const GATEWAY_NAMES: Record<string, string> = {
  transfer: 'Transferencia bancaria',
  deposit:  'Depósito en efectivo',
  paypal:   'PayPal',
  readdy:   'Readdy (CardNet)',
  custom:   'Otro / Custom',
}

// GET /admin/gateways
admin.get('/gateways', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM payment_gateways ORDER BY sort_order ASC').all()
  const data = (results as any[]).map((g) => ({
    ...g,
    active: !!g.active,
    config_json: (() => { try { return JSON.parse(g.config_json ?? '{}') } catch { return {} } })(),
  }))
  return c.json({ success: true, data })
})

// PUT /admin/gateways/:type — upsert config por type
admin.put('/gateways/:type', async (c) => {
  const type = c.req.param('type')
  const body = await c.req.json<any>()
  const name = body.name ?? GATEWAY_NAMES[type] ?? type
  const configJson = JSON.stringify(body.config_json ?? body.config ?? {})
  const existing = await c.env.DB.prepare('SELECT id FROM payment_gateways WHERE type = ?').bind(type).first()
  if (!existing) {
    await c.env.DB.prepare(
      'INSERT INTO payment_gateways (name, type, config_json, instructions, active, sort_order) VALUES (?,?,?,?,?,?)'
    ).bind(name, type, configJson, body.instructions ?? null, body.active ? 1 : 0, body.sort_order ?? 0).run()
  } else {
    await c.env.DB.prepare(
      'UPDATE payment_gateways SET config_json = ?, instructions = ? WHERE type = ?'
    ).bind(configJson, body.instructions ?? null, type).run()
  }
  const row = await c.env.DB.prepare('SELECT * FROM payment_gateways WHERE type = ?').bind(type).first<any>()
  const data = row ? { ...row, active: !!row.active, config_json: (() => { try { return JSON.parse(row.config_json ?? '{}') } catch { return {} } })() } : null
  return c.json({ success: true, data })
})

// PATCH /admin/gateways/:type/toggle — upsert + flip active por type
admin.patch('/gateways/:type/toggle', async (c) => {
  const type = c.req.param('type')
  const body = await c.req.json<{ active?: boolean }>().catch(() => ({} as { active?: boolean }))
  const name = GATEWAY_NAMES[type] ?? type
  const existing = await c.env.DB.prepare('SELECT id, active FROM payment_gateways WHERE type = ?')
    .bind(type).first<{ id: number; active: number }>()
  const newActive = body.active !== undefined
    ? (body.active ? 1 : 0)
    : (existing ? (existing.active ? 0 : 1) : 1)
  if (!existing) {
    await c.env.DB.prepare(
      'INSERT INTO payment_gateways (name, type, config_json, instructions, active, sort_order) VALUES (?,?,?,?,?,?)'
    ).bind(name, type, '{}', null, newActive, 0).run()
  } else {
    await c.env.DB.prepare('UPDATE payment_gateways SET active = ? WHERE type = ?')
      .bind(newActive, type).run()
  }
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
  // El frontend lee `active`; la DB guarda `active_globally`. Exponer ambos.
  const data = mods.map((m: any) => ({
    ...m,
    active: m.active_globally === 1,
    plans: planMap[m.key] ?? [],
  }))
  return c.json({ success: true, data })
})

// PUT /admin/modules/:key/global — toggle active_globally (UPSERT: crea la fila si no existe)
admin.put('/modules/:key/global', async (c) => {
  const key = c.req.param('key')
  const body = await c.req.json<{ active?: boolean; active_globally?: boolean; name?: string; description?: string }>()
  const isActive = body.active ?? body.active_globally ?? false
  // INSERT OR REPLACE garantiza que la fila exista aunque la tabla esté vacía
  await c.env.DB.prepare(`
    INSERT INTO modules (key, name, description, active_globally) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET active_globally = excluded.active_globally
  `).bind(key, body.name ?? key, body.description ?? '', isActive ? 1 : 0).run()
  return c.json({ success: true })
})

// PUT /admin/modules/:key/plans — update which plans include this module (UPSERT primero la fila)
admin.put('/modules/:key/plans', async (c) => {
  const key = c.req.param('key')
  const body = await c.req.json<{ plans: string[]; name?: string; description?: string }>()
  // Garantizar que la fila del módulo exista antes de insertar en plan_modules
  await c.env.DB.prepare(`INSERT OR IGNORE INTO modules (key, name, description, active_globally) VALUES (?, ?, ?, 1)`)
    .bind(key, body.name ?? key, body.description ?? '').run()
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
    INSERT INTO promotions (title, description, benefit_type, benefit_value, target_plans, cta_text, cta_url, promo_code, image_url, starts_at, ends_at, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    body.title, body.description, body.benefit_type, String(body.benefit_value),
    typeof body.target_plans === 'string' ? body.target_plans : JSON.stringify(body.target_plans),
    body.cta_text ?? null, body.cta_url ?? null, body.promo_code ?? null,
    body.image_url ?? null,
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

  const ref = await c.env.DB.prepare('SELECT * FROM referrals WHERE id = ?')
    .bind(id).first<{ referrer_id: string; reward_applied: number }>()

  await c.env.DB.prepare(`
    UPDATE referrals SET status = ?, resolved_at = datetime('now'), resolved_by = ?, reject_reason = ?
    WHERE id = ?
  `).bind(newStatus, adminId, body.reason ?? null, id).run()

  if (body.action === 'approve' && ref && !ref.reward_applied) {
    const config = await c.env.DB.prepare('SELECT reward_type, reward_value FROM referral_config WHERE id = 1')
      .first<{ reward_type: string; reward_value: number }>()
    if (config?.reward_type === 'free_days') {
      const days = config.reward_value ?? 15
      await c.env.DB.prepare(
        `UPDATE users SET
          plan_expires_at = datetime(COALESCE(
            CASE WHEN plan_expires_at > datetime('now') THEN plan_expires_at ELSE NULL END,
            datetime('now')
          ), '+' || ? || ' days')
         WHERE id = ?`
      ).bind(days, ref.referrer_id).run()
    }
    await c.env.DB.prepare('UPDATE referrals SET reward_applied = 1 WHERE id = ?').bind(id).run()
  }

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

// ─── TEMPLATES ────────────────────────────────────────────────────────────────

// GET /admin/templates
admin.get('/templates', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM templates ORDER BY sort_order ASC, id DESC').all()
  return c.json({ success: true, data: results })
})

// POST /admin/templates
admin.post('/templates', async (c) => {
  const body = await c.req.json<any>()
  const { meta } = await c.env.DB.prepare(
    'INSERT INTO templates (name, plan_required, cover_url, active, sort_order) VALUES (?,?,?,?,?)'
  ).bind(
    body.name,
    body.plan_required ?? 'free',
    body.cover_url ?? null,
    body.active !== false ? 1 : 0,
    body.sort_order ?? 0
  ).run()
  return c.json({ success: true, data: { id: meta.last_row_id } })
})

// PUT /admin/templates/:id
admin.put('/templates/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<any>()
  await c.env.DB.prepare(
    'UPDATE templates SET name = ?, plan_required = ?, cover_url = ?, active = ?, sort_order = ? WHERE id = ?'
  ).bind(
    body.name,
    body.plan_required ?? 'free',
    body.cover_url ?? null,
    body.active !== false ? 1 : 0,
    body.sort_order ?? 0,
    id
  ).run()
  return c.json({ success: true })
})

// DELETE /admin/templates/:id
admin.delete('/templates/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM templates WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// ─── TUTORIALS ────────────────────────────────────────────────────────────────

// GET /admin/tutorials
admin.get('/tutorials', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM tutorials ORDER BY sort_order ASC, id DESC').all()
  return c.json({ success: true, data: results })
})

// POST /admin/tutorials
admin.post('/tutorials', async (c) => {
  const body = await c.req.json<any>()
  const { meta } = await c.env.DB.prepare(
    'INSERT INTO tutorials (title, category, type, url, content, thumbnail_url, sort_order, active) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(
    body.title,
    body.category,
    body.type,
    body.url ?? null,
    body.content ?? null,
    body.thumbnail_url ?? null,
    body.sort_order ?? 0,
    body.active !== false ? 1 : 0
  ).run()
  return c.json({ success: true, data: { id: meta.last_row_id } })
})

// PUT /admin/tutorials/:id
admin.put('/tutorials/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<any>()
  await c.env.DB.prepare(
    'UPDATE tutorials SET title = ?, category = ?, type = ?, url = ?, content = ?, thumbnail_url = ?, sort_order = ?, active = ? WHERE id = ?'
  ).bind(
    body.title,
    body.category,
    body.type,
    body.url ?? null,
    body.content ?? null,
    body.thumbnail_url ?? null,
    body.sort_order ?? 0,
    body.active !== false ? 1 : 0,
    id
  ).run()
  return c.json({ success: true })
})

// DELETE /admin/tutorials/:id
admin.delete('/tutorials/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM tutorials WHERE id = ?').bind(id).run()
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
