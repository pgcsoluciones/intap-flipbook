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
const QUOTE_ATTACHMENT_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
}
const QUOTE_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024

function cleanLeadText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function cleanQuoteAttachmentName(value: unknown, extension: string) {
  const safe = String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\\/]/g, '-')
    .trim()
    .slice(0, 160)
  return safe || `cotizacion.${extension}`
}

function bytesToBase64Url(bytes: Uint8Array) {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function createDownloadToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}

async function tokenHash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((item) => item.toString(16).padStart(2, '0'))
    .join('')
}

function attachmentDownloadUrl(c: any, token: string) {
  const url = new URL(c.req.url)
  url.pathname = `/public/customer-files/${encodeURIComponent(token)}`
  url.search = ''
  url.hash = ''
  return url.toString()
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
    `SELECT m.*,
            a.id AS attachment_id,
            a.original_name AS attachment_original_name,
            a.mime_type AS attachment_mime_type,
            a.size_bytes AS attachment_size_bytes,
            a.download_expires_at AS attachment_download_expires_at,
            a.created_at AS attachment_created_at
     FROM lead_intake_customer_messages m
     LEFT JOIN lead_intake_customer_message_attachments a
       ON a.customer_message_id = m.id AND a.tenant_id = m.tenant_id
     WHERE m.lead_intake_id = ? AND m.tenant_id = ?
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT 30`,
  ).bind(leadId, userId).all<Record<string, unknown>>()

  const data = (results ?? []).map((row) => ({
    ...row,
    attachment: row.attachment_id
      ? {
          id: String(row.attachment_id),
          original_name: String(row.attachment_original_name || 'cotizacion'),
          mime_type: String(row.attachment_mime_type || 'application/octet-stream'),
          size_bytes: Number(row.attachment_size_bytes || 0),
          download_expires_at: typeof row.attachment_download_expires_at === 'string'
            ? row.attachment_download_expires_at
            : null,
          created_at: String(row.attachment_created_at || ''),
        }
      : null,
  }))

  return c.json({ success: true, data })
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

leadIntakeCustomerMessageRoutes.post('/api/lead-intakes/:id/customer-messages/:messageId/attachment', jwtMiddleware, async (c) => {
  const userId = c.get('user').sub
  const leadId = c.req.param('id')
  const messageId = c.req.param('messageId')

  const message = await c.env.DB.prepare(
    `SELECT id, event_type, status
     FROM lead_intake_customer_messages
     WHERE id = ? AND lead_intake_id = ? AND tenant_id = ?`,
  ).bind(messageId, leadId, userId).first<{ id: string; event_type: string; status: string }>()

  if (!message) return c.json({ success: false, error: 'Respuesta al cliente no encontrada' }, 404)
  if (message.event_type !== 'quote_sent') {
    return c.json({ success: false, error: 'Solo puedes adjuntar un documento a una cotización' }, 409)
  }
  if (message.status === 'sent') {
    return c.json({ success: false, error: 'No puedes modificar una cotización ya marcada como enviada' }, 409)
  }

  const formData = await c.req.formData().catch(() => null)
  const incomingFile = formData?.get('file')
  if (!incomingFile || typeof incomingFile === 'string') {
    return c.json({ success: false, error: 'Selecciona un archivo para adjuntar' }, 400)
  }
  const file = incomingFile as File

  const extension = QUOTE_ATTACHMENT_TYPES[file.type]
  if (!extension) {
    return c.json({ success: false, error: 'Formato no permitido. Adjunta PDF, JPG, PNG, Word o Excel.' }, 415)
  }
  if (!file.size || file.size > QUOTE_ATTACHMENT_MAX_BYTES) {
    return c.json({ success: false, error: 'El archivo debe pesar entre 1 byte y 25 MB.' }, 413)
  }

  const previous = await c.env.DB.prepare(
    `SELECT storage_key
     FROM lead_intake_customer_message_attachments
     WHERE tenant_id = ? AND lead_intake_id = ? AND customer_message_id = ?`,
  ).bind(userId, leadId, messageId).first<{ storage_key: string }>()

  const attachmentId = crypto.randomUUID()
  const originalName = cleanQuoteAttachmentName(file.name, extension)
  const storageKey = `private/quotes/${userId}/${leadId}/${messageId}/${crypto.randomUUID()}.${extension}`

  try {
    await c.env.PRIVATE_MEDIA.put(storageKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    })

    await c.env.DB.batch([
      c.env.DB.prepare(
        `DELETE FROM lead_intake_customer_message_attachments
         WHERE tenant_id = ? AND lead_intake_id = ? AND customer_message_id = ?`,
      ).bind(userId, leadId, messageId),
      c.env.DB.prepare(
        `INSERT INTO lead_intake_customer_message_attachments
         (id, tenant_id, lead_intake_id, customer_message_id, storage_key, original_name, mime_type, size_bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        attachmentId,
        userId,
        leadId,
        messageId,
        storageKey,
        originalName,
        file.type,
        file.size,
      ),
    ])

    if (previous?.storage_key) {
      await c.env.PRIVATE_MEDIA.delete(previous.storage_key).catch(() => undefined)
    }
  } catch {
    await c.env.PRIVATE_MEDIA.delete(storageKey).catch(() => undefined)
    return c.json({ success: false, error: 'No se pudo guardar el adjunto privado' }, 500)
  }

  return c.json({
    success: true,
    data: {
      id: attachmentId,
      original_name: originalName,
      mime_type: file.type,
      size_bytes: file.size,
      download_expires_at: null,
      created_at: new Date().toISOString(),
    },
  }, 201)
})

leadIntakeCustomerMessageRoutes.delete('/api/lead-intakes/:id/customer-messages/:messageId/attachment', jwtMiddleware, async (c) => {
  const userId = c.get('user').sub
  const leadId = c.req.param('id')
  const messageId = c.req.param('messageId')

  const current = await c.env.DB.prepare(
    `SELECT a.storage_key, m.status
     FROM lead_intake_customer_message_attachments a
     JOIN lead_intake_customer_messages m ON m.id = a.customer_message_id
     WHERE a.tenant_id = ? AND a.lead_intake_id = ? AND a.customer_message_id = ?
       AND m.tenant_id = ? AND m.lead_intake_id = ?`,
  ).bind(userId, leadId, messageId, userId, leadId).first<{ storage_key: string; status: string }>()

  if (!current) return c.json({ success: false, error: 'Adjunto no encontrado' }, 404)
  if (current.status === 'sent') {
    return c.json({ success: false, error: 'No puedes retirar una cotización ya marcada como enviada' }, 409)
  }

  await c.env.DB.prepare(
    `DELETE FROM lead_intake_customer_message_attachments
     WHERE tenant_id = ? AND lead_intake_id = ? AND customer_message_id = ?`,
  ).bind(userId, leadId, messageId).run()

  await c.env.PRIVATE_MEDIA.delete(current.storage_key).catch(() => undefined)
  return c.json({ success: true })
})

leadIntakeCustomerMessageRoutes.post('/api/lead-intakes/:id/customer-messages/:messageId/attachment-link', jwtMiddleware, async (c) => {
  const userId = c.get('user').sub
  const leadId = c.req.param('id')
  const messageId = c.req.param('messageId')

  const attachment = await c.env.DB.prepare(
    `SELECT id
     FROM lead_intake_customer_message_attachments
     WHERE tenant_id = ? AND lead_intake_id = ? AND customer_message_id = ?`,
  ).bind(userId, leadId, messageId).first<{ id: string }>()

  if (!attachment) {
    return c.json({ success: false, error: 'Esta respuesta no tiene una cotización formal adjunta' }, 404)
  }

  const token = createDownloadToken()
  const hash = await tokenHash(token)

  await c.env.DB.prepare(
    `UPDATE lead_intake_customer_message_attachments
     SET download_token_hash = ?,
         download_expires_at = datetime('now', '+30 days'),
         updated_at = datetime('now')
     WHERE id = ? AND tenant_id = ?`,
  ).bind(hash, attachment.id, userId).run()

  const fresh = await c.env.DB.prepare(
    `SELECT download_expires_at
     FROM lead_intake_customer_message_attachments
     WHERE id = ? AND tenant_id = ?`,
  ).bind(attachment.id, userId).first<{ download_expires_at: string | null }>()

  return c.json({
    success: true,
    data: {
      download_url: attachmentDownloadUrl(c, token),
      expires_at: fresh?.download_expires_at ?? null,
    },
  })
})

export default leadIntakeCustomerMessageRoutes
