import { Hono } from 'hono'
import { signJwt } from '../lib/jwt'
import {
  accessTokenExpiryDays,
  checkLoginThrottle,
  clearLoginFailures,
  passwordPolicyError,
  recordFailedLogin,
  revokeUserSessions,
} from '../lib/authSecurity'
import { jwtMiddleware } from '../middleware/jwt'
import type { Env } from '../index'
import type { AuthVariables } from '../middleware/jwt'

const auth = new Hono<{ Bindings: Env; Variables: AuthVariables }>()
// Cloudflare Workers Web Crypto rejects PBKDF2 iteration counts above 100,000.
// Keep the maximum supported cost and version the stored format for future migration.
const PASSWORD_HASH_ITERATIONS = 100_000

function normalizedEmail(value: string) {
  return value.trim().toLowerCase().slice(0, 320)
}

function safeTokenDays(value: string | undefined) {
  return accessTokenExpiryDays(value)
}

auth.post('/register', async (c) => {
  const body = await c.req.json<{ email: string; password: string; name?: string; slug?: string; referral_code?: string }>()

  if (!body.email || !body.password) {
    return c.json({ success: false, error: 'email and password are required' }, 400)
  }
  const passwordError = passwordPolicyError(body.password)
  if (passwordError) return c.json({ success: false, error: passwordError }, 400)

  const email = normalizedEmail(body.email)
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first()
  if (existing) {
    return c.json({ success: false, error: 'No pudimos completar el registro con esos datos' }, 409)
  }

  const passwordHash = await hashPassword(body.password)
  const id = crypto.randomUUID()

  const base = slugify(body.slug || body.name || email.split('@')[0])
  const slug = await uniqueSlug(c.env.DB, 'users', base)

  await c.env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, name, slug) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, email, passwordHash, body.name ?? null, slug)
    .run()

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
    { sub: id, email, kind: 'access' },
    c.env.JWT_SECRET,
    safeTokenDays(c.env.JWT_EXPIRY_DAYS),
  )

  return c.json({ success: true, data: { token } }, 201)
})

auth.post('/login', async (c) => {
  const body = await c.req.json<{ email: string; password: string }>()

  if (!body.email || !body.password || body.password.length > 200) {
    return c.json({ success: false, error: 'Email o contraseña incorrectos' }, 401)
  }

  const email = normalizedEmail(body.email)
  const throttle = await checkLoginThrottle(c.env.SESSIONS, c.req.raw.headers, email)
  if (!throttle.allowed) {
    c.header('Retry-After', String(throttle.retryAfterSeconds))
    return c.json({
      success: false,
      error: 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.',
      code: 'LOGIN_RATE_LIMITED',
      retry_after: throttle.retryAfterSeconds,
    }, 429)
  }

  const user = await c.env.DB.prepare(
    'SELECT id, email, password_hash FROM users WHERE email = ?',
  )
    .bind(email)
    .first<{ id: string; email: string; password_hash: string }>()

  const verification = user
    ? await verifyPassword(body.password, user.password_hash)
    : { valid: false, needsUpgrade: false }

  if (!user || !verification.valid) {
    const failure = await recordFailedLogin(c.env.SESSIONS, throttle.key)
    if (failure.retryAfterSeconds) c.header('Retry-After', String(failure.retryAfterSeconds))
    return c.json({ success: false, error: 'Email o contraseña incorrectos' }, 401)
  }

  await clearLoginFailures(c.env.SESSIONS, throttle.key)

  if (verification.needsUpgrade) {
    const upgradedHash = await hashPassword(body.password)
    await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(upgradedHash, user.id)
      .run()
  }

  const token = await signJwt(
    { sub: user.id, email: user.email, kind: 'access' },
    c.env.JWT_SECRET,
    safeTokenDays(c.env.JWT_EXPIRY_DAYS),
  )

  return c.json({ success: true, data: { token } })
})

auth.post('/logout-all', jwtMiddleware, async (c) => {
  const { sub } = c.get('user')
  await revokeUserSessions(c.env.SESSIONS, sub)
  return c.json({ success: true })
})

auth.get('/me', jwtMiddleware, async (c) => {
  const { sub } = c.get('user')

  const user = await c.env.DB.prepare(
    'SELECT id, email, name, slug, plan_id, is_admin, created_at, watermark_tenant, logo_url, contact_phone, contact_whatsapp, contact_email, contact_address FROM users WHERE id = ?',
  )
    .bind(sub)
    .first<{ id: string; email: string; name: string | null; slug: string | null; plan_id: string; is_admin: number; created_at: string; logo_url: string | null; contact_phone: string | null; contact_whatsapp: string | null; contact_email: string | null; contact_address: string | null }>()

  if (!user) return c.json({ success: false, error: 'User not found' }, 404)

  return c.json({ success: true, data: user })
})

auth.put('/me', jwtMiddleware, async (c) => {
  const { sub } = c.get('user')
  const body = await c.req.json<{ name?: string; slug?: string }>()

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

auth.put('/me/watermark', jwtMiddleware, async (c) => {
  const { sub } = c.get('user')
  const body = await c.req.json<{ watermark_tenant?: string | null }>()
  const user = await c.env.DB.prepare('SELECT plan_id FROM users WHERE id = ?').bind(sub).first<{ plan_id: string }>()
  if (!user) return c.json({ success: false, error: 'User not found' }, 404)
  if (user.plan_id === 'free') return c.json({ success: false, error: 'El plan Free no puede modificar la marca de agua' }, 403)
  const allowed = ['show', 'hide', null]
  const value = allowed.includes(body.watermark_tenant ?? null) ? (body.watermark_tenant ?? null) : null
  await c.env.DB.prepare('UPDATE users SET watermark_tenant = ? WHERE id = ?').bind(value, sub).run()
  return c.json({ success: true })
})

auth.put('/password', jwtMiddleware, async (c) => {
  const { sub } = c.get('user')
  const body = await c.req.json<{ current_password: string; new_password: string }>()
  if (!body.current_password || !body.new_password) {
    return c.json({ success: false, error: 'current_password y new_password son requeridos' }, 400)
  }
  const passwordError = passwordPolicyError(body.new_password)
  if (passwordError) return c.json({ success: false, error: passwordError }, 400)

  const user = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(sub)
    .first<{ password_hash: string }>()
  const verification = user
    ? await verifyPassword(body.current_password, user.password_hash)
    : { valid: false, needsUpgrade: false }
  if (!verification.valid) {
    return c.json({ success: false, error: 'Contraseña actual incorrecta' }, 401)
  }

  const newHash = await hashPassword(body.new_password)
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(newHash, sub).run()
  await revokeUserSessions(c.env.SESSIONS, sub)
  return c.json({ success: true, data: { session_revoked: true } })
})

auth.get('/referral-config', async (c) => {
  const config = await c.env.DB.prepare(
    `SELECT * FROM referral_config WHERE id = 1`,
  ).first()
  return c.json({ success: true, data: config })
})

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

auth.get('/stats/my', jwtMiddleware, async (c) => {
  const { sub } = c.get('user')

  const { results: publications } = await c.env.DB.prepare(
    `SELECT p.id, p.title, p.status,
            p.views_count as views,
            p.cover_image_url as cover_url,
            COUNT(pg.id) as page_count
     FROM publications p
     LEFT JOIN pages pg ON pg.publication_id = p.id
     WHERE p.user_id = ? AND p.deleted_at IS NULL
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
     LIMIT 200`,
  )
    .bind(sub)
    .all()

  const pubFilter = c.req.query('publication_id')
  const ownedIds = pubs.map((p) => p.id)
  const scopedIds = pubFilter && ownedIds.includes(pubFilter) ? [pubFilter] : ownedIds

  let pageTimes: unknown[] = []
  let buttonClicks: unknown[] = []
  if (scopedIds.length > 0) {
    const placeholders = scopedIds.map(() => '?').join(',')

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

export function slugify(text: string): string {
  return (text || '')
    .toString()
    .replace(/ñ/gi, 'n')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export async function uniqueSlug(
  db: D1Database,
  table: 'users' | 'publications',
  base: string,
): Promise<string> {
  const col = table === 'publications' ? 'public_slug' : 'slug'
  const safe = base || (table === 'users' ? 'tenant' : 'flipbook')
  let slug = safe
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

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(value: string) {
  if (!value || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) return null
  return new Uint8Array(value.match(/.{2}/g)!.map((part) => parseInt(part, 16)))
}

function constantTimeHexEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return diff === 0
}

async function derivePasswordHash(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  )
  return bytesToHex(new Uint8Array(bits))
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hashHex = await derivePasswordHash(password, salt, PASSWORD_HASH_ITERATIONS)
  return `v2$${PASSWORD_HASH_ITERATIONS}$${bytesToHex(salt)}$${hashHex}`
}

async function verifyPassword(password: string, stored: string): Promise<{ valid: boolean; needsUpgrade: boolean }> {
  try {
    if (stored.startsWith('v2$')) {
      const [, iterationsRaw, saltHex, hashHex] = stored.split('$')
      const iterations = Number(iterationsRaw)
      const salt = hexToBytes(saltHex)
      if (!salt || !Number.isInteger(iterations) || iterations < 100_000 || !hashHex) {
        return { valid: false, needsUpgrade: false }
      }
      const candidate = await derivePasswordHash(password, salt, iterations)
      return {
        valid: constantTimeHexEqual(candidate, hashHex),
        needsUpgrade: iterations < PASSWORD_HASH_ITERATIONS,
      }
    }

    const [saltHex, hashHex] = stored.split(':')
    const salt = hexToBytes(saltHex)
    if (!salt || !hashHex) return { valid: false, needsUpgrade: false }
    const candidate = await derivePasswordHash(password, salt, 100_000)
    const valid = constantTimeHexEqual(candidate, hashHex)
    return { valid, needsUpgrade: valid }
  } catch {
    return { valid: false, needsUpgrade: false }
  }
}

auth.get('/stats/pub/:id', jwtMiddleware, async (c) => {
  const { sub } = c.get('user')
  const pubId = c.req.param('id')

  const pub = await c.env.DB.prepare(
    `SELECT id, title, status, views_count, public_slug FROM publications WHERE id = ? AND user_id = ?`
  ).bind(pubId, sub).first<{ id: string; title: string; status: string; views_count: number; public_slug: string | null }>()

  if (!pub) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)

  const { results: recentViews } = await c.env.DB.prepare(
    `SELECT id, viewed_at, device FROM publication_views
     WHERE publication_id = ?
     ORDER BY viewed_at DESC LIMIT 200`
  ).bind(pubId).all()

  const { results: deviceBreakdown } = await c.env.DB.prepare(
    `SELECT device, COUNT(*) as count
     FROM publication_views
     WHERE publication_id = ?
     GROUP BY device`
  ).bind(pubId).all()

  const { results: pageTimes } = await c.env.DB.prepare(
    `SELECT page_number, COUNT(*) as time_events, AVG(duration_ms) as avg_ms
     FROM page_events
     WHERE type = 'page_time' AND duration_ms IS NOT NULL AND publication_id = ?
     GROUP BY page_number
     ORDER BY page_number ASC`
  ).bind(pubId).all()

  const { results: buttonClicks } = await c.env.DB.prepare(
    `SELECT label, action_type, page_number, COUNT(*) as clicks
     FROM page_events
     WHERE type = 'click' AND publication_id = ?
     GROUP BY label, action_type, page_number
     ORDER BY clicks DESC LIMIT 20`
  ).bind(pubId).all()

  const { results: viewsByDay } = await c.env.DB.prepare(
    `SELECT date(viewed_at) as day, COUNT(*) as views
     FROM publication_views
     WHERE publication_id = ?
       AND viewed_at >= datetime('now', '-30 days')
     GROUP BY day
     ORDER BY day ASC`
  ).bind(pubId).all()

  const { results: countryBreakdown } = await c.env.DB.prepare(
    `SELECT country, COUNT(*) as count
     FROM publication_views
     WHERE publication_id = ? AND country IS NOT NULL
     GROUP BY country
     ORDER BY count DESC
     LIMIT 10`
  ).bind(pubId).all()

  const { results: topLinks } = await c.env.DB.prepare(
    `SELECT action_type, label, url_destination, COUNT(*) as count
     FROM page_events
     WHERE publication_id = ? AND type = 'click'
     GROUP BY action_type, label, url_destination
     ORDER BY count DESC
     LIMIT 20`
  ).bind(pubId).all()

  const { results: pageVisits } = await c.env.DB.prepare(
    `SELECT page_number,
            COUNT(*) as visits,
            AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END) as avg_ms
     FROM page_events
     WHERE publication_id = ? AND type IN ('page_view', 'page_time')
     GROUP BY page_number
     ORDER BY page_number ASC`
  ).bind(pubId).all()

  return c.json({ success: true, data: {
    publication: pub,
    total_views: pub.views_count ?? 0,
    recent_views: recentViews,
    device_breakdown: deviceBreakdown,
    page_times: pageTimes,
    button_clicks: buttonClicks,
    views_by_day: viewsByDay,
    country_breakdown: countryBreakdown,
    top_links: topLinks,
    page_visits: pageVisits,
  }})
})

export default auth
