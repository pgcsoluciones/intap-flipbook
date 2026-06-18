import { Hono } from 'hono'
import { signJwt } from '../lib/jwt'
import { jwtMiddleware } from '../middleware/jwt'
import type { Env } from '../index'
import type { AuthVariables } from '../middleware/jwt'

const auth = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

auth.post('/register', async (c) => {
  const body = await c.req.json<{ email: string; password: string; name?: string; slug?: string; referral_code?: string }>()

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

  // Slug del tenant: el que el usuario eligió, o derivado del nombre/email.
  const base = slugify(body.slug || body.name || body.email.split('@')[0])
  const slug = await uniqueSlug(c.env.DB, 'users', base)

  await c.env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, name, slug) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, body.email.toLowerCase(), passwordHash, body.name ?? null, slug)
    .run()

  // Si viene con código de referido, vincular al referrer
  if (body.referral_code) {
    const referrer = await c.env.DB.prepare(
      'SELECT id FROM users WHERE referral_code = ?'
    ).bind(body.referral_code).first<{ id: string }>()
    if (referrer && referrer.id !== id) {
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO referrals (referrer_id, referred_id, status) VALUES (?, ?, 'pending')`
      ).bind(referrer.id, id).run()
    }
  }

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
    'SELECT id, email, name, slug, plan_id, is_admin, created_at FROM users WHERE id = ?',
  )
    .bind(sub)
    .first<{ id: string; email: string; name: string | null; slug: string | null; plan_id: string; is_admin: number; created_at: string }>()

  if (!user) return c.json({ success: false, error: 'User not found' }, 404)

  return c.json({ success: true, data: user })
})

// PUT /auth/me — actualizar nombre y/o slug del tenant
auth.put('/me', jwtMiddleware, async (c) => {
  const { sub } = c.get('user')
  const body = await c.req.json<{ name?: string; slug?: string }>()

  // Si pide cambiar el slug, lo normalizamos y verificamos que sea único.
  let newSlug: string | undefined
  if (body.slug !== undefined) {
    const base = slugify(body.slug)
    if (!base) return c.json({ success: false, error: 'El slug no puede quedar vacío' }, 400)
    const taken = await c.env.DB.prepare('SELECT id FROM users WHERE slug = ? AND id != ?')
      .bind(base, sub)
      .first()
    if (taken) return c.json({ success: false, error: 'Ese slug ya está en uso, elige otro' }, 409)
    newSlug = base
  }

  await c.env.DB.prepare('UPDATE users SET name = COALESCE(?, name), slug = COALESCE(?, slug) WHERE id = ?')
    .bind(body.name ?? null, newSlug ?? null, sub)
    .run()
  const user = await c.env.DB.prepare('SELECT id, email, name, slug, plan_id FROM users WHERE id = ?')
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

// GET /auth/referral-config — configuración pública del programa de referidos (sin auth)
auth.get('/referral-config', async (c) => {
  const config = await c.env.DB.prepare(
    `SELECT * FROM referral_config WHERE id = 1`,
  ).first()
  return c.json({ success: true, data: config })
})

// GET /auth/referrals/my — mis referidos (con auth)
auth.get('/referrals/my', jwtMiddleware, async (c) => {
  const { sub } = c.get('user')
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, u.email as referred_email, u.name as referred_name
     FROM referrals r
     JOIN users u ON u.id = r.referred_id
     WHERE r.referrer_id = ?
     ORDER BY r.created_at DESC`,
  )
    .bind(sub)
    .all()
  return c.json({ success: true, data: results })
})

// GET /auth/stats/my — mis estadísticas de publicaciones y vistas (con auth)
auth.get('/stats/my', jwtMiddleware, async (c) => {
  const { sub } = c.get('user')

  const { results: publications } = await c.env.DB.prepare(
    `SELECT p.id, p.title, p.status,
            p.views_count as views,
            COUNT(pg.id) as page_count
     FROM publications p
     LEFT JOIN pages pg ON pg.publication_id = p.id
     WHERE p.user_id = ?
     GROUP BY p.id
     ORDER BY p.views_count DESC`,
  )
    .bind(sub)
    .all()

  const pubs = publications as Array<{ id: string; title: string; status: string; views: number; page_count: number }>
  const totalViews = pubs.reduce((sum, pub) => sum + (pub.views ?? 0), 0)
  const publishedCount = pubs.filter((p) => p.status === 'published').length
  const totalPages = pubs.reduce((sum, pub) => sum + (pub.page_count ?? 0), 0)

  const { results: recentViews } = await c.env.DB.prepare(
    `SELECT pv.id, pv.viewed_at, pv.device, pub.title as flipbook_title
     FROM publication_views pv
     JOIN publications pub ON pub.id = pv.publication_id
     WHERE pub.user_id = ?
     ORDER BY pv.viewed_at DESC
     LIMIT 20`,
  )
    .bind(sub)
    .all()

  // Filtro opcional por publicación (?publication_id=...) para ver el detalle de una sola
  const pubFilter = c.req.query('publication_id')
  const ownedIds = pubs.map((p) => p.id)
  const scopedIds = pubFilter && ownedIds.includes(pubFilter) ? [pubFilter] : ownedIds

  let pageTimes: unknown[] = []
  let buttonClicks: unknown[] = []
  if (scopedIds.length > 0) {
    const placeholders = scopedIds.map(() => '?').join(',')

    // Tiempo promedio y vistas por número de página
    const pt = await c.env.DB.prepare(
      `SELECT page_number,
              COUNT(*) as visits,
              AVG(duration_ms) as avg_ms
       FROM page_events
       WHERE type = 'page_time' AND duration_ms IS NOT NULL
         AND publication_id IN (${placeholders})
       GROUP BY page_number
       ORDER BY page_number ASC`,
    ).bind(...scopedIds).all()
    pageTimes = pt.results

    // Ranking de botones más clickeados
    const bc = await c.env.DB.prepare(
      `SELECT label, action_type, page_number, COUNT(*) as clicks
       FROM page_events
       WHERE type = 'click'
         AND publication_id IN (${placeholders})
       GROUP BY label, action_type, page_number
       ORDER BY clicks DESC
       LIMIT 20`,
    ).bind(...scopedIds).all()
    buttonClicks = bc.results
  }

  return c.json({ success: true, data: {
    publications: pubs,
    total_views: totalViews,
    published_count: publishedCount,
    total_pages: totalPages,
    recent_views: recentViews,
    page_times: pageTimes,
    button_clicks: buttonClicks,
  } })
})

// Convierte un texto en slug URL-safe: minúsculas, sin acentos, guiones.
export function slugify(text: string): string {
  return (text || '')
    .toString()
    .replace(/ñ/gi, 'n')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita los acentos (marcas diacríticas)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')     // todo lo no alfanumérico → guion
    .replace(/^-+|-+$/g, '')          // recorta guiones de los extremos
    .slice(0, 60)
}

// Devuelve un slug único en la columna dada, agregando sufijos -2, -3… si ya existe.
export async function uniqueSlug(
  db: D1Database,
  table: 'users' | 'publications',
  base: string,
): Promise<string> {
  const col = table === 'publications' ? 'public_slug' : 'slug'
  const safe = base || (table === 'users' ? 'tenant' : 'flipbook')
  let slug = safe
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await db
      .prepare(`SELECT 1 FROM ${table} WHERE ${col} = ?`)
      .bind(slug)
      .first()
    if (!existing) return slug
    const m = slug.match(/-(\d+)$/)
    slug = m ? slug.replace(/-\d+$/, `-${Number(m[1]) + 1}`) : `${safe}-2`
  }
}

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
