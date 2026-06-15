import { Hono } from 'hono'
import { cors } from 'hono/cors'
import authRoutes from './routes/auth'

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
  const corsMiddleware = cors({
    origin: c.env.CORS_ORIGIN,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  })
  return corsMiddleware(c, next)
})

app.get('/', (c) => c.json({ service: 'intap-flipbook-api', status: 'ok' }))

app.route('/auth', authRoutes)

export default app
