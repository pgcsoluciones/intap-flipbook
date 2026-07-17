import { Hono } from 'hono'
import { jwtMiddleware } from '../middleware/jwt'
import type { Env } from '../index'
import type { AuthVariables } from '../middleware/jwt'

const leadIntakeRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

const LEAD_STATUSES = ['new', 'contacted', 'quoted', 'won', 'lost'] as const

function cleanLeadText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

const leadIntakeSelect = `SELECT li.*, dm.name AS marker_name, dm.reference AS marker_reference, p.title AS publication_title,
        b.calendar_id AS booking_calendar_id, b.local_date AS booking_local_date,
        b.local_time AS booking_local_time, b.appointment_type AS booking_appointment_type,
        b.status AS booking_status,
        b.delivery_mode_snapshot AS booking_delivery_mode,
        b.location_snapshot AS booking_location,
        b.customer_instructions_snapshot AS booking_customer_instructions
 FROM lead_intakes li
 LEFT JOIN dynamic_markers dm ON dm.id = li.marker_id
 LEFT JOIN publications p ON p.id = li.publication_id
 LEFT JOIN appointment_calendar_bookings b
   ON b.id = li.booking_id AND b.user_id = li.tenant_id`

leadIntakeRoutes.get('/api/lead-intakes', jwtMiddleware, async (c) => {
  const userId = c.get('user').sub
  const publicationId = c.req.query('publication_id') || ''
  const status = c.req.query('status') || ''
  const requestType = c.req.query('request_type') || ''
  const q = (c.req.query('q') || '').trim()
  const requestedLimit = Number(c.req.query('limit') || '50')
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 100)
    : 50
  const cursor = c.req.query('cursor') || ''

  let cursorCreatedAt = ''
  let cursorId = ''

  if (cursor) {
    const separator = cursor.lastIndexOf('|')
    if (separator <= 0) {
      return c.json({ success: false, error: 'Cursor de solicitudes inválido' }, 400)
    }
    cursorCreatedAt = cursor.slice(0, separator)
    cursorId = cursor.slice(separator + 1)

    if (!cursorCreatedAt || !cursorId) {
      return c.json({ success: false, error: 'Cursor de solicitudes inválido' }, 400)
    }
  }

  const binds: unknown[] = [userId]
  const filters = ['li.tenant_id = ?']
  if (publicationId) {
    filters.push('li.publication_id = ?')
    binds.push(publicationId)
  }
  if ((LEAD_STATUSES as readonly string[]).includes(status)) {
    filters.push('li.status = ?')
    binds.push(status)
  }
  if (requestType === 'quote' || requestType === 'booking') {
    filters.push('li.request_type = ?')
    binds.push(requestType)
  }
  if (q) {
    filters.push(`(
      li.customer_name LIKE ?
      OR li.customer_phone LIKE ?
      OR dm.reference LIKE ?
      OR dm.name LIKE ?
      OR p.title LIKE ?
    )`)
    const like = `%${q}%`
    binds.push(like, like, like, like, like)
  }

  if (cursorCreatedAt) {
    filters.push('(li.created_at < ? OR (li.created_at = ? AND li.id < ?))')
    binds.push(cursorCreatedAt, cursorCreatedAt, cursorId)
  }

  const { results } = await c.env.DB.prepare(
    `${leadIntakeSelect}
     WHERE ${filters.join(' AND ')}
     ORDER BY li.created_at DESC, li.id DESC
     LIMIT ?`,
  ).bind(...binds, limit + 1).all()

  const rows = (results ?? []) as Array<{ id: string; created_at: string }>
  const hasMore = rows.length > limit
  const data = hasMore ? rows.slice(0, limit) : rows
  const last = data[data.length - 1]

  return c.json({
    success: true,
    data,
    page: {
      limit,
      has_more: hasMore,
      next_cursor: hasMore && last ? `${last.created_at}|${last.id}` : null,
    },
  })
})

leadIntakeRoutes.get('/api/lead-intakes/summary', jwtMiddleware, async (c) => {
  const userId = c.get('user').sub

  const { results } = await c.env.DB.prepare(
    `SELECT request_type, COUNT(*) AS count
     FROM lead_intakes
     WHERE tenant_id = ? AND read_at IS NULL
     GROUP BY request_type`,
  ).bind(userId).all<{ request_type: string; count: number }>()

  const counts = new Map(
    (results ?? []).map((row) => [row.request_type, Number(row.count) || 0]),
  )

  const quotes = counts.get('quote') ?? 0
  const bookings = counts.get('booking') ?? 0

  return c.json({
    success: true,
    data: {
      total: quotes + bookings,
      quotes,
      bookings,
    },
  })
})

leadIntakeRoutes.get('/api/lead-intakes/:id', jwtMiddleware, async (c) => {
  const userId = c.get('user').sub
  const row = await c.env.DB.prepare(
    `${leadIntakeSelect}
     WHERE li.id = ? AND li.tenant_id = ?`,
  ).bind(c.req.param('id'), userId).first()

  if (!row) return c.json({ success: false, error: 'Solicitud no encontrada' }, 404)
  return c.json({ success: true, data: row })
})

leadIntakeRoutes.patch('/api/lead-intakes/:id/read', jwtMiddleware, async (c) => {
  const userId = c.get('user').sub
  const id = c.req.param('id')

  const current = await c.env.DB.prepare(
    'SELECT id, read_at FROM lead_intakes WHERE id = ? AND tenant_id = ?',
  ).bind(id, userId).first<{ id: string; read_at: string | null }>()

  if (!current) {
    return c.json({ success: false, error: 'Solicitud no encontrada' }, 404)
  }

  await c.env.DB.prepare(
    `UPDATE lead_intakes
     SET read_at = COALESCE(read_at, datetime('now')),
         updated_at = datetime('now')
     WHERE id = ? AND tenant_id = ?`,
  ).bind(id, userId).run()

  const updated = await c.env.DB.prepare(
    'SELECT id, read_at FROM lead_intakes WHERE id = ? AND tenant_id = ?',
  ).bind(id, userId).first<{ id: string; read_at: string | null }>()

  return c.json({ success: true, data: updated })
})

leadIntakeRoutes.patch('/api/lead-intakes/:id', jwtMiddleware, async (c) => {
  const userId = c.get('user').sub
  const body = await c.req.json<{ status?: unknown; internal_note?: unknown }>()
    .catch(() => ({} as { status?: unknown; internal_note?: unknown }))
  const status = typeof body.status === 'string' && (LEAD_STATUSES as readonly string[]).includes(body.status)
    ? body.status
    : null
  const note = body.internal_note === undefined ? undefined : cleanLeadText(body.internal_note, 1000)

  if (!status && note === undefined) {
    return c.json({ success: false, error: 'No hay cambios válidos' }, 400)
  }

  const current = await c.env.DB.prepare('SELECT id FROM lead_intakes WHERE id = ? AND tenant_id = ?')
    .bind(c.req.param('id'), userId)
    .first<{ id: string }>()

  if (!current) return c.json({ success: false, error: 'Solicitud no encontrada' }, 404)

  await c.env.DB.prepare(
    `UPDATE lead_intakes
     SET status = COALESCE(?, status),
         internal_note = CASE WHEN ? THEN ? ELSE internal_note END,
         handled_at = CASE WHEN ? != 'new' THEN COALESCE(handled_at, datetime('now')) ELSE handled_at END,
         updated_at = datetime('now')
     WHERE id = ? AND tenant_id = ?`,
  ).bind(status, note !== undefined ? 1 : 0, note ?? null, status ?? '', c.req.param('id'), userId).run()

  const row = await c.env.DB.prepare(
    `${leadIntakeSelect}
     WHERE li.id = ? AND li.tenant_id = ?`,
  ).bind(c.req.param('id'), userId).first()

  return c.json({ success: true, data: row })
})

export default leadIntakeRoutes
