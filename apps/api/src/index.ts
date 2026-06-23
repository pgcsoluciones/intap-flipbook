import { Hono } from 'hono'
import { cors } from 'hono/cors'
import authRoutes from './routes/auth'
import publicationRoutes from './routes/publications'
import pageRoutes from './routes/pages'
import uploadRoutes from './routes/upload'
import adminRoutes from './routes/admin'
import proposalRoutes from './routes/proposals'
import unitRoutes from './routes/units'
import svgRoutes from './routes/svg'
import { jwtMiddleware } from './middleware/jwt'
import { getUserPlan, getPlanUsage } from './lib/plans'
import type { AuthVariables } from './middleware/jwt'

export type Env = {
  DB: D1Database
  SESSIONS: KVNamespace
  MEDIA: R2Bucket
  JWT_SECRET: string
  CORS_ORIGIN: string
  JWT_EXPIRY_DAYS: string
  R2_PUBLIC_BASE_URL: string
}

const app = new Hono<{ Bindings: Env }>()

app.use('*', async (c, next) => {
  const allowedOrigins = c.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  const corsMiddleware = cors({
    origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    // navigator.sendBeacon() (analítica del viewer) siempre envía la petición en modo
    // credentials:'include'. El navegador entonces exige Access-Control-Allow-Credentials:true
    // en la respuesta del preflight, o bloquea la petición. Esta opción agrega ese header.
    credentials: true,
    maxAge: 86400,
  })
  return corsMiddleware(c, next)
})

app.get('/', (c) => c.json({ service: 'intap-flipbook-api', status: 'ok' }))

// Auth (public)
app.route('/auth', authRoutes)

// Protected API
app.route('/api/publications', publicationRoutes)
app.route('/api', pageRoutes)
app.route('/api/upload', uploadRoutes)
app.route('/admin', adminRoutes)
app.route('/admin/svg', svgRoutes)
app.route('/', proposalRoutes)
app.route('/api/units', unitRoutes)

// Plan usage — protected
app.get('/api/me/usage', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const { plan } = await getUserPlan(c.env.DB, userId)
  const usage = await getPlanUsage(c.env.DB, userId, plan)
  return c.json({ success: true, data: usage })
})

// Biblioteca SVG disponible para el tenant — filtrada por su plan.
// Los recursos de plan superior se devuelven con locked=true (incentivo de upgrade),
// salvo que el recurso tenga visible_to_lower_plans=0 (entonces se ocultan).
// Parámetro opcional ?module= para filtrar por módulo (canvas_insert_svg, button_icon_picker...).
app.get('/api/svg', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const { planId: plan } = await getUserPlan(c.env.DB, userId)
  const moduleFilter = c.req.query('module')

  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.name, r.slug, r.family_id, r.category, r.tags,
            r.available_modules, r.plans, r.visible_to_lower_plans, r.upgrade_message,
            r.editable_colors, r.editable_stroke, r.editable_layers,
            r.editable_gradients, r.editable_geometry, r.svg_url, r.preview_url, r.version,
            f.name as family_name
     FROM svg_resources r
     LEFT JOIN svg_families f ON f.id = r.family_id
     WHERE r.status = 'active'
       AND (r.scope = 'global' OR (r.scope = 'tenant' AND r.tenant_id = ?))
     ORDER BY r.name ASC`
  ).bind(userId).all<any>()

  // Orden de planes para decidir si un recurso está "por encima" del plan del tenant.
  const RANK: Record<string, number> = { free: 0, basic: 1, pro: 2 }
  const myRank = RANK[plan] ?? 0

  const data = (results ?? []).flatMap((r: any) => {
    const plans: string[] = safeParse(r.plans, [])
    const modules: string[] = safeParse(r.available_modules, [])
    if (moduleFilter && modules.length && !modules.includes(moduleFilter)) return []

    // ¿El plan del tenant está permitido? Si no, está bloqueado.
    const allowed = plans.length === 0 || plans.includes(plan)
    // Plan mínimo requerido (el de menor rank entre los permitidos)
    const minRank = plans.length ? Math.min(...plans.map((p) => RANK[p] ?? 99)) : 0
    const locked = !allowed && minRank > myRank
    // Si está bloqueado y NO es visible a planes inferiores, se oculta por completo.
    if (locked && !r.visible_to_lower_plans) return []

    return [{
      id: r.id, name: r.name, slug: r.slug, family_id: r.family_id,
      family_name: r.family_name, category: r.category,
      tags: safeParse(r.tags, []), modules,
      svg_url: locked ? null : r.svg_url, // no exponemos la fuente de recursos bloqueados
      preview_url: r.preview_url, version: r.version,
      editable: {
        colors: !!r.editable_colors, stroke: !!r.editable_stroke,
        layers: !!r.editable_layers, gradients: !!r.editable_gradients,
        geometry: !!r.editable_geometry,
      },
      locked,
      required_plan: locked ? (Object.keys(RANK).find((k) => RANK[k] === minRank) ?? null) : null,
      upgrade_message: locked ? r.upgrade_message : null,
    }]
  })

  return c.json({ success: true, data })
})

// Módulos activos para este tenant
app.get('/api/me/modules', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const { results } = await c.env.DB.prepare(
    `SELECT m.key, m.name, m.description,
            COALESCE(tm.enabled, m.active_globally) as enabled
     FROM modules m
     LEFT JOIN tenant_modules tm ON tm.module_key = m.key AND tm.user_id = ?
     WHERE m.active_globally = 1 OR tm.enabled = 1
     ORDER BY m.key ASC`
  ).bind(userId).all()
  return c.json({ success: true, data: results })
})

// ── Carpetas ──────────────────────────────────────────────────────────────────
app.get('/api/folders', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const { results } = await c.env.DB.prepare(
    `SELECT f.id, f.name, f.created_at, COUNT(p.id) as pub_count
     FROM folders f
     LEFT JOIN publications p ON p.folder_id = f.id
     WHERE f.user_id = ?
     GROUP BY f.id ORDER BY f.name ASC`
  ).bind(userId).all()
  return c.json({ success: true, data: results })
})

app.post('/api/folders', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const body = await c.req.json<{ name: string }>()
  if (!body.name?.trim()) return c.json({ success: false, error: 'El nombre es requerido' }, 400)
  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO folders (id, user_id, name) VALUES (?,?,?)').bind(id, userId, body.name.trim()).run()
  return c.json({ success: true, data: { id, name: body.name.trim(), pub_count: 0 } }, 201)
})

app.put('/api/folders/:id', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const fid = c.req.param('id')
  const body = await c.req.json<{ name: string }>()
  if (!body.name?.trim()) return c.json({ success: false, error: 'El nombre es requerido' }, 400)
  await c.env.DB.prepare('UPDATE folders SET name = ? WHERE id = ? AND user_id = ?').bind(body.name.trim(), fid, userId).run()
  return c.json({ success: true })
})

app.delete('/api/folders/:id', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const fid = c.req.param('id')
  await c.env.DB.prepare('UPDATE publications SET folder_id = NULL WHERE folder_id = ? AND user_id = ?').bind(fid, userId).run()
  await c.env.DB.prepare('DELETE FROM folders WHERE id = ? AND user_id = ?').bind(fid, userId).run()
  return c.json({ success: true })
})

app.patch('/api/publications/:id/folder', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const pubId = c.req.param('id')
  const body = await c.req.json<{ folder_id: string | null }>()
  await c.env.DB.prepare('UPDATE publications SET folder_id = ? WHERE id = ? AND user_id = ?')
    .bind(body.folder_id ?? null, pubId, userId).run()
  return c.json({ success: true })
})

// Public feed — publicaciones publicadas de un tenant por slug — sin auth
app.get('/public/:tenantSlug', async (c) => {
  const tenantSlug = c.req.param('tenantSlug')
  const tenant = await c.env.DB.prepare(
    `SELECT id FROM users WHERE slug = ?`
  ).bind(tenantSlug).first<{ id: string }>()

  if (!tenant) return c.json({ success: true, data: [] })

  const { results } = await c.env.DB.prepare(
    `SELECT id, title, description, category, cover_image_url, public_slug, views_count, updated_at
     FROM publications
     WHERE user_id = ? AND status = 'published' AND deleted_at IS NULL
     ORDER BY updated_at DESC`
  ).bind(tenant.id).all()

  return c.json({ success: true, data: results ?? [] })
})

// Endpoint público de unidades para el viewer (sin auth)
app.get('/view/units', async (c) => {
  const pubId = c.req.query('publication_id')
  if (!pubId) return c.json({ success: false, error: 'publication_id requerido' }, 400)
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM units WHERE publication_id = ? ORDER BY floor ASC, unit_number ASC, name ASC`
  ).bind(pubId).all()
  return c.json({ success: true, data: results })
})

// Public viewer endpoint — no auth required
app.get('/view/:slug', async (c) => {
  const slug = c.req.param('slug')
  const pub = await c.env.DB.prepare(
    `SELECT p.id, p.title, p.description, p.cover_image_url, p.sound_enabled,
            p.project_phone, p.project_whatsapp, p.project_location,
            p.project_address, p.project_developer, p.project_website,
            u.plan_id, u.watermark_override, u.watermark_tenant
     FROM publications p
     JOIN users u ON u.id = p.user_id
     WHERE p.public_slug = ? AND p.status = 'published'`,
  )
    .bind(slug)
    .first<{
      id: string
      title: string
      description: string | null
      cover_image_url: string | null
      sound_enabled: number
      project_phone: string | null
      project_whatsapp: string | null
      project_location: string | null
      project_address: string | null
      project_developer: string | null
      project_website: string | null
      plan_id: string
      watermark_override: string
      watermark_tenant: string | null
    }>()

  if (!pub) return c.json({ success: false, error: 'Publication not found' }, 404)

  const [{ results: pages }, wmConfig] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, page_number, image_url, title, description, price, canvas_json
       FROM pages WHERE publication_id = ? ORDER BY page_number ASC`,
    ).bind(pub.id).all(),
    c.env.DB.prepare('SELECT text, link_url, position, opacity FROM watermark_config WHERE id = 1').first<{
      text: string; link_url: string; position: string; opacity: number
    }>(),
  ])

  // Prioridad: 1) free siempre activa, 2) elección del tenant, 3) override del admin, 4) default por plan
  const planIsFree = pub.plan_id === 'free'
  const tenantChoice = pub.watermark_tenant   // 'show' | 'hide' | null
  const adminOverride = pub.watermark_override ?? 'plan'  // 'force_show' | 'force_hide' | 'plan'
  const planDefault = pub.plan_id === 'basic'  // basic=true(activa), pro=false(oculta)
  const watermarkEnabled =
    planIsFree ? true :
    tenantChoice === 'show' ? true :
    tenantChoice === 'hide' ? false :
    adminOverride === 'force_show' ? true :
    adminOverride === 'force_hide' ? false :
    planDefault

  return c.json({
    success: true,
    data: {
      id: pub.id,
      title: pub.title,
      description: pub.description,
      cover_image_url: pub.cover_image_url,
      sound_enabled: pub.sound_enabled === 1,
      project_phone: pub.project_phone,
      project_whatsapp: pub.project_whatsapp,
      project_location: pub.project_location,
      project_address: pub.project_address,
      project_developer: pub.project_developer,
      project_website: pub.project_website,
      watermark_enabled: watermarkEnabled,
      watermark: wmConfig ?? { text: 'Intap Flipbook', link_url: 'https://intapflipbook.com', position: 'bottom-right', opacity: 80 },
      pages,
    },
  })
})

// Tenant: listar sus notificaciones (con auth)
app.get('/api/notifications', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const { results } = await c.env.DB.prepare(
    `SELECT id, title, message, read, created_at
     FROM notifications
     WHERE user_id = ? OR user_id IS NULL
     ORDER BY created_at DESC LIMIT 30`
  ).bind(userId).all()
  return c.json({ success: true, data: results })
})

// Tenant: marcar notificación como leída
app.patch('/api/notifications/:id/read', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const id = c.req.param('id')
  await c.env.DB.prepare(
    `UPDATE notifications SET read = 1 WHERE id = ? AND (user_id = ? OR user_id IS NULL)`
  ).bind(id, userId).run()
  return c.json({ success: true })
})

// Tenant: solicitar cambio de plan
app.post('/api/plan-requests', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const body = await c.req.json<{ requested_plan: string; notes?: string }>().catch(() => ({}))
  if (!body.requested_plan) return c.json({ success: false, error: 'requested_plan es requerido' }, 400)

  const plan = await c.env.DB.prepare('SELECT id FROM plans WHERE id = ? AND status = ?')
    .bind(body.requested_plan, 'active').first()
  if (!plan) return c.json({ success: false, error: 'Plan no encontrado' }, 404)

  const currentUser = await c.env.DB.prepare('SELECT plan_id FROM users WHERE id = ?').bind(userId).first<{ plan_id: string }>()
  const RANK: Record<string, number> = { free: 0, basic: 1, pro: 2 }
  const currentRank = RANK[currentUser?.plan_id ?? 'free'] ?? 0
  const requestedRank = RANK[body.requested_plan] ?? 0
  const direction = requestedRank >= currentRank ? 'upgrade' : 'downgrade'

  // Cancelar solicitudes pendientes anteriores del mismo usuario
  await c.env.DB.prepare(
    `UPDATE plan_requests SET status = 'cancelled' WHERE user_id = ? AND status = 'pending'`
  ).bind(userId).run()

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO plan_requests (user_id, requested_plan, direction, status, notes) VALUES (?, ?, ?, 'pending', ?)`
  ).bind(userId, body.requested_plan, direction, body.notes ?? null).run()

  return c.json({ success: true, data: { id: meta.last_row_id } }, 201)
})

// Tenant: ver sus solicitudes de plan
app.get('/api/plan-requests', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const { results } = await c.env.DB.prepare(
    `SELECT pr.*, p.name as plan_name FROM plan_requests pr
     LEFT JOIN plans p ON p.id = pr.requested_plan
     WHERE pr.user_id = ? ORDER BY pr.created_at DESC LIMIT 10`
  ).bind(userId).all()
  return c.json({ success: true, data: results })
})

// Parsea JSON de forma segura, devolviendo un fallback si falla.
function safeParse<T>(raw: any, fallback: T): T {
  if (raw == null) return fallback
  if (typeof raw !== 'string') return raw as T
  try { return JSON.parse(raw) as T } catch { return fallback }
}

// Detecta el tipo de dispositivo desde el User-Agent HTTP
function detectDevice(ua: string | undefined): string {
  if (!ua) return 'desktop'
  if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) return 'tablet'
  if (/Mobi|Android.*Mobile|iPhone/i.test(ua)) return 'mobile'
  return 'desktop'
}

// Registra una vista de publicación — público (sin auth), fire-and-forget
app.post('/view/:slug/track', async (c) => {
  const slug = c.req.param('slug')
  const pub = await c.env.DB.prepare(
    `SELECT id FROM publications WHERE public_slug = ? AND status = 'published'`
  ).bind(slug).first<{ id: string }>()
  if (!pub) return c.json({ success: false }, 404)

  const device = detectDevice(c.req.header('user-agent'))
  const cf = (c.req.raw as any).cf ?? {}
  const country = cf.country ?? null
  const city = cf.city ?? null
  const referrer = c.req.header('referer') ?? c.req.header('referrer') ?? null

  try {
    await Promise.all([
      c.env.DB.prepare(
        `INSERT INTO publication_views (publication_id, device, country, city, referrer) VALUES (?, ?, ?, ?, ?)`
      ).bind(pub.id, device, country, city, referrer).run(),
      c.env.DB.prepare(
        `UPDATE publications SET views_count = views_count + 1 WHERE id = ?`
      ).bind(pub.id).run(),
    ])
  } catch (_) {}

  return c.json({ success: true }, 201)
})

// Registra un evento de analítica (tiempo en página o clic en botón) — público, fire-and-forget
app.post('/view/:slug/event', async (c) => {
  const slug = c.req.param('slug')
  const pub = await c.env.DB.prepare(
    `SELECT id FROM publications WHERE public_slug = ? AND status = 'published'`
  ).bind(slug).first<{ id: string }>()
  if (!pub) return c.json({ success: false }, 404)

  let body: any = {}
  try { body = await c.req.json() } catch (_) {}

  const validTypes = ['click', 'page_time', 'page_view']
  const type = validTypes.includes(body.type) ? body.type : 'page_time'
  const pageNumber = Number.isFinite(Number(body.page_number)) ? Number(body.page_number) : null
  const label = typeof body.label === 'string' ? body.label.slice(0, 120) : null
  const actionType = typeof body.action_type === 'string' ? body.action_type.slice(0, 40) : null
  const durationMs = Number.isFinite(Number(body.duration_ms)) ? Math.max(0, Math.round(Number(body.duration_ms))) : null
  const device = detectDevice(c.req.header('user-agent'))
  const cf = (c.req.raw as any).cf ?? {}
  const country = cf.country ?? null
  const city = cf.city ?? null
  const referrer = c.req.header('referer') ?? c.req.header('referrer') ?? null
  const urlDestination = typeof body.url_destination === 'string' ? body.url_destination.slice(0, 500) : null

  try {
    await c.env.DB.prepare(
      `INSERT INTO page_events (publication_id, type, page_number, label, action_type, duration_ms, device, country, city, referrer, url_destination)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(pub.id, type, pageNumber, label, actionType, durationMs, device, country, city, referrer, urlDestination).run()
  } catch (e) {
    console.error('[page_events] INSERT error:', e)
    return c.json({ success: false, error: 'DB error' }, 500)
  }

  return c.json({ success: true }, 201)
})

// Recibe respuestas de formularios / cuestionarios desde el viewer — público (sin auth)
app.post('/view/:slug/response', async (c) => {
  const slug = c.req.param('slug')
  const pub = await c.env.DB.prepare(
    `SELECT id, user_id FROM publications WHERE public_slug = ? AND status = 'published'`,
  )
    .bind(slug)
    .first<{ id: string; user_id: string }>()
  if (!pub) return c.json({ success: false, error: 'Publication not found' }, 404)

  const body = await c.req.json<{ kind?: string; widget_key?: string; payload?: any }>().catch(() => ({}))
  const kind = body.kind === 'quiz' ? 'quiz' : 'contact'
  const payload = typeof body.payload === 'string' ? body.payload : JSON.stringify(body.payload ?? {})

  try {
    await c.env.DB.prepare(
      `INSERT INTO form_responses (publication_id, owner_id, kind, widget_key, payload)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(pub.id, pub.user_id, kind, body.widget_key ?? null, payload)
      .run()
  } catch (e) {
    // Si la tabla aún no existe, no romper el viewer
    return c.json({ success: false, error: 'No se pudo guardar la respuesta' }, 500)
  }

  return c.json({ success: true }, 201)
})

// Cron: degradar planes expirados a free (corre 1x/día vía [triggers].crons en wrangler.toml)
async function degradeExpiredTenants(db: D1Database) {
  // 1) Avisar a quienes vencen pronto (dentro de los próximos 5 días), una sola vez por ciclo.
  //    Evitamos duplicar el aviso buscando una notificación de tipo 'plan_expiry' creada hoy.
  const { results: expiringSoon } = await db.prepare(
    `SELECT id, plan_id, plan_expires_at
     FROM users
     WHERE plan_id != 'free'
       AND plan_expires_at IS NOT NULL
       AND plan_expires_at > datetime('now')
       AND plan_expires_at <= datetime('now', '+5 days')`
  ).all<{ id: string; plan_id: string; plan_expires_at: string }>()

  for (const u of expiringSoon) {
    const already = await db.prepare(
      `SELECT 1 FROM notifications
       WHERE user_id = ? AND title LIKE 'Tu plan vence%'
         AND date(created_at) = date('now') LIMIT 1`
    ).bind(u.id).first()
    if (already) continue
    await db.prepare(
      `INSERT INTO notifications (user_id, title, message, read) VALUES (?, ?, ?, 0)`
    ).bind(
      u.id,
      `Tu plan ${String(u.plan_id).toUpperCase()} vence pronto`,
      `Tu plan vence el ${u.plan_expires_at.slice(0, 10)}. Renová tu pago para no perder el acceso a las funciones de tu plan.`
    ).run()
  }

  // 2) Degradar a free los planes ya vencidos.
  await db.prepare(
    `UPDATE users
     SET plan_id = 'free', plan_expires_at = NULL
     WHERE plan_id != 'free'
       AND plan_expires_at IS NOT NULL
       AND plan_expires_at < datetime('now')`
  ).run()
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    await degradeExpiredTenants(env.DB)
  },
}
