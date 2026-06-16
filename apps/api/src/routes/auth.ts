import { Hono } from 'hono'
import { signJwt } from '../lib/jwt'
import { jwtMiddleware } from '../middleware/jwt'
import type { Env } from '../index'
import type { AuthVariables } from '../middleware/jwt'

const auth = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

auth.post('/register', async (c) => {
  const body = await c.req.json<{ email: string; password: string; name?: string }>()

  if (!body.email || !body.password) {
    return c.json({ success: false, error: 'email and password are required' }, 400)
  }
  if (body.password.length < 8) {
    return c.json({ success: false, error: 'Password must be at least 8 characters' }, 400)
  }

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(body.email.toLowerCase())
    .first()
  if (existing) {
    return c.json({ success: false, error: 'Email already registered' }, 409)
  }

  const passwordHash = await hashPassword(body.password)
  const id = crypto.randomUUID()

  await c.env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)',
  )
    .bind(id, body.email.toLowerCase(), passwordHash, body.name ?? null)
    .run()

  const token = await signJwt(
    { sub: id, email: body.email.toLowerCase() },
    c.env.JWT_SECRET,
    Number(c.env.JWT_EXPIRY_DAYS),
  )

  return c.json({ success: true, data: { token } }, 201)
})

auth.post('/login', async (c) => {
  const body = await c.req.json<{ email: string; password: string }>()

  if (!body.email || !body.password) {
    return c.json({ success: false, error: 'email and password are required' }, 400)
  }

  const user = await c.env.DB.prepare(
    'SELECT id, email, password_hash FROM users WHERE email = ?',
  )
    .bind(body.email.toLowerCase())
    .first<{ id: string; email: string; password_hash: string }>()

  if (!user || !(await verifyPassword(body.password, user.password_hash))) {
    return c.json({ success: false, error: 'Invalid email or password' }, 401)
  }

  const token = await signJwt(
    { sub: user.id, email: user.email },
    c.env.JWT_SECRET,
    Number(c.env.JWT_EXPIRY_DAYS),
  )

  return c.json({ success: true, data: { token } })
})

auth.get('/me', jwtMiddleware, async (c) => {
  const { sub } = c.get('user')

  const user = await c.env.DB.prepare(
    'SELECT id, email, name, plan_id, is_admin, created_at FROM users WHERE id = ?',
  )
    .bind(sub)
    .first<{ id: string; email: string; name: string | null; plan_id: string; is_admin: number; created_at: string }>()

  if (!user) return c.json({ success: false, error: 'User not found' }, 404)

  return c.json({ success: true, data: user })
})

// PUT /auth/me — update profile name
auth.put('/me', jwtMiddleware, async (c) => {
  const { sub } = c.get('user')
  const body = await c.req.json<{ name?: string }>()
  await c.env.DB.prepare('UPDATE users SET name = COALESCE(?, name) WHERE id = ?')
    .bind(body.name ?? null, sub)
    .run()
  const user = await c.env.DB.prepare('SELECT id, email, name, plan_id FROM users WHERE id = ?')
    .bind(sub)
    .first()
  return c.json({ success: true, data: user })
})

// PUT /auth/password — change password
auth.put('/password', jwtMiddleware, async (c) => {
  const { sub } = c.get('user')
  const body = await c.req.json<{ current_password: string; new_password: string }>()
  if (!body.current_password || !body.new_password) {
    return c.json({ success: false, error: 'current_password y new_password son requeridos' }, 400)
  }
  if (body.new_password.length < 8) {
    return c.json({ success: false, error: 'La nueva contraseña debe tener al menos 8 caracteres' }, 400)
  }
  const user = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(sub)
    .first<{ password_hash: string }>()
  if (!user || !(await verifyPassword(body.current_password, user.password_hash))) {
    return c.json({ success: false, error: 'Contraseña actual incorrecta' }, 401)
  }
  const newHash = await hashPassword(body.new_password)
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(newHash, sub).run()
  return c.json({ success: true })
})

// PBKDF2 password hashing via Web Crypto API
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 },
    key,
    256,
  )
  const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, '0')).join('')
  const hashHex = Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${saltHex}:${hashHex}`
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':')
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)))
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 },
    key,
    256,
  )
  const candidate = Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, '0')).join('')
  return candidate === hashHex
}

export default auth
