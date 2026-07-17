import { Hono } from 'hono'
import { jwtMiddleware } from '../middleware/jwt'
import type { Env } from '../index'
import type { AuthVariables } from '../middleware/jwt'

const leadIntakeCustomerMessageRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

const CUSTOMER_MESSAGE_EVENTS = [
  'quote_sent',
  'booking_confirmed',
  'booking_rejected',
  'booking_cancelled',
  'booking_rescheduled',
] as const
const CUSTOMER_MESSAGE_STATUSES = ['pending', 'opened', 'sent'] as const

function cleanLeadText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function customerMessageDateLabel(value: unknown) {
  const raw = cleanLeadText(value, 20)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return ''
  const [year, month, day] = raw.split('-')
  return `${day}/${month}/${year}`
}

function customerMessageTimeLabel(value: unknown) {
  const raw = cleanLeadText(value, 10)
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) return ''
  const [hourText, minute] = raw.split(':')
  const hour = Number(hourText)
  return `${hour % 12 || 12}:${minute} ${hour < 12 ? 'a. m.' : 'p. m.'}`
}

function buildCustomerMessage(
  row: Record<string, unknown>,
  eventType: typeof CUSTOMER_MESSAGE_EVENTS[number],
) {
  const name = cleanLeadText(row.customer_name, 160) || 'hola'
  const marker = cleanLeadText(row.marker_name, 160) || 'tu solicitud'
  const date = customerMessageDateLabel(row.booking_local_date)
  const time = customerMessageTimeLabel(row.booking_local_time)
  const appointment = [date, time].filter(Boolean).join(' a las ')
  const location = cleanLeadText(row.booking_location, 240)
  const locationLine = location ? ` Detalle de la cita: ${location}.` : ''

  if (eventType === 'quote_sent') {
    return `Hola ${name}, te compartimos la cotización solicitada para ${marker}. Quedamos atentos a cualquier consulta o ajuste que necesites.`
  }

  if (eventType === 'booking_confirmed') {
    return `Hola ${name}, tu cita para ${marker}${appointment ? ` el ${appointment}` : ''} ha sido confirmada.${locationLine}`
  }

  if (eventType === 'booking_rejected') {
    return `Hola ${name}, en esta ocasión no podemos confirmar la cita solicitada para ${marker}${appointment ? ` el ${appointment}` : ''}. Podemos ayudarte a buscar otra disponibilidad.`
  }

  if (eventType === 'booking_cancelled') {
    return `Hola ${name}, tu cita para ${marker}${appointment ? ` el ${appointment}` : ''} fue cancelada. Escríbenos para ayudarte a coordinar una nueva fecha.`
  }

  return `Hola ${name}, tu cita para ${marker} fue reprogramada${appointment ? ` para el ${appointment}` : ''}.${locationLine}`
}

async function loadCustomerMessageContext(
  db: D1Database,
  tenantId: string,
  leadId: string,
) {
  return db.prepare(
    `SELECT li.*, dm.name AS marker_name,
            b.status AS booking_status,
            b.local_date AS booking_local_date,
            b.local_time AS booking_local_time,
            b.location_snapshot AS booking_location
     FROM lead_intakes li
     LEFT JOIN dynamic_markers dm ON dm.id = li.marker_id
     LEFT JOIN appointment_calendar_bookings b
       ON b.id = li.booking_id AND b.user_id = li.tenant_id
     WHERE li.id = ? AND li.tenant_id = ?`,
  ).bind(leadId, tenantId).first<Record<string, unknown>>()
}

function customerMessageEventAllowed(
  row: Record<string, unknown>,
  eventType: typeof CUSTOMER_MESSAGE_EVENTS[number],
) {
  const requestType = String(row.request_type || '')
  const commercialStatus = String(row.status || '')
  const bookingStatus = String(row.booking_status || '')

  if (eventType === 'quote_sent') {
    return requestType === 'quote' && commercialStatus === 'won'
  }

  if (eventType === 'booking_confirmed') return requestType === 'booking' && bookingStatus === 'confirmed'
  if (eventType === 'booking_rejected') return requestType === 'booking' && bookingStatus === 'rejected'
  if (eventType === 'booking_cancelled') return requestType === 'booking' && bookingStatus === 'cancelled'
  return requestType === 'booking' && ['pending', 'confirmed'].includes(bookingStatus)
}

leadIntakeCustomerMessageRoutes.get('/api/lead-intakes/:id/customer-messages', jwtMiddleware, async (c) => {
  const userId = c.get('user').sub
  const leadId = c.req.param('id')

  const exists = await c.env.DB.prepare(
    'SELECT id FROM lead_intakes WHERE id = ? AND tenant_id = ?',
  ).bind(leadId, userId).first<{ id: string }>()

  if (!exists) return c.json({ success: false, error: 'Solicitud no encontrada' }, 404)

  const { results } = await c.env.DB.prepare(
    `SELECT *
     FROM lead_intake_customer_messages
     WHERE lead_intake_id = ? AND tenant_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 30`,
  ).bind(leadId, userId).all<Record<string, unknown>>()

  return c.json({ success: true, data: results ?? [] })
})

leadIntakeCustomerMessageRoutes.post('/api/lead-intakes/:id/customer-messages', jwtMiddleware, async (c) => {
  const userId = c.get('user').sub
  const leadId = c.req.param('id')
  const body = await c.req.json<{ event_type?: unknown }>()
    .catch((): { event_type?: unknown } => ({}))
  const eventType = typeof body.event_type === 'string'
    && (CUSTOMER_MESSAGE_EVENTS as readonly string[]).includes(body.event_type)
    ? body.event_type as typeof CUSTOMER_MESSAGE_EVENTS[number]
    : null

  if (!eventType) {
    return c.json({ success: false, error: 'Tipo de respuesta al cliente inválido' }, 400)
  }

  const context = await loadCustomerMessageContext(c.env.DB, userId, leadId)
  if (!context) return c.json({ success: false, error: 'Solicitud no encontrada' }, 404)

  if (!customerMessageEventAllowed(context, eventType)) {
    return c.json({
      success: false,
      error: 'La respuesta seleccionada no coincide con el estado actual de la solicitud.',
    }, 409)
  }

  const id = crypto.randomUUID()
  const message = buildCustomerMessage(context, eventType)

  await c.env.DB.prepare(
    `INSERT INTO lead_intake_customer_messages
     (id, tenant_id, lead_intake_id, event_type, channel, message_text, status)
     VALUES (?, ?, ?, ?, 'whatsapp', ?, 'pending')`,
  ).bind(id, userId, leadId, eventType, message).run()

  const row = await c.env.DB.prepare(
    'SELECT * FROM lead_intake_customer_messages WHERE id = ? AND tenant_id = ?',
  ).bind(id, userId).first()

  return c.json({ success: true, data: row }, 201)
})

leadIntakeCustomerMessageRoutes.patch('/api/lead-intakes/:id/customer-messages/:messageId', jwtMiddleware, async (c) => {
  const userId = c.get('user').sub
  const leadId = c.req.param('id')
  const messageId = c.req.param('messageId')
  const body = await c.req.json<{
    message_text?: unknown
    note_text?: unknown
    status?: unknown
  }>().catch((): {
    message_text?: unknown
    note_text?: unknown
    status?: unknown
  } => ({}))

  const messageText = body.message_text === undefined
    ? undefined
    : cleanLeadText(body.message_text, 2400)
  const noteText = body.note_text === undefined
    ? undefined
    : cleanLeadText(body.note_text, 1000)
  const status = body.status === undefined
    ? undefined
    : typeof body.status === 'string'
      && (CUSTOMER_MESSAGE_STATUSES as readonly string[]).includes(body.status)
        ? body.status
        : null

  if (status === null) {
    return c.json({ success: false, error: 'Estado de respuesta al cliente inválido' }, 400)
  }

  if (messageText !== undefined && !messageText) {
    return c.json({ success: false, error: 'El mensaje para el cliente no puede estar vacío' }, 400)
  }

  if (messageText === undefined && noteText === undefined && status === undefined) {
    return c.json({ success: false, error: 'No hay cambios válidos' }, 400)
  }

  const current = await c.env.DB.prepare(
    `SELECT id
     FROM lead_intake_customer_messages
     WHERE id = ? AND lead_intake_id = ? AND tenant_id = ?`,
  ).bind(messageId, leadId, userId).first<{ id: string }>()

  if (!current) return c.json({ success: false, error: 'Respuesta al cliente no encontrada' }, 404)

  await c.env.DB.prepare(
    `UPDATE lead_intake_customer_messages
     SET message_text = COALESCE(?, message_text),
         note_text = CASE WHEN ? THEN ? ELSE note_text END,
         status = COALESCE(?, status),
         opened_at = CASE
           WHEN ? = 'opened' THEN COALESCE(opened_at, datetime('now'))
           ELSE opened_at
         END,
         sent_at = CASE
           WHEN ? = 'sent' THEN COALESCE(sent_at, datetime('now'))
           ELSE sent_at
         END,
         updated_at = datetime('now')
     WHERE id = ? AND lead_intake_id = ? AND tenant_id = ?`,
  ).bind(
    messageText ?? null,
    noteText !== undefined ? 1 : 0,
    noteText ?? null,
    status ?? null,
    status ?? '',
    status ?? '',
    messageId,
    leadId,
    userId,
  ).run()

  const row = await c.env.DB.prepare(
    `SELECT *
     FROM lead_intake_customer_messages
     WHERE id = ? AND lead_intake_id = ? AND tenant_id = ?`,
  ).bind(messageId, leadId, userId).first()

  return c.json({ success: true, data: row })
})

export default leadIntakeCustomerMessageRoutes
