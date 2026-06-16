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
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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
    `SELECT id, title, description, cover_image_url, sound_enabled
     FROM publications WHERE public_slug = ? AND status = 'published'`,
  )
    .bind(slug)
    .first<{
      id: string
      title: string
      description: string | null
      cover_image_url: string | null
      sound_enabled: number
    }>()

  if (!pub) return c.json({ success: false, error: 'Publication not found' }, 404)

  const { results: pages } = await c.env.DB.prepare(
    `SELECT id, page_number, image_url, title, description, price
     FROM pages WHERE publication_id = ? ORDER BY page_number ASC`,
  )
    .bind(pub.id)
    .all()

  return c.json({
    success: true,
    data: {
      ...pub,
      sound_enabled: pub.sound_enabled === 1,
      pages,
    },
  })
})

export default app
