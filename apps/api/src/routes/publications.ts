import { Hono } from 'hono'
import { jwtMiddleware } from '../middleware/jwt'
import { getUserPlan, checkPublicationLimit, checkSoundAllowed } from '../lib/plans'
import { slugify, uniqueSlug } from './auth'
import type { Env } from '../index'
import type { AuthVariables } from '../middleware/jwt'

type Variables = AuthVariables

const publications = new Hono<{ Bindings: Env; Variables: Variables }>()

publications.use('*', jwtMiddleware)

const SOCIAL_TEXT_LIMITS = {
  social_title: 120,
  social_description: 300,
  social_image_url: 2048,
  social_image_source_url: 2048,
  social_image_crop_json: 4096,
} as const

type SocialField = keyof typeof SOCIAL_TEXT_LIMITS

function hasOwn(body: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, field)
}

function normalizeOptionalText(
  body: Record<string, unknown>,
  field: SocialField,
): { ok: true; present: boolean; value: string | null } | { ok: false; error: string } {
  if (!hasOwn(body, field)) return { ok: true, present: false, value: null }

  const value = body[field]
  if (value === null) return { ok: true, present: true, value: null }
  if (typeof value !== 'string') {
    return { ok: false, error: `${field} debe ser texto, null u omitido` }
  }

  const trimmed = value.trim()
  if (!trimmed) return { ok: true, present: true, value: null }
  if (trimmed.length > SOCIAL_TEXT_LIMITS[field]) {
    return { ok: false, error: `${field} no puede exceder ${SOCIAL_TEXT_LIMITS[field]} caracteres` }
  }

  return { ok: true, present: true, value: trimmed }
}

function normalizeOptionalHttpsUrl(
  body: Record<string, unknown>,
  field: 'social_image_url' | 'social_image_source_url',
): { ok: true; present: boolean; value: string | null } | { ok: false; error: string } {
  const normalized = normalizeOptionalText(body, field)
  if (!normalized.ok || !normalized.present || normalized.value === null) return normalized

  try {
    const url = new URL(normalized.value)
    if (url.protocol !== 'https:') {
      return { ok: false, error: `${field} debe ser una URL absoluta https` }
    }
  } catch {
    return { ok: false, error: `${field} debe ser una URL absoluta https` }
  }

  return normalized
}

function normalizeOptionalCropJson(
  body: Record<string, unknown>,
): { ok: true; present: boolean; value: string | null } | { ok: false; error: string } {
  const normalized = normalizeOptionalText(body, 'social_image_crop_json')
  if (!normalized.ok || !normalized.present || normalized.value === null) return normalized

  let parsed: unknown
  try {
    parsed = JSON.parse(normalized.value)
  } catch {
    return { ok: false, error: 'social_image_crop_json debe ser JSON válido' }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'social_image_crop_json debe ser un objeto JSON' }
  }

  const crop = parsed as Record<string, unknown>
  if (
    typeof crop.zoom !== 'number' ||
    !Number.isFinite(crop.zoom) ||
    crop.zoom < 1 ||
    crop.zoom > 5
  ) {
    return { ok: false, error: 'social_image_crop_json.zoom debe ser un número entre 1 y 5' }
  }
  if (typeof crop.offsetX !== 'number' || !Number.isFinite(crop.offsetX)) {
    return { ok: false, error: 'social_image_crop_json.offsetX debe ser un número finito' }
  }
  if (typeof crop.offsetY !== 'number' || !Number.isFinite(crop.offsetY)) {
    return { ok: false, error: 'social_image_crop_json.offsetY debe ser un número finito' }
  }

  return { ok: true, present: true, value: JSON.stringify(crop) }
}

// GET /api/publications — solo las activas (deleted_at IS NULL)
publications.get('/', async (c) => {
  const userId = c.get('user').sub
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, COUNT(pg.id) as page_count
     FROM publications p
     LEFT JOIN pages pg ON pg.publication_id = p.id
     WHERE p.user_id = ? AND p.deleted_at IS NULL
     GROUP BY p.id
     ORDER BY p.updated_at DESC`,
  )
    .bind(userId)
    .all()
  return c.json({ success: true, data: results })
})

// GET /api/publications/trash — publicaciones en papelera del tenant
publications.get('/trash', async (c) => {
  const userId = c.get('user').sub
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, COUNT(pg.id) as page_count
     FROM publications p
     LEFT JOIN pages pg ON pg.publication_id = p.id
     WHERE p.user_id = ? AND p.deleted_at IS NOT NULL
     GROUP BY p.id
     ORDER BY p.deleted_at DESC`,
  )
    .bind(userId)
    .all()
  return c.json({ success: true, data: results })
})

// POST /api/publications
publications.post('/', async (c) => {
  const userId = c.get('user').sub
  const body = await c.req.json<{
    title: string
    description?: string
    category?: string
    sound_enabled?: boolean
  }>()

  if (!body.title?.trim()) {
    return c.json({ success: false, error: 'El título es requerido' }, 400)
  }

  const { plan, customLimits } = await getUserPlan(c.env.DB, userId)

  const pubLimitError = await checkPublicationLimit(c.env.DB, userId, plan, customLimits)
  if (pubLimitError) return c.json({ success: false, error: pubLimitError }, 403)

  // If user explicitly requests sound and plan doesn't support it, silently disable
  const wantsSound = body.sound_enabled !== false
  const soundAllowed = plan.sound_enabled === 1
  const soundValue = wantsSound && soundAllowed ? 1 : 0

  const id = crypto.randomUUID()
  // Slug legible derivado del título (único; agrega -2, -3… si colisiona).
  const slug = await uniqueSlug(c.env.DB, 'publications', slugify(body.title.trim()))

  await c.env.DB.prepare(
    `INSERT INTO publications (id, user_id, title, description, category, public_slug, sound_enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, userId, body.title.trim(), body.description ?? null, body.category ?? null, slug, soundValue)
    .run()

  const pub = await c.env.DB.prepare('SELECT * FROM publications WHERE id = ?').bind(id).first()
  return c.json({
    success: true,
    data: pub,
    ...(wantsSound && !soundAllowed ? { warning: checkSoundAllowed(plan) } : {}),
  }, 201)
})

// GET /api/publications/:id
publications.get('/:id', async (c) => {
  const userId = c.get('user').sub
  const pub = await c.env.DB.prepare('SELECT * FROM publications WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), userId)
    .first()
  if (!pub) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)

  const { results: pages } = await c.env.DB.prepare(
    'SELECT * FROM pages WHERE publication_id = ? ORDER BY page_number ASC',
  )
    .bind(c.req.param('id'))
    .all()

  return c.json({ success: true, data: { ...pub, pages } })
})

// PUT /api/publications/:id
publications.put('/:id', async (c) => {
  const userId = c.get('user').sub
  const body = await c.req.json<{
    title?: string
    description?: string
    category?: string
    sound_enabled?: boolean
    cover_image_url?: string
    project_phone?: string
    project_whatsapp?: string
    project_location?: string
    project_address?: string
    project_developer?: string
    project_website?: string
    social_title?: unknown
    social_description?: unknown
    social_image_url?: unknown
    social_image_source_url?: unknown
    social_image_crop_json?: unknown
  }>()
  const rawBody = body as Record<string, unknown>

  const pub = await c.env.DB.prepare('SELECT id FROM publications WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), userId)
    .first()
  if (!pub) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)

  let soundValue: number | null = null
  let soundWarning: string | undefined

  if (body.sound_enabled !== undefined) {
    if (body.sound_enabled) {
      const { plan } = await getUserPlan(c.env.DB, userId)
      const err = checkSoundAllowed(plan)
      if (err) {
        soundValue = 0
        soundWarning = err
      } else {
        soundValue = 1
      }
    } else {
      soundValue = 0
    }
  }

  const socialTitle = normalizeOptionalText(rawBody, 'social_title')
  if (!socialTitle.ok) return c.json({ success: false, error: socialTitle.error }, 400)
  const socialDescription = normalizeOptionalText(rawBody, 'social_description')
  if (!socialDescription.ok) return c.json({ success: false, error: socialDescription.error }, 400)
  const socialImageUrl = normalizeOptionalHttpsUrl(rawBody, 'social_image_url')
  if (!socialImageUrl.ok) return c.json({ success: false, error: socialImageUrl.error }, 400)
  const socialImageSourceUrl = normalizeOptionalHttpsUrl(rawBody, 'social_image_source_url')
  if (!socialImageSourceUrl.ok) return c.json({ success: false, error: socialImageSourceUrl.error }, 400)
  const socialImageCropJson = normalizeOptionalCropJson(rawBody)
  if (!socialImageCropJson.ok) return c.json({ success: false, error: socialImageCropJson.error }, 400)

  const socialChanged =
    socialTitle.present ||
    socialDescription.present ||
    socialImageUrl.present ||
    socialImageSourceUrl.present ||
    socialImageCropJson.present

  await c.env.DB.prepare(
    `UPDATE publications
     SET title = COALESCE(?, title),
         description = COALESCE(?, description),
         category = COALESCE(?, category),
         sound_enabled = COALESCE(?, sound_enabled),
         cover_image_url = COALESCE(?, cover_image_url),
         project_phone = COALESCE(?, project_phone),
         project_whatsapp = COALESCE(?, project_whatsapp),
         project_location = COALESCE(?, project_location),
         project_address = COALESCE(?, project_address),
         project_developer = COALESCE(?, project_developer),
         project_website = COALESCE(?, project_website),
         social_title = CASE WHEN ? THEN ? ELSE social_title END,
         social_description = CASE WHEN ? THEN ? ELSE social_description END,
         social_image_url = CASE WHEN ? THEN ? ELSE social_image_url END,
         social_image_source_url = CASE WHEN ? THEN ? ELSE social_image_source_url END,
         social_image_crop_json = CASE WHEN ? THEN ? ELSE social_image_crop_json END,
         social_updated_at = CASE WHEN ? THEN datetime('now') ELSE social_updated_at END,
         updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(
      body.title ?? null,
      body.description ?? null,
      body.category ?? null,
      soundValue,
      body.cover_image_url ?? null,
      body.project_phone ?? null,
      body.project_whatsapp ?? null,
      body.project_location ?? null,
      body.project_address ?? null,
      body.project_developer ?? null,
      body.project_website ?? null,
      socialTitle.present ? 1 : 0,
      socialTitle.value,
      socialDescription.present ? 1 : 0,
      socialDescription.value,
      socialImageUrl.present ? 1 : 0,
      socialImageUrl.value,
      socialImageSourceUrl.present ? 1 : 0,
      socialImageSourceUrl.value,
      socialImageCropJson.present ? 1 : 0,
      socialImageCropJson.value,
      socialChanged ? 1 : 0,
      c.req.param('id'),
    )
    .run()

  const updated = await c.env.DB.prepare('SELECT * FROM publications WHERE id = ?')
    .bind(c.req.param('id'))
    .first()
  return c.json({ success: true, data: updated, ...(soundWarning ? { warning: soundWarning } : {}) })
})

// PATCH /api/publications/:id/restore — recupera de la papelera
// (rutas específicas van ANTES de /:id para evitar que Hono las capture con el parámetro dinámico)
publications.patch('/:id/restore', async (c) => {
  const userId = c.get('user').sub
  const pub = await c.env.DB.prepare(
    'SELECT id FROM publications WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL',
  )
    .bind(c.req.param('id'), userId)
    .first()
  if (!pub) return c.json({ success: false, error: 'Publicación no encontrada en la papelera' }, 404)

  await c.env.DB.prepare(
    `UPDATE publications SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(c.req.param('id'))
    .run()

  return c.json({ success: true, data: { restored: true } })
})

// DELETE /api/publications/:id/permanent — borrado físico definitivo e irreversible
publications.delete('/:id/permanent', async (c) => {
  try {
    const userId = c.get('user').sub
    const pubId = c.req.param('id')

    const pub = await c.env.DB.prepare(
      'SELECT id FROM publications WHERE id = ? AND user_id = ?',
    )
      .bind(pubId, userId)
      .first()

    if (!pub) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)

    // Borrar tablas hijas (ignorar si la tabla aún no existe en esta instancia de D1)
    const safeDelete = async (sql: string) => {
      try { await c.env.DB.prepare(sql).bind(pubId).run() } catch { /* tabla opcional */ }
    }
    await safeDelete('DELETE FROM page_events WHERE publication_id = ?')
    await safeDelete('DELETE FROM publication_views WHERE publication_id = ?')
    await safeDelete('DELETE FROM form_responses WHERE publication_id = ?')
    await c.env.DB.prepare('DELETE FROM pages WHERE publication_id = ?').bind(pubId).run()
    await c.env.DB.prepare('DELETE FROM publications WHERE id = ?').bind(pubId).run()

    return c.json({ success: true, data: { deleted: true } })
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    return c.json({ success: false, error: 'Error interno al eliminar: ' + msg }, 500)
  }
})

// DELETE /api/publications/:id — soft delete: mueve a papelera (no borra datos)
publications.delete('/:id', async (c) => {
  const userId = c.get('user').sub
  const pub = await c.env.DB.prepare(
    'SELECT id FROM publications WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
  )
    .bind(c.req.param('id'), userId)
    .first()
  if (!pub) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)

  await c.env.DB.prepare(
    `UPDATE publications SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(c.req.param('id'))
    .run()

  return c.json({ success: true, data: { trashed: true } })
})

// POST /api/publications/:id/publish
publications.post('/:id/publish', async (c) => {
  const userId = c.get('user').sub
  const pub = await c.env.DB.prepare('SELECT id FROM publications WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), userId)
    .first()
  if (!pub) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)

  // Must have at least one page
  const { count } = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM pages WHERE publication_id = ?'
  ).bind(c.req.param('id')).first<{ count: number }>() ?? { count: 0 }
  if (count === 0) {
    return c.json({ success: false, error: 'La publicación debe tener al menos una página antes de publicarse' }, 400)
  }

  await c.env.DB.prepare(
    `UPDATE publications SET status = 'published', updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(c.req.param('id'))
    .run()

  const updated = await c.env.DB.prepare('SELECT * FROM publications WHERE id = ?')
    .bind(c.req.param('id'))
    .first()
  return c.json({ success: true, data: updated })
})

export default publications
