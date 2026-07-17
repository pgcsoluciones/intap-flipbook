import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  api,
  type LeadIntake,
  type LeadIntakeCustomerMessage,
  type LeadIntakeCustomerMessageEvent,
  type LeadIntakeCustomerMessageStatus,
  type LeadIntakeRequestType,
  type LeadIntakeStatus,
} from '../lib/api'
import { useIsMobile } from '../hooks/useIsMobile'

type PageMeta = {
  limit: number
  has_more: boolean
  next_cursor: string | null
}

type Confirmation = {
  title: string
  description: string
  confirmLabel: string
  tone: 'primary' | 'danger'
  action: () => Promise<void>
}

type RescheduleDraft = {
  date: string
  time: string
  slots: Array<{ time: string; label: string }>
  loading: boolean
  error: string
}

type CustomerResponseDraft = {
  message: LeadIntakeCustomerMessage
  text: string
  note: string
}

const EMPTY_PAGE: PageMeta = {
  limit: 50,
  has_more: false,
  next_cursor: null,
}

const STATUSES: Array<{ value: LeadIntakeStatus; label: string }> = [
  { value: 'new', label: 'Nueva' },
  { value: 'contacted', label: 'Contactada' },
  { value: 'quoted', label: 'Cotizada' },
  { value: 'won', label: 'Ganada' },
  { value: 'lost', label: 'Perdida' },
]

const BOOKING_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmada',
  cancelled: 'Cancelada',
  rejected: 'Rechazada',
  expired: 'Expirada',
}

const DELIVERY_LABELS: Record<string, string> = {
  in_person: 'Presencial',
  video_call: 'Videollamada',
  phone_call: 'Llamada telefónica',
  other: 'Otra modalidad',
}

function statusLabel(value: string, requestType?: LeadIntakeRequestType) {
  const labels = requestType === 'booking'
    ? {
        new: 'Nueva',
        contacted: 'Solicitud tomada',
        quoted: 'Disponibilidad revisada',
        won: 'Cita realizada',
        lost: 'Cerrada sin seguimiento',
      }
    : {
        new: 'Nueva',
        contacted: 'Solicitud tomada',
        quoted: 'Cotización preparada',
        won: 'Cotización enviada',
        lost: 'Cerrada sin seguimiento',
      }

  return labels[value as keyof typeof labels]
    ?? STATUSES.find((item) => item.value === value)?.label
    ?? value
}

function bookingStatusLabel(value?: string | null) {
  return value ? (BOOKING_STATUS_LABELS[value] ?? value) : 'Sin reserva'
}

function typeLabel(value: LeadIntakeRequestType) {
  return value === 'booking' ? 'Solicitud de cita' : 'Cotización'
}

function parseSnapshot(value: string) {
  try {
    const parsed = JSON.parse(value || '{}')
    return parsed && typeof parsed === 'object' ? parsed as Record<string, any> : {}
  } catch {
    return {}
  }
}

function formatDate(value: string) {
  const normalized = value && !value.endsWith('Z') ? `${value}Z` : value
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('es-DO')
}

function formatDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return value
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

function formatTime(value: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || '')) return value
  const [hours, minutes] = value.split(':').map(Number)
  const suffix = hours < 12 ? 'a. m.' : 'p. m.'
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${suffix}`
}

function formatMoney(minor: unknown, currency: unknown) {
  const amount = Number(minor)
  if (!Number.isFinite(amount)) return ''

  const code = typeof currency === 'string' && /^[A-Z]{3}$/.test(currency)
    ? currency
    : undefined

  try {
    return code
      ? new Intl.NumberFormat('es-DO', { style: 'currency', currency: code }).format(amount / 100)
      : (amount / 100).toFixed(2)
  } catch {
    return (amount / 100).toFixed(2)
  }
}

function whatsappUrl(phone: string, message = '') {
  let digits = phone.replace(/\D/g, '')

  if (digits.length === 10 && /^(809|829|849)/.test(digits)) {
    digits = `1${digits}`
  }

  if (!digits) return ''
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ''}`
}

function suggestedWhatsAppMessage(item: LeadIntake, snapshot: Record<string, any>) {
  const name = item.customer_name?.trim() || 'hola'
  const marker = item.marker_name || snapshot.name || 'tu solicitud'

  if (item.request_type === 'booking') {
    const date = item.booking_local_date || snapshot.preferred_date || ''
    const time = item.booking_local_time || snapshot.preferred_time || ''
    const detail = [
      date ? formatDateOnly(date) : '',
      time ? formatTime(time) : '',
    ].filter(Boolean).join(' a las ')

    return `Hola ${name}, recibimos tu solicitud de cita para ${marker}${detail ? ` el ${detail}` : ''}. Estamos revisando la disponibilidad y te confirmaremos a la mayor brevedad.`
  }

  return `Hola ${name}, recibimos tu solicitud de cotización sobre ${marker}. Gracias por escribirnos; en breve te compartiremos la información correspondiente.`
}

function customerMessageEventLabel(eventType: LeadIntakeCustomerMessageEvent) {
  const labels: Record<LeadIntakeCustomerMessageEvent, string> = {
    quote_sent: 'Cotización enviada',
    booking_confirmed: 'Cita confirmada',
    booking_rejected: 'Cita rechazada',
    booking_cancelled: 'Cita cancelada',
    booking_rescheduled: 'Cita reprogramada',
  }
  return labels[eventType]
}

function customerMessageStatusLabel(status: LeadIntakeCustomerMessageStatus) {
  const labels: Record<LeadIntakeCustomerMessageStatus, string> = {
    pending: 'Pendiente de responder',
    opened: 'WhatsApp abierto',
    sent: 'Marcada como enviada',
  }
  return labels[status]
}

function customerMessageTextWithNote(text: string, note: string) {
  return [text.trim(), note.trim()].filter(Boolean).join('\n\n')
}

function mergeUnique(current: LeadIntake[], incoming: LeadIntake[]) {
  const ids = new Set(current.map((item) => item.id))
  return [...current, ...incoming.filter((item) => !ids.has(item.id))]
}

function ConfirmationModal({
  confirmation,
  saving,
  onCancel,
  onConfirm,
}: {
  confirmation: Confirmation
  saving: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div style={s.modalBack} role="presentation">
      <div
        style={s.modalCard}
        role="dialog"
        aria-modal="true"
        aria-labelledby="request-confirmation-title"
      >
        <h2 id="request-confirmation-title" style={s.modalTitle}>{confirmation.title}</h2>
        <p style={s.modalCopy}>{confirmation.description}</p>

        <div style={s.modalActions}>
          <button type="button" style={s.modalCancel} disabled={saving} onClick={onCancel}>
            Volver
          </button>
          <button
            type="button"
            style={confirmation.tone === 'danger' ? s.modalDanger : s.modalPrimary}
            disabled={saving}
            onClick={onConfirm}
          >
            {saving ? 'Procesando...' : confirmation.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function CustomerResponseModal({
  draft,
  saving,
  onChangeText,
  onChangeNote,
  onLater,
  onOpenWhatsApp,
  onClose,
}: {
  draft: CustomerResponseDraft
  saving: boolean
  onChangeText: (value: string) => void
  onChangeNote: (value: string) => void
  onLater: () => void
  onOpenWhatsApp: () => void
  onClose: () => void
}) {
  return (
    <div style={s.modalBack} role="presentation">
      <div
        style={s.modalCard}
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-response-title"
      >
        <div style={s.modalHeading}>
          <div>
            <h2 id="customer-response-title" style={s.modalTitle}>Responder al cliente por WhatsApp</h2>
            <p style={s.modalCopy}>
              {customerMessageEventLabel(draft.message.event_type)}. Revisa el texto y agrega una nota opcional antes de abrir WhatsApp.
            </p>
          </div>
          <span style={s.messageStatusPending}>Pendiente</span>
        </div>

        <label style={s.modalField}>
          Mensaje para el cliente
          <textarea
            style={{ ...s.input, ...s.messageTextarea }}
            value={draft.text}
            disabled={saving}
            onChange={(event) => onChangeText(event.target.value)}
          />
        </label>

        <label style={s.modalField}>
          Nota opcional para el cliente
          <textarea
            style={{ ...s.input, ...s.noteTextarea }}
            value={draft.note}
            disabled={saving}
            placeholder="Ej.: Puedes respondernos por este mismo WhatsApp para cualquier ajuste."
            onChange={(event) => onChangeNote(event.target.value)}
          />
        </label>

        <p style={s.modalHint}>
          Abrir WhatsApp guarda esta respuesta y deja el chat listo. La plataforma no puede confirmar automáticamente que el mensaje fue enviado; podrás marcarlo después.
        </p>

        <div style={s.modalActions}>
          <button type="button" style={s.modalCancel} disabled={saving} onClick={onClose}>
            Cancelar
          </button>
          <button type="button" style={s.modalLater} disabled={saving} onClick={onLater}>
            Responder más tarde
          </button>
          <button type="button" style={s.modalPrimary} disabled={saving || !draft.text.trim()} onClick={onOpenWhatsApp}>
            {saving ? 'Guardando...' : 'Abrir WhatsApp'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TenantRequests() {
  const isMobile = useIsMobile()
  const [items, setItems] = useState<LeadIntake[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [status, setStatus] = useState<LeadIntakeStatus | ''>('')
  const [requestType, setRequestType] = useState<LeadIntakeRequestType | ''>('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState<PageMeta>(EMPTY_PAGE)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [noteDraft, setNoteDraft] = useState('')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [reschedule, setReschedule] = useState<RescheduleDraft | null>(null)
  const [customerMessages, setCustomerMessages] = useState<LeadIntakeCustomerMessage[]>([])
  const [customerResponse, setCustomerResponse] = useState<CustomerResponseDraft | null>(null)
  const [customerMessageSaving, setCustomerMessageSaving] = useState(false)

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? items[0] ?? null,
    [items, selectedId],
  )

  const snapshot = selected ? parseSnapshot(selected.marker_snapshot_json) : {}
  const bookingType = selected?.booking_appointment_type || snapshot.appointment_type || ''
  const bookingDate = selected?.booking_local_date || snapshot.preferred_date || ''
  const bookingTime = selected?.booking_local_time || snapshot.preferred_time || ''
  const bookingInstructions = selected?.booking_customer_instructions || snapshot.customer_instructions || ''
  const bookingLocation = selected?.booking_location || snapshot.location_text || ''
  const bookingDeliveryMode = selected?.booking_delivery_mode || snapshot.delivery_mode || ''
  const pendingCustomerMessages = customerMessages.filter((item) => item.status !== 'sent')

  async function loadCustomerMessages(leadId: string) {
    try {
      const response = await api.leadIntakes.customerMessages.list(leadId)
      setCustomerMessages(response.data ?? [])
    } catch {
      setCustomerMessages([])
    }
  }

  function openCustomerResponse(message: LeadIntakeCustomerMessage) {
    setCustomerResponse({
      message,
      text: message.message_text,
      note: message.note_text ?? '',
    })
  }

  async function createCustomerResponse(eventType: LeadIntakeCustomerMessageEvent) {
    if (!selected) return false

    setCustomerMessageSaving(true)
    setError('')

    try {
      const response = await api.leadIntakes.customerMessages.createDraft(selected.id, eventType)
      setCustomerMessages((current) => [
        response.data,
        ...current.filter((item) => item.id !== response.data.id),
      ])
      openCustomerResponse(response.data)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo preparar la respuesta para el cliente.')
      return false
    } finally {
      setCustomerMessageSaving(false)
    }
  }

  async function saveCustomerResponse(
    status: LeadIntakeCustomerMessageStatus,
    openWhatsApp = false,
  ) {
    if (!selected || !customerResponse) return false

    const currentDraft = customerResponse
    const text = currentDraft.text.trim()
    const note = currentDraft.note.trim()

    if (!text) {
      setError('Escribe un mensaje para el cliente antes de continuar.')
      return false
    }

    let popup: Window | null = null
    if (openWhatsApp) {
      popup = window.open('', '_blank')
      if (popup) popup.opener = null
    }

    setCustomerMessageSaving(true)
    setError('')

    try {
      const response = await api.leadIntakes.customerMessages.update(
        selected.id,
        currentDraft.message.id,
        {
          message_text: text,
          note_text: note,
          status,
        },
      )

      const updated = response.data
      const outgoingText = customerMessageTextWithNote(
        updated.message_text,
        updated.note_text ?? '',
      )

      setCustomerMessages((current) => current.map((item) => (
        item.id === updated.id
          ? updated
          : item
      )))
      setCustomerResponse(null)

      if (openWhatsApp) {
        const url = whatsappUrl(
          selected.customer_phone,
          outgoingText,
        )

        if (popup && url) {
          popup.location.href = url
        } else if (url) {
          window.open(url, '_blank')
        }

        setNotice('WhatsApp fue abierto con la respuesta preparada. Márcala como enviada cuando completes el envío.')
      } else {
        setNotice('La respuesta quedó guardada como pendiente para responder más tarde.')
      }

      return true
    } catch (err) {
      if (popup) popup.close()
      setError(err instanceof Error ? err.message : 'No se pudo guardar la respuesta al cliente.')
      return false
    } finally {
      setCustomerMessageSaving(false)
    }
  }

  async function markCustomerMessageSent(message: LeadIntakeCustomerMessage) {
    if (!selected) return

    setCustomerMessageSaving(true)
    setError('')

    try {
      const response = await api.leadIntakes.customerMessages.update(
        selected.id,
        message.id,
        { status: 'sent' },
      )

      setCustomerMessages((current) => current.map((item) => (
        item.id === response.data.id
          ? response.data
          : item
      )))
      setNotice('La respuesta fue marcada como enviada al cliente.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la respuesta al cliente.')
    } finally {
      setCustomerMessageSaving(false)
    }
  }

  async function load(append = false, queryOverride?: string) {
    if (append && !page.next_cursor) return

    setLoading(true)
    setError('')

    try {
      const response = await api.leadIntakes.list({
        status,
        request_type: requestType,
        q: (queryOverride ?? query).trim(),
        limit: 50,
        cursor: append ? page.next_cursor : null,
      })

      const incoming = response.data ?? []
      setPage(response.page ?? EMPTY_PAGE)

      if (append) {
        setItems((current) => mergeUnique(current, incoming))
      } else {
        setItems(incoming)
        setSelectedId((current) =>
          current && incoming.some((item) => item.id === current)
            ? current
            : incoming[0]?.id ?? '',
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las solicitudes.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(false)
    // La búsqueda de texto se ejecuta solo con Buscar o Enter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, requestType])

  useEffect(() => {
    setNoteDraft(selected?.internal_note ?? '')
  }, [selected?.id, selected?.internal_note])

  useEffect(() => {
    if (!selected?.id) {
      setCustomerMessages([])
      return
    }

    void loadCustomerMessages(selected.id)
  }, [selected?.id])

  useEffect(() => {
    if (!selected || selected.read_at) return

    void api.leadIntakes.markRead(selected.id)
      .then((response) => {
        setItems((current) => current.map((item) => (
          item.id === selected.id
            ? { ...item, read_at: response.data.read_at }
            : item
        )))
      })
      .catch(() => {})
  }, [selected?.id, selected?.read_at])

  async function updateSelected(patch: { status?: LeadIntakeStatus; internal_note?: string }) {
    if (!selected) return false

    setSaving(true)
    setError('')
    setNotice('')

    try {
      const response = await api.leadIntakes.update(selected.id, patch)
      setItems((current) =>
        current.map((item) => item.id === selected.id ? { ...item, ...response.data } : item),
      )
      setNotice('Solicitud actualizada.')
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la solicitud.')
      return false
    } finally {
      setSaving(false)
    }
  }

  function queueCommercialStatus(next: LeadIntakeStatus) {
    if (!selected) return

    const requestLabel = selected.request_type === 'booking'
      ? 'solicitud de cita'
      : 'cotización'
    const nextLabel = statusLabel(next, selected.request_type)
    const destructive = next === 'lost'

    const messages: Record<LeadIntakeStatus, string> = selected.request_type === 'booking'
      ? {
          new: 'La solicitud de cita volverá al estado Nueva.',
          contacted: 'La solicitud quedará tomada para revisar disponibilidad y atender al cliente.',
          quoted: 'La disponibilidad quedará registrada como revisada.',
          won: 'La solicitud quedará registrada como cita realizada.',
          lost: 'La solicitud de cita se cerrará sin seguimiento comercial.',
        }
      : {
          new: 'La cotización volverá al estado Nueva.',
          contacted: 'La solicitud quedará tomada para preparar la cotización.',
          quoted: 'La cotización quedará registrada como preparada.',
          won: 'La cotización quedará registrada como enviada al cliente.',
          lost: 'La cotización se cerrará sin seguimiento comercial.',
        }

    setConfirmation({
      title: `¿Actualizar ${requestLabel}?`,
      description: messages[next],
      confirmLabel: destructive
        ? 'Sí, cerrar sin seguimiento'
        : selected.request_type === 'quote' && next === 'won'
          ? 'Sí, enviar cotización'
          : `Sí, marcar: ${nextLabel}`,
      tone: destructive ? 'danger' : 'primary',
      action: async () => {
        const updated = await updateSelected({ status: next })
        if (updated && next === 'won' && selected.request_type === 'quote') {
          await createCustomerResponse('quote_sent')
        }
      },
    })
  }

  async function updateBookingStatus(next: 'confirmed' | 'rejected' | 'cancelled') {
    if (!selected?.booking_id) return

    setSaving(true)
    setError('')
    setNotice('')

    try {
      const response = await api.appointments.setStatus(selected.booking_id, next)

      setItems((current) => current.map((item) => (
        item.id === selected.id
          ? {
              ...item,
              booking_status: response.data.status,
              booking_local_date: response.data.local_date,
              booking_local_time: response.data.local_time,
              read_at: new Date().toISOString(),
            }
          : item
      )))

      setNotice(
        next === 'confirmed'
          ? 'La cita fue confirmada y el cupo queda reservado.'
          : next === 'rejected'
            ? 'La cita fue rechazada y el cupo fue liberado.'
            : 'La cita fue cancelada y el cupo fue liberado.',
      )

      await createCustomerResponse(
        next === 'confirmed'
          ? 'booking_confirmed'
          : next === 'rejected'
            ? 'booking_rejected'
            : 'booking_cancelled',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la cita.')
    } finally {
      setSaving(false)
    }
  }

  function queueBookingStatus(next: 'confirmed' | 'rejected' | 'cancelled') {
    if (!selected) return

    const copy = {
      confirmed: {
        title: '¿Confirmar esta cita?',
        description: `Confirmarás la cita de ${selected.customer_name} para ${bookingDate ? formatDateOnly(bookingDate) : 'la fecha seleccionada'}${bookingTime ? ` a las ${formatTime(bookingTime)}` : ''}. El cupo quedará reservado.`,
        label: 'Sí, confirmar cita',
        tone: 'primary' as const,
      },
      rejected: {
        title: '¿Rechazar esta cita?',
        description: 'La solicitud se rechazará y el horario volverá a estar disponible para otros clientes.',
        label: 'Sí, rechazar cita',
        tone: 'danger' as const,
      },
      cancelled: {
        title: '¿Cancelar esta cita?',
        description: 'La cita se cancelará y el horario volverá a estar disponible. Esta operación debe confirmarse antes de liberar el cupo.',
        label: 'Sí, cancelar cita',
        tone: 'danger' as const,
      },
    }[next]

    setConfirmation({
      title: copy.title,
      description: copy.description,
      confirmLabel: copy.label,
      tone: copy.tone,
      action: () => updateBookingStatus(next),
    })
  }

  async function loadRescheduleSlots(date: string) {
    if (!selected?.booking_calendar_id || !bookingType) return

    setReschedule((current) => current ? {
      ...current,
      date,
      time: current.date === date ? current.time : '',
      loading: true,
      error: '',
    } : current)

    try {
      const response = await api.appointmentCalendars.availability(selected.booking_calendar_id, {
        date,
        appointment_type: bookingType,
      })

      setReschedule((current) => {
        if (!current) return current
        const slots = response.data.slots ?? []
        const validTime = slots.some((slot) => slot.time === current.time) ? current.time : ''

        return {
          ...current,
          date,
          time: validTime,
          slots,
          loading: false,
          error: slots.length ? '' : 'No hay horarios disponibles para esta fecha.',
        }
      })
    } catch (err) {
      setReschedule((current) => current ? {
        ...current,
        loading: false,
        slots: [],
        error: err instanceof Error ? err.message : 'No se pudieron consultar los horarios disponibles.',
      } : current)
    }
  }

  function openReschedule() {
    if (!selected?.booking_id || !selected.booking_calendar_id || !bookingType || !bookingDate) {
      setError('No se encontró la información necesaria para reprogramar esta cita.')
      return
    }

    setReschedule({
      date: bookingDate,
      time: bookingTime,
      slots: [],
      loading: true,
      error: '',
    })

    void loadRescheduleSlots(bookingDate)
  }

  async function saveReschedule(date: string, time: string) {
    if (!selected?.booking_id || !time) return

    setSaving(true)
    setError('')
    setNotice('')

    try {
      const response = await api.appointments.reschedule(selected.booking_id, {
        local_date: date,
        local_time: time,
        appointment_type: bookingType,
      })

      setItems((current) => current.map((item) => (
        item.id === selected.id
          ? {
              ...item,
              booking_status: response.data.status,
              booking_local_date: response.data.local_date,
              booking_local_time: response.data.local_time,
              booking_appointment_type: response.data.appointment_type,
              read_at: new Date().toISOString(),
            }
          : item
      )))

      setReschedule(null)
      setNotice('La cita fue reprogramada y su disponibilidad se validó nuevamente.')
      await createCustomerResponse('booking_rescheduled')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo reprogramar la cita.')
    } finally {
      setSaving(false)
    }
  }

  function queueReschedule() {
    if (!reschedule?.date || !reschedule.time) {
      setReschedule((current) => current ? {
        ...current,
        error: 'Selecciona una fecha y una hora disponible.',
      } : current)
      return
    }

    const date = reschedule.date
    const time = reschedule.time
    setReschedule(null)

    setConfirmation({
      title: '¿Confirmar reprogramación?',
      description: `La cita se moverá a ${formatDateOnly(date)} a las ${formatTime(time)}. El sistema volverá a validar cupo antes de guardar.`,
      confirmLabel: 'Sí, reprogramar cita',
      tone: 'primary',
      action: () => saveReschedule(date, time),
    })
  }

  function activateType(next: LeadIntakeRequestType | '') {
    setRequestType(next)
  }

  function clearSearch() {
    setQuery('')
    void load(false, '')
  }

  const operationalStatus = selected?.booking_status || ''
  const bookingClosed = ['cancelled', 'rejected', 'expired'].includes(operationalStatus)
  const bookingConfirmed = operationalStatus === 'confirmed'

  return (
    <div style={s.wrap}>
      {confirmation && (
        <ConfirmationModal
          confirmation={confirmation}
          saving={saving}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            const action = confirmation.action
            setConfirmation(null)
            void action()
          }}
        />
      )}

      {customerResponse && (
        <CustomerResponseModal
          draft={customerResponse}
          saving={customerMessageSaving}
          onChangeText={(text) => setCustomerResponse((current) => current ? { ...current, text } : current)}
          onChangeNote={(note) => setCustomerResponse((current) => current ? { ...current, note } : current)}
          onClose={() => setCustomerResponse(null)}
          onLater={() => void saveCustomerResponse('pending')}
          onOpenWhatsApp={() => void saveCustomerResponse('opened', true)}
        />
      )}

      {reschedule && selected && (
        <div style={s.modalBack} role="presentation">
          <div
            style={s.modalCard}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reschedule-title"
          >
            <h2 id="reschedule-title" style={s.modalTitle}>Reprogramar cita</h2>
            <p style={s.modalCopy}>
              Selecciona un nuevo horario real disponible para {selected.customer_name}. La reserva actual conserva su estado hasta confirmar el cambio.
            </p>

            <label style={s.modalField}>
              Nueva fecha
              <input
                style={s.input}
                type="date"
                value={reschedule.date}
                min={new Date().toISOString().slice(0, 10)}
                disabled={reschedule.loading || saving}
                onChange={(event) => void loadRescheduleSlots(event.target.value)}
              />
            </label>

            <label style={s.modalField}>
              Hora disponible
              <select
                style={s.input}
                value={reschedule.time}
                disabled={reschedule.loading || saving || !reschedule.slots.length}
                onChange={(event) => setReschedule((current) => current ? {
                  ...current,
                  time: event.target.value,
                  error: '',
                } : current)}
              >
                <option value="">
                  {reschedule.loading ? 'Cargando horarios...' : 'Selecciona una hora'}
                </option>
                {reschedule.slots.map((slot) => (
                  <option key={slot.time} value={slot.time}>{formatTime(slot.label || slot.time)}</option>
                ))}
              </select>
            </label>

            {reschedule.error && <p style={s.error}>{reschedule.error}</p>}

            <div style={s.modalActions}>
              <button type="button" style={s.modalCancel} disabled={saving} onClick={() => setReschedule(null)}>
                Volver
              </button>
              <button type="button" style={s.modalPrimary} disabled={saving || reschedule.loading} onClick={queueReschedule}>
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={s.header}>
        <div>
          <h1 style={s.title}>Solicitudes</h1>
          <p style={s.subtitle}>
            Atiende cotizaciones y citas desde una sola bandeja. Agenda define reglas y disponibilidad; aquí gestionas al cliente y cada reserva.
          </p>
        </div>

        <button type="button" style={s.refresh} onClick={() => void load(false)} disabled={loading}>
          {loading ? 'Cargando...' : '↻ Actualizar'}
        </button>
      </div>

      <div style={s.tabs}>
        <button
          type="button"
          style={{ ...s.tab, ...(requestType === '' ? s.tabActive : {}) }}
          onClick={() => activateType('')}
        >
          Todas
        </button>

        <button
          type="button"
          style={{ ...s.tab, ...(requestType === 'quote' ? s.tabActive : {}) }}
          onClick={() => activateType('quote')}
        >
          Cotizaciones
        </button>

        <button
          type="button"
          style={{ ...s.tab, ...(requestType === 'booking' ? s.tabActive : {}) }}
          onClick={() => activateType('booking')}
        >
          Solicitudes de cita
        </button>
      </div>

      <div style={{ ...s.filters, ...(isMobile ? s.filtersMobile : {}) }}>
        <select
          style={s.input}
          value={status}
          onChange={(event) => setStatus(event.target.value as LeadIntakeStatus | '')}
        >
          <option value="">Todos los estados comerciales</option>
          {STATUSES.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>

        <input
          style={s.input}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void load(false)
          }}
          placeholder="Cliente, WhatsApp, ficha, referencia o publicación"
        />

        <button type="button" style={s.search} onClick={() => void load(false)} disabled={loading}>
          Buscar
        </button>

        {query && (
          <button type="button" style={s.clear} onClick={clearSearch} disabled={loading}>
            Limpiar
          </button>
        )}
      </div>

      {error && <p style={s.error}>{error}</p>}
      {notice && <p style={s.success}>{notice}</p>}

      <div style={{ ...s.workspace, ...(isMobile ? s.workspaceMobile : {}) }}>
        <section style={s.list}>
          <div style={s.listHeader}>
            <span>Solicitudes recibidas</span>
            <span style={s.listHint}>
              {loading ? 'Actualizando...' : `${items.length} mostrada${items.length === 1 ? '' : 's'}`}
            </span>
          </div>

          {!loading && !items.length ? (
            <div style={s.empty}>
              <strong>Aún no tienes solicitudes.</strong>
              <span>
                Cuando un visitante pida una cotización o una cita desde una ficha dinámica,
                aparecerá aquí para su seguimiento.
              </span>
            </div>
          ) : (
            <div style={s.rows}>
              {items.map((item) => {
                const itemSnapshot = parseSnapshot(item.marker_snapshot_json)
                const isActive = selected?.id === item.id
                const isUnread = !item.read_at

                return (
                  <button
                    key={item.id}
                    type="button"
                    style={{
                      ...s.row,
                      ...(isUnread ? s.rowUnread : {}),
                      ...(isActive ? s.rowActive : {}),
                    }}
                    onClick={() => {
                      setNotice('')
                      setError('')
                      setSelectedId(item.id)
                    }}
                  >
                    <div style={s.rowTop}>
                      <strong>{item.customer_name}</strong>
                      <span style={s.typeBadge}>{typeLabel(item.request_type)}</span>
                    </div>

                    <span>{item.customer_phone}</span>

                    <span style={s.rowMeta}>
                      {item.publication_title || itemSnapshot.publication_title || 'Publicación'}
                    </span>

                    <span style={s.rowMeta}>
                      {item.marker_name || itemSnapshot.name || 'Ficha dinámica'}
                      {(item.marker_reference || itemSnapshot.reference)
                        ? ` · ${item.marker_reference || itemSnapshot.reference}`
                        : ''}
                    </span>

                    <div style={s.rowBottom}>
                      <small>{formatDate(item.created_at)}</small>
                      <span style={s.rowStatusWrap}>
                        {isUnread && <b style={s.unreadBadge}>Nueva sin leer</b>}
                        <b style={s.statusText}>{statusLabel(item.status, item.request_type)}</b>
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {page.has_more && (
            <div style={s.loadMoreWrap}>
              <button type="button" style={s.refresh} onClick={() => void load(true)} disabled={loading}>
                {loading ? 'Cargando...' : `Cargar más (${page.limit})`}
              </button>
            </div>
          )}
        </section>

        <aside style={s.detail}>
          {!selected ? (
            <>
              <h2 style={s.detailTitle}>Detalle de solicitud</h2>
              <p style={s.detailCopy}>
                Selecciona una solicitud para revisar cliente, ficha, mensaje, seguimiento comercial y, cuando aplique, gestionar la cita.
              </p>
            </>
          ) : (
            <>
              <div style={s.detailHeader}>
                <div>
                  <h2 style={s.detailTitle}>{selected.customer_name}</h2>
                  <p style={s.detailCopy}>
                    {typeLabel(selected.request_type)} · {selected.customer_phone}
                    {selected.customer_email ? ` · ${selected.customer_email}` : ''}
                  </p>
                </div>

                <select
                  style={{ ...s.input, maxWidth: 175 }}
                  value={selected.status}
                  onChange={(event) => queueCommercialStatus(event.target.value as LeadIntakeStatus)}
                  disabled={saving}
                >
                  {STATUSES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {statusLabel(item.value, selected.request_type)}
                    </option>
                  ))}
                </select>
              </div>

              <div style={s.actions}>
                {whatsappUrl(selected.customer_phone, suggestedWhatsAppMessage(selected, snapshot)) && (
                  <a
                    href={whatsappUrl(selected.customer_phone, suggestedWhatsAppMessage(selected, snapshot))}
                    target="_blank"
                    rel="noreferrer"
                    style={s.whatsapp}
                  >
                    Responder por WhatsApp
                  </a>
                )}

                {selected.source_url && (
                  <a
                    href={selected.source_url}
                    target="_blank"
                    rel="noreferrer"
                    style={s.source}
                  >
                    Abrir ficha de origen
                  </a>
                )}
              </div>


              <div style={s.customerResponses}>
                <div style={s.customerResponsesHeader}>
                  <div>
                    <strong>Respuestas al cliente</strong>
                    <span>Mensajes preparados por WhatsApp para esta solicitud.</span>
                  </div>
                  {pendingCustomerMessages.length > 0 && (
                    <b style={s.pendingResponseBadge}>
                      {pendingCustomerMessages.length} pendiente{pendingCustomerMessages.length === 1 ? '' : 's'}
                    </b>
                  )}
                </div>

                {pendingCustomerMessages.length > 0 && (
                  <div style={s.pendingResponseAlert}>
                    <div>
                      <strong>Respuesta pendiente al cliente</strong>
                      <span>
                        Hay una respuesta preparada que aún no está marcada como enviada.
                      </span>
                    </div>
                    <button
                      type="button"
                      style={s.pendingResponseButton}
                      disabled={customerMessageSaving}
                      onClick={() => openCustomerResponse(pendingCustomerMessages[0])}
                    >
                      Continuar respuesta
                    </button>
                  </div>
                )}

                {!customerMessages.length ? (
                  <span style={s.workflowHint}>
                    Cuando confirmes una cita, la rechaces, la canceles, la reprogrames o envíes una cotización, se preparará aquí la respuesta para el cliente.
                  </span>
                ) : (
                  <div style={s.customerMessageList}>
                    {customerMessages.map((message) => (
                      <div key={message.id} style={s.customerMessageRow}>
                        <div style={s.customerMessageMain}>
                          <strong>{customerMessageEventLabel(message.event_type)}</strong>
                          <span>{message.message_text}</span>
                          {message.note_text && <small>Nota incluida: {message.note_text}</small>}
                          <small>Creada: {formatDate(message.created_at)}</small>
                        </div>

                        <div style={s.customerMessageActions}>
                          <span style={
                            message.status === 'sent'
                              ? s.messageStatusSent
                              : message.status === 'opened'
                                ? s.messageStatusOpened
                                : s.messageStatusPending
                          }>
                            {customerMessageStatusLabel(message.status)}
                          </span>

                          {message.status !== 'sent' && (
                            <button
                              type="button"
                              style={s.messageActionButton}
                              disabled={customerMessageSaving}
                              onClick={() => openCustomerResponse(message)}
                            >
                              {message.status === 'opened' ? 'Abrir de nuevo' : 'Responder'}
                            </button>
                          )}

                          {message.status !== 'sent' && (
                            <button
                              type="button"
                              style={s.messageSentButton}
                              disabled={customerMessageSaving}
                              onClick={() => void markCustomerMessageSent(message)}
                            >
                              Marcar enviada
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={s.workflow}>
                <strong style={s.workflowTitle}>
                  {selected.request_type === 'quote'
                    ? 'Gestión comercial de cotización'
                    : 'Gestión de solicitud de cita'}
                </strong>

                {selected.request_type === 'quote' ? (
                  <div style={s.workflowActions}>
                    <button
                      type="button"
                      style={s.workflowButton}
                      disabled={saving || selected.status === 'contacted'}
                      onClick={() => queueCommercialStatus('contacted')}
                    >
                      Tomar solicitud
                    </button>

                    <button
                      type="button"
                      style={s.workflowButton}
                      disabled={saving || selected.status === 'quoted'}
                      onClick={() => queueCommercialStatus('quoted')}
                    >
                      Cotización preparada
                    </button>

                    <button
                      type="button"
                      style={s.workflowPrimary}
                      disabled={saving || selected.status === 'won'}
                      onClick={() => queueCommercialStatus('won')}
                    >
                      Enviar cotización
                    </button>
                  </div>
                ) : (
                  <>
                    <div style={s.bookingState}>
                      <span>Estado operativo de la cita</span>
                      <strong>{bookingStatusLabel(operationalStatus)}</strong>
                    </div>

                    {!selected.booking_id ? (
                      <span style={s.workflowHint}>Esta solicitud no tiene una reserva operativa vinculada.</span>
                    ) : bookingClosed ? (
                      <span style={s.workflowHint}>
                        La cita está cerrada. Conserva el registro para consulta y seguimiento comercial, pero ya no admite acciones operativas.
                      </span>
                    ) : (
                      <div style={s.workflowActions}>
                        {operationalStatus === 'pending' && (
                          <>
                            <button
                              type="button"
                              style={s.workflowPrimary}
                              disabled={saving}
                              onClick={() => queueBookingStatus('confirmed')}
                            >
                              Confirmar cita
                            </button>

                            <button
                              type="button"
                              style={s.workflowDanger}
                              disabled={saving}
                              onClick={() => queueBookingStatus('rejected')}
                            >
                              Rechazar cita
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          style={s.workflowButton}
                          disabled={saving}
                          onClick={openReschedule}
                        >
                          Reprogramar
                        </button>

                        <button
                          type="button"
                          style={s.workflowDanger}
                          disabled={saving}
                          onClick={() => queueBookingStatus('cancelled')}
                        >
                          Cancelar cita
                        </button>
                      </div>
                    )}

                    {bookingConfirmed && (
                      <span style={s.workflowHint}>
                        La cita está confirmada. Puedes reprogramarla o cancelarla desde esta misma solicitud.
                      </span>
                    )}
                  </>
                )}
              </div>

              {selected.customer_message && (
                <div style={s.message}>{selected.customer_message}</div>
              )}

              <div style={s.context}>
                <strong>Contexto de la solicitud</strong>
                <span>Publicación: {selected.publication_title || snapshot.publication_title || 'Sin título'}</span>
                <span>Ficha: {selected.marker_name || snapshot.name || 'Ficha dinámica'}</span>

                {(selected.marker_reference || snapshot.reference) && (
                  <span>Referencia: {selected.marker_reference || snapshot.reference}</span>
                )}

                {selected.request_type === 'booking' && bookingType && (
                  <span>Tipo de cita: {bookingType}</span>
                )}

                {selected.request_type === 'booking' && bookingDate && (
                  <span>Fecha de cita: {formatDateOnly(bookingDate)}</span>
                )}

                {selected.request_type === 'booking' && bookingTime && (
                  <span>Hora de cita: {formatTime(bookingTime)}</span>
                )}

                {selected.request_type === 'booking' && bookingDeliveryMode && (
                  <span>Modalidad: {DELIVERY_LABELS[bookingDeliveryMode] ?? bookingDeliveryMode}</span>
                )}

                {selected.request_type === 'booking' && bookingLocation && (
                  <span>Ubicación / detalle: {bookingLocation}</span>
                )}

                {selected.request_type === 'booking' && bookingInstructions && (
                  <div style={s.instructions}>
                    <strong>Indicaciones enviadas al cliente</strong>
                    <span>{bookingInstructions}</span>
                  </div>
                )}

                {selected.request_type === 'booking' && selected.booking_status && (
                  <span>Estado de reserva: {bookingStatusLabel(selected.booking_status)}</span>
                )}

                {formatMoney(snapshot.estimated_total_minor, snapshot.currency) && (
                  <span>Total estimado: {formatMoney(snapshot.estimated_total_minor, snapshot.currency)}</span>
                )}

                <span>Recibida: {formatDate(selected.created_at)}</span>
                {selected.read_at && <span>Leída: {formatDate(selected.read_at)}</span>}
              </div>

              <label style={s.noteField}>
                <span>Nota interna</span>
                <textarea
                  style={{ ...s.input, minHeight: 96, resize: 'vertical' }}
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  placeholder="Seguimiento, próximos pasos o contexto interno"
                />
              </label>

              <button
                type="button"
                style={s.save}
                disabled={saving}
                onClick={() => void updateSelected({ internal_note: noteDraft })}
              >
                {saving ? 'Guardando...' : 'Guardar nota'}
              </button>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  wrap: { padding: 24, maxWidth: 1280, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 },
  title: { margin: 0, fontSize: 25, color: '#111827' },
  subtitle: { margin: '5px 0 0', color: '#6b7280', fontSize: 13, lineHeight: 1.5, maxWidth: 750 },
  refresh: { border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', color: '#374151', padding: '9px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  tabs: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 },
  tab: { border: 'none', borderRadius: 999, background: '#f3f4f6', color: '#6b7280', padding: '8px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  tabActive: { background: '#4f46e5', color: '#fff' },
  filters: { display: 'grid', gridTemplateColumns: 'minmax(180px, .45fr) minmax(260px, 1fr) auto auto', gap: 10, marginBottom: 16 },
  filtersMobile: { gridTemplateColumns: '1fr' },
  input: { width: '100%', boxSizing: 'border-box', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 11px', background: '#fff', color: '#374151', fontSize: 13, fontFamily: 'inherit' },
  search: { border: 'none', borderRadius: 8, background: '#4f46e5', color: '#fff', padding: '10px 15px', fontWeight: 800, cursor: 'pointer' },
  clear: { border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', color: '#6b7280', padding: '10px 12px', fontWeight: 700, cursor: 'pointer' },
  workspace: { display: 'grid', gridTemplateColumns: 'minmax(0, .95fr) minmax(340px, 1.05fr)', gap: 14, alignItems: 'start' },
  workspaceMobile: { gridTemplateColumns: '1fr' },
  list: { border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', overflow: 'hidden' },
  listHeader: { display: 'flex', justifyContent: 'space-between', gap: 10, padding: '14px 16px', borderBottom: '1px solid #f3f4f6', color: '#111827', fontSize: 13, fontWeight: 800 },
  listHint: { color: '#9ca3af', fontSize: 11, fontWeight: 500 },
  rows: { display: 'flex', flexDirection: 'column', gap: 8, padding: 10 },
  row: { width: '100%', border: '1px solid #e5e7eb', borderRadius: 9, background: '#fff', padding: 11, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4, cursor: 'pointer', color: '#374151', fontFamily: 'inherit' },
  rowUnread: { borderColor: '#fca5a5', background: 'rgba(254,242,242,.82)', boxShadow: 'inset 4px 0 0 rgba(239,68,68,.55)' },
  rowActive: { borderColor: '#4f46e5', boxShadow: '0 0 0 3px rgba(79,70,229,.10)' },
  rowTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowBottom: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginTop: 2 },
  rowStatusWrap: { display: 'inline-flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', justifyContent: 'flex-end' },
  rowMeta: { fontSize: 12, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  typeBadge: { borderRadius: 999, background: '#eef2ff', color: '#3730a3', padding: '3px 8px', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' },
  unreadBadge: { borderRadius: 999, background: '#ef4444', color: '#fff', padding: '3px 7px', fontSize: 10, whiteSpace: 'nowrap' },
  statusText: { fontSize: 12, color: '#4f46e5' },
  empty: { minHeight: 210, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 8, padding: 24, textAlign: 'center', color: '#6b7280', fontSize: 13, lineHeight: 1.55 },
  loadMoreWrap: { display: 'flex', justifyContent: 'center', padding: '4px 12px 14px' },
  detail: { border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', padding: 18, minHeight: 210, display: 'flex', flexDirection: 'column', gap: 12 },
  detailHeader: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' },
  detailTitle: { margin: 0, color: '#111827', fontSize: 17 },
  detailCopy: { margin: '7px 0 0', color: '#6b7280', fontSize: 13, lineHeight: 1.55 },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  workflow: { display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid #dbeafe', background: '#f8fbff', borderRadius: 9, padding: 11 },
  workflowTitle: { color: '#1e3a8a', fontSize: 12, fontWeight: 900 },
  workflowActions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  workflowButton: { border: '1px solid #c7d2fe', borderRadius: 8, background: '#fff', color: '#3730a3', padding: '8px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer' },
  workflowPrimary: { border: '1px solid #4338ca', borderRadius: 8, background: '#4f46e5', color: '#fff', padding: '8px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer' },
  workflowDanger: { border: '1px solid #fecaca', borderRadius: 8, background: '#fff', color: '#b91c1c', padding: '8px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer' },
  workflowHint: { color: '#475569', fontSize: 11.5, lineHeight: 1.5 },
  bookingState: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', borderRadius: 8, background: '#eef2ff', color: '#3730a3', padding: '8px 10px', fontSize: 12 },
  whatsapp: { border: '1px solid #a7f3d0', borderRadius: 8, background: '#ecfdf5', color: '#047857', padding: '8px 10px', textDecoration: 'none', fontSize: 12, fontWeight: 800 },
  source: { border: '1px solid #c7d2fe', borderRadius: 8, background: '#eef2ff', color: '#4338ca', padding: '8px 10px', textDecoration: 'none', fontSize: 12, fontWeight: 800 },
  message: { padding: 11, borderRadius: 8, background: '#f9fafb', color: '#374151', fontSize: 13, lineHeight: 1.55 },
  context: { display: 'flex', flexDirection: 'column', gap: 6, padding: 11, borderRadius: 9, background: '#f8fafc', color: '#374151', fontSize: 12.5, lineHeight: 1.5 },
  instructions: { display: 'flex', flexDirection: 'column', gap: 4, border: '1px solid #bfdbfe', borderRadius: 8, background: '#eff6ff', color: '#1e3a8a', padding: 9, marginTop: 2 },
  noteField: { display: 'flex', flexDirection: 'column', gap: 6, color: '#6b7280', fontSize: 12, fontWeight: 700 },
  save: { border: 'none', borderRadius: 8, background: '#4f46e5', color: '#fff', padding: '10px 13px', fontWeight: 800, cursor: 'pointer' },
  error: { margin: 0, color: '#b91c1c', fontSize: 13, lineHeight: 1.5 },
  success: { margin: '0 0 12px', color: '#047857', fontSize: 13, lineHeight: 1.5 },
  modalBack: { position: 'fixed', inset: 0, zIndex: 2200, background: 'rgba(15,23,42,.56)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 },
  modalCard: { width: 'min(460px, 100%)', borderRadius: 14, background: '#fff', boxShadow: '0 24px 70px rgba(15,23,42,.32)', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 },
  modalTitle: { margin: 0, color: '#111827', fontSize: 19 },
  modalCopy: { margin: 0, color: '#475569', fontSize: 13.5, lineHeight: 1.55 },
  modalField: { display: 'flex', flexDirection: 'column', gap: 6, color: '#374151', fontSize: 12, fontWeight: 800 },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 9, flexWrap: 'wrap', marginTop: 4 },
  modalCancel: { border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', color: '#374151', padding: '9px 12px', fontWeight: 800, cursor: 'pointer' },
  modalPrimary: { border: '1px solid #4338ca', borderRadius: 8, background: '#4f46e5', color: '#fff', padding: '9px 12px', fontWeight: 800, cursor: 'pointer' },
  modalDanger: { border: '1px solid #dc2626', borderRadius: 8, background: '#dc2626', color: '#fff', padding: '9px 12px', fontWeight: 800, cursor: 'pointer' },
  modalLater: { border: '1px solid #c7d2fe', borderRadius: 8, background: '#eef2ff', color: '#3730a3', padding: '9px 12px', fontWeight: 800, cursor: 'pointer' },
  modalHeading: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  modalHint: { margin: 0, color: '#64748b', fontSize: 11.5, lineHeight: 1.5 },
  messageTextarea: { minHeight: 132, resize: 'vertical', lineHeight: 1.5 },
  noteTextarea: { minHeight: 74, resize: 'vertical', lineHeight: 1.5 },
  customerResponses: { display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid #c7d2fe', borderRadius: 10, background: '#f8fbff', padding: 11 },
  customerResponsesHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, color: '#1e3a8a', fontSize: 12 },
  pendingResponseBadge: { borderRadius: 999, background: '#f59e0b', color: '#fff', padding: '4px 8px', fontSize: 10, whiteSpace: 'nowrap' },
  pendingResponseAlert: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap', border: '1px solid #fcd34d', borderRadius: 8, background: '#fffbeb', color: '#92400e', padding: 9, fontSize: 12, lineHeight: 1.45 },
  pendingResponseButton: { border: '1px solid #f59e0b', borderRadius: 8, background: '#fff', color: '#92400e', padding: '7px 9px', fontSize: 11, fontWeight: 800, cursor: 'pointer' },
  customerMessageList: { display: 'flex', flexDirection: 'column', gap: 8 },
  customerMessageRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, border: '1px solid #dbeafe', borderRadius: 8, background: '#fff', padding: 9, flexWrap: 'wrap' },
  customerMessageMain: { display: 'flex', flexDirection: 'column', gap: 3, color: '#475569', fontSize: 11.5, lineHeight: 1.45, flex: '1 1 230px' },
  customerMessageActions: { display: 'flex', alignItems: 'flex-end', gap: 6, flexDirection: 'column', flex: '0 1 auto' },
  messageStatusPending: { borderRadius: 999, background: '#fef3c7', color: '#92400e', padding: '3px 7px', fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap' },
  messageStatusOpened: { borderRadius: 999, background: '#dbeafe', color: '#1d4ed8', padding: '3px 7px', fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap' },
  messageStatusSent: { borderRadius: 999, background: '#dcfce7', color: '#166534', padding: '3px 7px', fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap' },
  messageActionButton: { border: '1px solid #c7d2fe', borderRadius: 7, background: '#eef2ff', color: '#3730a3', padding: '6px 8px', fontSize: 10.5, fontWeight: 800, cursor: 'pointer' },
  messageSentButton: { border: '1px solid #bbf7d0', borderRadius: 7, background: '#f0fdf4', color: '#166534', padding: '6px 8px', fontSize: 10.5, fontWeight: 800, cursor: 'pointer' },
}
