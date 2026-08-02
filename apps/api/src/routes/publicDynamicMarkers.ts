import { Hono } from 'hono'
import type { Env } from '../index'

const publicDynamicMarkers = new Hono<{ Bindings: Env }>()

type MarkerRow = {
  id: string
  page_id: string | null
  page_number: number | null
  target_object_id: string | null
  target_kind: string | null
  name: string | null
  reference: string | null
  category: string | null
  description: string | null
  price_minor: number | null
  previous_price_minor: number | null
  currency: string | null
  availability: string | null
  promotion_text: string | null
  accent_color: string | null
  badge_text: string | null
  promotion_ends_at: string | null
  post_promotion_price_minor: number | null
  colors_json: string | null
  materials_json: string | null
  sizes_json: string | null
  measurements_json: string | null
  media_json: string | null
  actions_json: string | null
  custom_fields_json: string | null
  booking_calendar_id: string | null
  updated_at: string
}

type CatalogRow = MarkerRow & {
  publication_id: string
  publication_title: string | null
  publication_cover_url: string | null
  first_page_image_url: string | null
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function cleanLimit(value: unknown) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return 24
  return Math.min(Math.max(parsed, 1), 50)
}

function cleanMoneyMinor(value: unknown, field: string): number | null {
  const raw = cleanText(value, 40)
  if (!raw) return null
  const amount = Number(raw)
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`${field} debe ser un numero positivo`)
  }
  return Math.round(amount * 100)
}

function cleanCursor(value: unknown) {
  const raw = cleanText(value, 240)
  if (!raw) return { updatedAt: '', id: '' }
  const separator = raw.lastIndexOf('|')
  const updatedAt = raw.slice(0, separator)
  const id = raw.slice(separator + 1)
  const valid = (
    separator > 0
    && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(updatedAt)
    && /^[A-Za-z0-9-]{1,120}$/.test(id)
  )
  if (!valid) throw new Error('Cursor invalido')
  return { updatedAt, id }
}

function parseJsonArray(value: string | null): any[] {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function publicItems(value: string | null): any[] {
  return parseJsonArray(value).filter((item) => item?.visibility !== 'internal')
}

function publicCustomFields(value: string | null) {
  return parseJsonArray(value)
    .filter((item) => item?.visibility !== 'internal')
    .map((item) => ({
      label: cleanText(item?.label, 160),
      value: item?.value ?? '',
      type: cleanText(item?.type, 40) || 'text',
    }))
    .filter((item) => item.label || item.value !== '')
}

function publicActions(value: string | null): Record<string, unknown> {
  const actions = parseJsonObject(value)
  const cleaned: Record<string, unknown> = {}

  const whatsapp = (actions.contact_whatsapp || actions.whatsapp) as Record<string, unknown> | undefined
  if (whatsapp && typeof whatsapp === 'object' && whatsapp.enabled === true && cleanText(whatsapp.phone, 80)) {
    cleaned.contact_whatsapp = {
      enabled: true,
      phone: cleanText(whatsapp.phone, 80),
      label: cleanText(whatsapp.label, 80) || 'Contactar vendedor',
      message_template: cleanText(whatsapp.message_template, 500),
    }
  }

  const externalLink = actions.external_link as Record<string, unknown> | undefined
  if (externalLink && typeof externalLink === 'object' && externalLink.enabled === true) {
    const label = cleanText(externalLink.label, 80)
    const url = cleanText(externalLink.url, 2000)
    if (label && /^https?:\/\//i.test(url)) {
      cleaned.external_link = { enabled: true, label, url }
    }
  }

  const share = actions.share as Record<string, unknown> | undefined
  if (share && typeof share === 'object') {
    const enabled = share.enabled === true || share.whatsapp === true || share.facebook === true || share.copy_link === true || share.native === true
    if (enabled) {
      cleaned.share = {
        enabled: true,
        label: cleanText(share.label, 80) || 'Compartir',
        whatsapp: share.whatsapp === true,
        facebook: share.facebook === true,
        x: share.x === true,
        copy_link: share.copy_link === true,
        native: share.native === true,
      }
    }
  }

  const booking = actions.booking as Record<string, unknown> | undefined
  if (booking && typeof booking === 'object' && booking.enabled === true) {
    cleaned.booking = {
      enabled: true,
      label: cleanText(booking.label, 80) || 'Agendar',
      appointment_types: Array.isArray(booking.appointment_types)
        ? booking.appointment_types.map((item) => cleanText(item, 60)).filter(Boolean).slice(0, 12)
        : [],
      require_date: booking.require_date !== false,
      require_time: booking.require_time !== false,
    }
  }

  const offerCta = actions.offer_cta as Record<string, unknown> | undefined
  if (offerCta && typeof offerCta === 'object') {
    const target = cleanText(offerCta.target, 40)
    cleaned.offer_cta = {
      target: ['contact_whatsapp', 'external_link', 'share'].includes(target) ? target : '',
      preset: cleanText(offerCta.preset, 80),
      custom_label: cleanText(offerCta.custom_label, 80),
    }
  }

  return cleaned
}

function markerPayload(marker: MarkerRow) {
  const actions = publicActions(marker.actions_json)
  if (!marker.booking_calendar_id) delete actions.booking

  return {
    id: marker.id,
    page_id: marker.page_id,
    page_number: marker.page_number,
    target_object_id: marker.target_object_id,
    target_kind: marker.target_kind,
    name: marker.name,
    reference: marker.reference,
    category: marker.category,
    description: marker.description,
    price_minor: marker.price_minor,
    previous_price_minor: marker.previous_price_minor,
    currency: marker.currency,
    availability: marker.availability,
    promotion_text: marker.promotion_text,
    accent_color: marker.accent_color || '#F59E0B',
    badge_text: marker.badge_text,
    promotion_ends_at: marker.promotion_ends_at,
    post_promotion_price_minor: marker.post_promotion_price_minor,
    colors: publicItems(marker.colors_json),
    materials: publicItems(marker.materials_json),
    sizes: publicItems(marker.sizes_json),
    measurements: publicItems(marker.measurements_json),
    media: publicItems(marker.media_json),
    actions,
    has_booking: Boolean(marker.booking_calendar_id && actions.booking),
    custom_fields: publicCustomFields(marker.custom_fields_json),
    updated_at: marker.updated_at,
  }
}

async function publicationBySlug(db: D1Database, slug: string) {
  return db.prepare(
    `SELECT id, title, cover_image_url
     FROM publications
     WHERE public_slug = ?
       AND status = 'published'
       AND deleted_at IS NULL`,
  ).bind(slug).first<{ id: string; title: string | null; cover_image_url: string | null }>()
}

export async function publicMarkersForPublication(db: D1Database, publicationId: string) {
  const { results } = await db.prepare(
    `SELECT dm.*, pg.page_number
     FROM dynamic_markers dm
     LEFT JOIN pages pg
       ON pg.id = dm.page_id
      AND pg.publication_id = dm.publication_id
     WHERE dm.publication_id = ?
       AND dm.status = 'active'
     ORDER BY pg.page_number ASC, dm.updated_at DESC`,
  ).bind(publicationId).all<MarkerRow>()

  return (results ?? []).map(markerPayload)
}

publicDynamicMarkers.get('/catalog', async (c) => {
  const slug = c.req.param('slug') ?? ''
  const limit = cleanLimit(c.req.query('limit'))

  let minPrice: number | null = null
  let maxPrice: number | null = null
  let cursor: { updatedAt: string; id: string }
  try {
    minPrice = cleanMoneyMinor(c.req.query('price_min'), 'price_min')
    maxPrice = cleanMoneyMinor(c.req.query('price_max'), 'price_max')
    cursor = cleanCursor(c.req.query('cursor'))
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }

  const pub = await publicationBySlug(c.env.DB, slug)
  if (!pub) return c.json({ success: false, error: 'Publication not found' }, 404)

  const q = cleanText(c.req.query('q'), 120)
  const category = cleanText(c.req.query('category'), 120)
  const availability = cleanText(c.req.query('availability'), 80)
  const filters = ['dm.publication_id = ?', "dm.status = 'active'"]
  const binds: unknown[] = [pub.id]

  if (q) {
    const like = `%${q}%`
    filters.push(`(
      LOWER(COALESCE(dm.name, '')) LIKE LOWER(?)
      OR LOWER(COALESCE(dm.reference, '')) LIKE LOWER(?)
      OR LOWER(COALESCE(dm.category, '')) LIKE LOWER(?)
      OR LOWER(COALESCE(dm.description, '')) LIKE LOWER(?)
    )`)
    binds.push(like, like, like, like)
  }
  if (category) {
    filters.push('dm.category = ?')
    binds.push(category)
  }
  if (availability) {
    filters.push('dm.availability = ?')
    binds.push(availability)
  }
  if (minPrice != null) {
    filters.push('dm.price_minor >= ?')
    binds.push(minPrice)
  }
  if (maxPrice != null) {
    filters.push('dm.price_minor <= ?')
    binds.push(maxPrice)
  }
  if (cursor.updatedAt) {
    filters.push('(dm.updated_at < ? OR (dm.updated_at = ? AND dm.id < ?))')
    binds.push(cursor.updatedAt, cursor.updatedAt, cursor.id)
  }

  const [{ results: filterRows }, { results }] = await Promise.all([
    c.env.DB.prepare(
      `SELECT category, availability, price_minor, currency
       FROM dynamic_markers dm
       WHERE dm.publication_id = ?
         AND dm.status = 'active'`,
    ).bind(pub.id).all<{ category: string | null; availability: string | null; price_minor: number | null; currency: string | null }>(),
    c.env.DB.prepare(
      `SELECT dm.*, pg.page_number, p.title AS publication_title, p.cover_image_url AS publication_cover_url,
              (
                SELECT first_pg.image_url
                FROM pages first_pg
                WHERE first_pg.publication_id = dm.publication_id
                ORDER BY first_pg.page_number ASC
                LIMIT 1
              ) AS first_page_image_url
       FROM dynamic_markers dm
       JOIN publications p ON p.id = dm.publication_id
       LEFT JOIN pages pg
         ON pg.id = dm.page_id
        AND pg.publication_id = dm.publication_id
       WHERE ${filters.join(' AND ')}
       ORDER BY dm.updated_at DESC, dm.id DESC
       LIMIT ?`,
    ).bind(...binds, limit + 1).all<CatalogRow>(),
  ])

  const allRows = filterRows ?? []
  const prices = allRows.map((row) => row.price_minor).filter((value): value is number => typeof value === 'number')
  const rows = results ?? []
  const priceRangeCurrency = allRows.find((row) => row.currency)?.currency
    || rows.find((row) => row.currency)?.currency
    || 'DOP'
  const pageRows = rows.slice(0, limit)
  const last = pageRows[pageRows.length - 1]

  return c.json({
    success: true,
    data: pageRows.map((row) => ({
      id: row.id,
      name: row.name,
      reference: row.reference,
      category: row.category,
      price_minor: row.price_minor,
      currency: row.currency,
      availability: row.availability,
      badge_text: row.badge_text,
      accent_color: row.accent_color || '#F59E0B',
      cover_url: publicItems(row.media_json).find((item) => item.type === 'image')?.url || row.publication_cover_url || row.first_page_image_url || null,
      page_id: row.page_id,
      page_number: row.page_number,
      target_object_id: row.target_object_id,
      target_kind: row.target_kind,
      updated_at: row.updated_at,
    })),
    page: {
      limit,
      has_more: rows.length > limit,
      next_cursor: rows.length > limit && last ? `${last.updated_at}|${last.id}` : null,
    },
    meta: {
      filters: {
        categories: Array.from(new Set(allRows.map((row) => row.category).filter(Boolean))).sort(),
        availabilities: Array.from(new Set(allRows.map((row) => row.availability).filter(Boolean))).sort(),
        price_range: {
          min_minor: prices.length ? Math.min(...prices) : null,
          max_minor: prices.length ? Math.max(...prices) : null,
          currency: priceRangeCurrency,
        },
      },
    },
  })
})

publicDynamicMarkers.get('/:markerId', async (c) => {
  const slug = c.req.param('slug') ?? ''
  const markerId = c.req.param('markerId') ?? ''
  const pub = await publicationBySlug(c.env.DB, slug)
  if (!pub) return c.json({ success: false, error: 'Publication not found' }, 404)

  const marker = await c.env.DB.prepare(
    `SELECT dm.*, pg.page_number
     FROM dynamic_markers dm
     LEFT JOIN pages pg
       ON pg.id = dm.page_id
      AND pg.publication_id = dm.publication_id
     WHERE dm.id = ?
       AND dm.publication_id = ?
       AND dm.status = 'active'`,
  ).bind(markerId, pub.id).first<MarkerRow>()

  if (!marker) return c.json({ success: false, error: 'Ficha no disponible' }, 404)
  return c.json({ success: true, data: markerPayload(marker) })
})

export default publicDynamicMarkers
