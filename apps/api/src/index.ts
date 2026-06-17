import { Hono } from 'hono'
import { cors } from 'hono/cors'
import authRoutes from './routes/auth'
import publicationRoutes from './routes/publications'
import pageRoutes from './routes/pages'
import uploadRoutes from './routes/upload'
import adminRoutes from './routes/admin'
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

// Plan usage — protected
app.get('/api/me/usage', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const { plan } = await getUserPlan(c.env.DB, userId)
  const usage = await getPlanUsage(c.env.DB, userId, plan)
  return c.json({ success: true, data: usage })
})

// Public viewer endpoint — no auth required
app.get('/view/:slug', async (c) => {
  const slug = c.req.param('slug')
  const pub = await c.env.DB.prepare(
    `SELECT p.id, p.title, p.description, p.cover_image_url, p.sound_enabled,
            u.plan_id, u.watermark_override
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
      plan_id: string
      watermark_override: string
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

  // La marca de agua se muestra en planes free, a menos que el admin la oculte (force_hide).
  const planIsPaid = pub.plan_id !== 'free'
  const override = pub.watermark_override ?? 'plan'
  const watermarkEnabled =
    override === 'force_show' ? true :
    override === 'force_hide' ? false :
    !planIsPaid

  return c.json({
    success: true,
    data: {
      id: pub.id,
      title: pub.title,
      description: pub.description,
      cover_image_url: pub.cover_image_url,
      sound_enabled: pub.sound_enabled === 1,
      watermark_enabled: watermarkEnabled,
      watermark: wmConfig ?? { text: 'Intap Flipbook', link_url: 'https://intapflipbook.com', position: 'bottom-right', opacity: 80 },
      pages,
    },
  })
})

// Tenant: solicitar cambio de plan
app.post('/api/plan-requests', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const body = await c.req.json<{ requested_plan: string; notes?: string }>().catch(() => ({}))
  if (!body.requested_plan) return c.json({ success: false, error: 'requested_plan es requerido' }, 400)

  const plan = await c.env.DB.prepare('SELECT id FROM plans WHERE id = ? AND status = ?')
    .bind(body.requested_plan, 'active').first()
  if (!plan) return c.json({ success: false, error: 'Plan no encontrado' }, 404)

  // Cancelar solicitudes pendientes anteriores del mismo usuario
  await c.env.DB.prepare(
    `UPDATE plan_requests SET status = 'cancelled' WHERE user_id = ? AND status = 'pending'`
  ).bind(userId).run()

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO plan_requests (user_id, requested_plan, status, notes) VALUES (?, ?, 'pending', ?)`
  ).bind(userId, body.requested_plan, body.notes ?? null).run()

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

// Registra una vista de publicación — público (sin auth), fire-and-forget
app.post('/view/:slug/track', async (c) => {
  const slug = c.req.param('slug')
  const pub = await c.env.DB.prepare(
    `SELECT id FROM publications WHERE public_slug = ? AND status = 'published'`
  ).bind(slug).first<{ id: string }>()
  if (!pub) return c.json({ success: false }, 404)

  const device = c.req.header('user-agent')?.includes('Mobi') ? 'mobile' : 'desktop'
  try {
    await Promise.all([
      c.env.DB.prepare(
        `INSERT INTO publication_views (publication_id, device) VALUES (?, ?)`
      ).bind(pub.id, device).run(),
      c.env.DB.prepare(
        `UPDATE publications SET views_count = views_count + 1 WHERE id = ?`
      ).bind(pub.id).run(),
    ])
  } catch (_) {}

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
