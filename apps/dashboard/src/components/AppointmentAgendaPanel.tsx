import React, { useEffect, useMemo, useState } from 'react'
import {
  api,
  type AppointmentBooking,
  type AppointmentCalendar,
  type AppointmentCalendarException,
  type AppointmentCalendarInput,
  type AppointmentCalendarType,
  type AppointmentCalendarWindow,
} from '../lib/api'

type Props = {
  selectedCalendarId: string
  initialTab?: 'settings' | 'bookings'
  initialDate?: string
  focusBookingId?: string
  onCalendarUpdated?: () => void
}

type BookingView = 'day' | 'week' | 'list'
type DeliveryMode = NonNullable<AppointmentCalendarType['delivery_mode']>

type BookingPage = {
  from: string
  to: string
  limit: number
  has_more: boolean
  next_cursor: string | null
}

type CalendarBundle = {
  calendar: AppointmentCalendar
  windows: AppointmentCalendarWindow[]
  exceptions: AppointmentCalendarException[]
  types: AppointmentCalendarType[]
}

const statuses: Array<{ value: AppointmentBooking['status'] | ''; label: string }> = [
  { value: '', label: 'Todos los estados' },
  { value: 'pending', label: 'Pendiente' },
  { value: 'confirmed', label: 'Confirmada' },
  { value: 'cancelled', label: 'Cancelada' },
  { value: 'rejected', label: 'Rechazada' },
  { value: 'expired', label: 'Expirada' },
]

const statusActions: Array<{ value: AppointmentBooking['status']; label: string }> = [
  { value: 'confirmed', label: 'Confirmar' },
  { value: 'rejected', label: 'Rechazar' },
  { value: 'cancelled', label: 'Cancelar' },
]

const weekdayLabels = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

const deliveryModes: Array<{ value: DeliveryMode; label: string }> = [
  { value: 'in_person', label: 'Presencial' },
  { value: 'video_call', label: 'Videollamada' },
  { value: 'phone_call', label: 'Llamada telefónica' },
  { value: 'other', label: 'Otra modalidad' },
]

const exceptionKinds: Array<{ value: AppointmentCalendarException['kind']; label: string }> = [
  { value: 'blocked_full', label: 'Bloqueo de día completo' },
  { value: 'blocked_partial', label: 'Bloqueo parcial' },
  { value: 'extra', label: 'Horario extra' },
]

function statusLabel(value: string) {
  return statuses.find((item) => item.value === value)?.label ?? value
}

function formatDateTime(booking: AppointmentBooking) {
  return `${booking.local_date} · ${booking.local_time} (${booking.timezone})`
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`)
  if (Number.isNaN(value.getTime())) return date
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function bookingRange(date: string, view: BookingView) {
  if (view === 'day') return { from: date, to: addDays(date, 1) }
  if (view === 'week') return { from: date, to: addDays(date, 7) }
  return { from: date, to: addDays(date, 31) }
}

function calendarInputFromBundle(data: CalendarBundle): AppointmentCalendarInput {
  return {
    name: data.calendar.name,
    timezone: data.calendar.timezone,
    slot_interval_minutes: data.calendar.slot_interval_minutes,
    default_duration_minutes: data.calendar.default_duration_minutes,
    default_buffer_minutes: data.calendar.default_buffer_minutes,
    max_per_slot: data.calendar.max_per_slot,
    max_per_day: data.calendar.max_per_day,
    min_notice_minutes: data.calendar.min_notice_minutes,
    booking_horizon_days: data.calendar.booking_horizon_days,
    hold_expires_after_minutes: data.calendar.hold_expires_after_minutes,
    weekly_windows: data.windows,
    exceptions: data.exceptions,
    appointment_types: data.types,
  }
}

function dedupeBookings(items: AppointmentBooking[]) {
  const unique = new Map<string, AppointmentBooking>()
  for (const item of items) unique.set(item.id, item)
  return Array.from(unique.values())
}

function numberOrNull(value: string) {
  if (!value.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function windowMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return -1
  return (hours * 60) + minutes
}

function findWindowConflicts(windows: AppointmentCalendarWindow[]) {
  const conflicts: string[] = []

  for (let weekday = 0; weekday <= 6; weekday += 1) {
    const group = windows
      .filter((window) => window.weekday === weekday)
      .slice()
      .sort((a, b) => windowMinutes(a.start_time) - windowMinutes(b.start_time))

    for (let index = 1; index < group.length; index += 1) {
      const previous = group[index - 1]
      const current = group[index]

      if (
        windowMinutes(previous.start_time) >= 0
        && windowMinutes(current.start_time) >= 0
        && windowMinutes(current.start_time) < windowMinutes(previous.end_time)
      ) {
        conflicts.push(
          `${weekdayLabels[weekday]}: ${previous.start_time}–${previous.end_time} y ${current.start_time}–${current.end_time}`,
        )
      }
    }
  }

  return Array.from(new Set(conflicts))
}

function newWindow(index: number): AppointmentCalendarWindow {
  return {
    weekday: 1,
    start_time: '09:00',
    end_time: '17:00',
    active: true,
    sort_order: index,
  }
}

function newException(): AppointmentCalendarException {
  return {
    date: '',
    kind: 'blocked_full',
    start_time: null,
    end_time: null,
    max_per_slot_override: null,
    note: null,
  }
}

function newAppointmentType(index: number): AppointmentCalendarType {
  return {
    label: '',
    delivery_mode: 'in_person',
    location_text: null,
    meeting_url: null,
    customer_instructions: null,
    duration_minutes: null,
    buffer_minutes: null,
    max_per_slot: null,
    active: true,
    sort_order: index,
  }
}

export default function AppointmentAgendaPanel({
  selectedCalendarId,
  initialTab,
  initialDate,
  focusBookingId,
  onCalendarUpdated,
}: Props) {
  const [tab, setTab] = useState<'settings' | 'bookings'>('settings')
  const [calendarId, setCalendarId] = useState(selectedCalendarId)
  const [calendarDraft, setCalendarDraft] = useState<AppointmentCalendarInput | null>(null)
  const [weeklyWindows, setWeeklyWindows] = useState<AppointmentCalendarWindow[]>([])
  const [exceptions, setExceptions] = useState<AppointmentCalendarException[]>([])
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentCalendarType[]>([])
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [calendarSaving, setCalendarSaving] = useState(false)
  const [calendarMessage, setCalendarMessage] = useState('')
  const [showBatchWindow, setShowBatchWindow] = useState(false)
  const [batchWeekdays, setBatchWeekdays] = useState<number[]>([])
  const [batchStartTime, setBatchStartTime] = useState('09:00')
  const [batchEndTime, setBatchEndTime] = useState('17:00')
  const [batchActive, setBatchActive] = useState(true)

  const [items, setItems] = useState<AppointmentBooking[]>([])
  const [status, setStatus] = useState<AppointmentBooking['status'] | ''>('')
  const [appointmentTypeInput, setAppointmentTypeInput] = useState('')
  const [filters, setFilters] = useState({ appointmentType: '' })
  const [view, setView] = useState<BookingView>('day')
  const [date, setDate] = useState(() => initialDate || new Date().toISOString().slice(0, 10))
  const [bookingsLoading, setBookingsLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage] = useState<BookingPage | null>(null)
  const [savingId, setSavingId] = useState('')
  const [rescheduleId, setRescheduleId] = useState('')
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [rescheduleTime, setRescheduleTime] = useState('')
  const [error, setError] = useState('')
  const [availability, setAvailability] = useState<{
    timezone: string
    date: string
    slots: { time: string; label: string }[]
  } | null>(null)

  const range = useMemo(() => bookingRange(date, view), [date, view])

  const bookingTypeOptions = useMemo(
    () => appointmentTypes.filter((item) => item.label.trim()),
    [appointmentTypes],
  )

  useEffect(() => {
    setCalendarId(selectedCalendarId)
    setTab('settings')
  }, [selectedCalendarId, initialTab, initialDate])

  const loadCalendarDetails = async (id: string) => {
    if (!id) {
      setCalendarDraft(null)
      setWeeklyWindows([])
      setExceptions([])
      setAppointmentTypes([])
      return
    }

    setCalendarLoading(true)
    setCalendarMessage('')

    try {
      const res = await api.appointmentCalendars.get(id)
      const draft = calendarInputFromBundle(res.data)
      setCalendarDraft(draft)
      setWeeklyWindows(draft.weekly_windows)
      setExceptions(draft.exceptions)
      setAppointmentTypes(draft.appointment_types)
    } catch (err) {
      setCalendarDraft(null)
      setWeeklyWindows([])
      setExceptions([])
      setAppointmentTypes([])
      setCalendarMessage(err instanceof Error ? err.message : 'No se pudo cargar la configuración de la Agenda.')
    } finally {
      setCalendarLoading(false)
    }
  }

  const loadBookings = async (cursor = '', append = false) => {
    if (!calendarId) {
      setItems([])
      setPage(null)
      return
    }

    if (append) setLoadingMore(true)
    else setBookingsLoading(true)

    setError('')

    try {
      const res = await api.appointments.list({
        calendar_id: calendarId,
        status,
        appointment_type: filters.appointmentType,
        from: range.from,
        to: range.to,
        limit: 50,
        cursor,
      })

      setItems((current) => append ? dedupeBookings([...current, ...(res.data ?? [])]) : (res.data ?? []))
      setPage(res.page)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las reservas.')
      if (!append) {
        setItems([])
        setPage(null)
      }
    } finally {
      if (append) setLoadingMore(false)
      else setBookingsLoading(false)
    }
  }

  useEffect(() => {
    void loadCalendarDetails(calendarId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarId])

  useEffect(() => {
    // Agenda configura reglas; las reservas se atienden con los controles disponibles.
    setItems([])
    setPage(null)
    setAvailability(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarId])

  useEffect(() => {
    if (!calendarId || tab !== 'bookings') {
      setAvailability(null)
      return
    }

    api.appointmentCalendars.availability(calendarId, {
      date,
      appointment_type: filters.appointmentType,
    })
      .then((res) => setAvailability(res.data))
      .catch(() => setAvailability(null))
  }, [calendarId, date, filters.appointmentType, tab])

  const patchCalendar = (patch: Partial<AppointmentCalendarInput>) => {
    setCalendarMessage('')
    setCalendarDraft((current) => current ? { ...current, ...patch } : current)
  }

  const patchWindow = (index: number, patch: Partial<AppointmentCalendarWindow>) => {
    setCalendarMessage('')
    setWeeklyWindows((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...patch } : item
    )))
  }

  const toggleBatchWeekday = (weekday: number) => {
    setBatchWeekdays((current) => (
      current.includes(weekday)
        ? current.filter((item) => item !== weekday)
        : [...current, weekday].sort((a, b) => a - b)
    ))
  }

  const addBatchWindows = () => {
    if (!batchWeekdays.length) {
      setCalendarMessage('Selecciona al menos un día para aplicar la franja.')
      return
    }

    if (
      windowMinutes(batchStartTime) < 0
      || windowMinutes(batchEndTime) < 0
      || windowMinutes(batchEndTime) <= windowMinutes(batchStartTime)
    ) {
      setCalendarMessage('La hora de fin debe ser posterior a la hora de inicio.')
      return
    }

    const candidates = batchWeekdays.map((weekday, index) => ({
      weekday,
      start_time: batchStartTime,
      end_time: batchEndTime,
      active: batchActive,
      sort_order: weeklyWindows.length + index,
    }))

    const conflicts = findWindowConflicts([...weeklyWindows, ...candidates])

    if (conflicts.length) {
      setCalendarMessage(`No se agregaron franjas porque hay duplicados o solapamientos: ${conflicts.join(' · ')}`)
      return
    }

    setWeeklyWindows((current) => [...current, ...candidates])
    setShowBatchWindow(false)
    setCalendarMessage(`Franja agregada a ${candidates.length} día(s).`)
  }

  const patchException = (index: number, patch: Partial<AppointmentCalendarException>) => {
    setCalendarMessage('')
    setExceptions((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...patch } : item
    )))
  }

  const patchAppointmentType = (index: number, patch: Partial<AppointmentCalendarType>) => {
    setCalendarMessage('')
    setAppointmentTypes((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...patch } : item
    )))
  }

  const saveCalendar = async () => {
    if (!calendarId || !calendarDraft) return

    const normalizedWindows = weeklyWindows
      .filter((item) => item.start_time && item.end_time)
      .map((item, index) => ({
        ...item,
        active: item.active === false || Number(item.active) === 0 ? false : true,
        sort_order: index,
      }))

    const windowConflicts = findWindowConflicts(normalizedWindows)

    if (windowConflicts.length) {
      setCalendarMessage(`Corrige los duplicados o solapamientos antes de guardar: ${windowConflicts.join(' · ')}`)
      return
    }

    const normalizedExceptions = exceptions
      .filter((item) => item.date && item.kind)
      .map((item) => ({
        ...item,
        start_time: item.kind === 'blocked_full' ? null : (item.start_time || null),
        end_time: item.kind === 'blocked_full' ? null : (item.end_time || null),
        max_per_slot_override: item.max_per_slot_override ?? null,
        note: item.note?.trim() || null,
      }))

    const normalizedTypes = appointmentTypes
      .filter((item) => item.label.trim())
      .map((item, index) => ({
        ...item,
        label: item.label.trim(),
        delivery_mode: item.delivery_mode ?? 'in_person',
        location_text: item.location_text?.trim() || null,
        meeting_url: item.meeting_url?.trim() || null,
        customer_instructions: item.customer_instructions?.trim() || null,
        active: item.active === false || Number(item.active) === 0 ? false : true,
        sort_order: index,
      }))

    setCalendarSaving(true)
    setCalendarMessage('')

    try {
      const body: AppointmentCalendarInput = {
        ...calendarDraft,
        name: calendarDraft.name.trim() || 'Agenda sin nombre',
        weekly_windows: normalizedWindows,
        exceptions: normalizedExceptions,
        appointment_types: normalizedTypes,
      }

      const res = await api.appointmentCalendars.update(calendarId, body)
      const nextDraft = calendarInputFromBundle(res.data)

      setCalendarDraft(nextDraft)
      setWeeklyWindows(nextDraft.weekly_windows)
      setExceptions(nextDraft.exceptions)
      setAppointmentTypes(nextDraft.appointment_types)
      setCalendarMessage('Configuración de Agenda guardada.')
      onCalendarUpdated?.()
    } catch (err) {
      setCalendarMessage(err instanceof Error ? err.message : 'No se pudo guardar la Agenda.')
    } finally {
      setCalendarSaving(false)
    }
  }

  const applyFilters = () => {
    setFilters({ appointmentType: appointmentTypeInput })
  }

  const refreshAll = () => {
    if (calendarId) {
      void loadCalendarDetails(calendarId)
    }
  }

  const updateStatus = async (booking: AppointmentBooking, next: AppointmentBooking['status']) => {
    setSavingId(booking.id)
    setError('')

    try {
      const res = await api.appointments.setStatus(booking.id, next)
      setItems((current) => current.map((item) => item.id === booking.id ? { ...item, ...res.data } : item))

      if (calendarId) {
        const availabilityRes = await api.appointmentCalendars.availability(calendarId, {
          date,
          appointment_type: filters.appointmentType,
        })
        setAvailability(availabilityRes.data)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la cita.')
    } finally {
      setSavingId('')
    }
  }

  const startReschedule = (booking: AppointmentBooking) => {
    setRescheduleId(booking.id)
    setRescheduleDate(booking.local_date)
    setRescheduleTime(booking.local_time)
  }

  const saveReschedule = async (booking: AppointmentBooking) => {
    setSavingId(booking.id)
    setError('')

    try {
      const res = await api.appointments.reschedule(booking.id, {
        local_date: rescheduleDate,
        local_time: rescheduleTime,
        appointment_type: booking.appointment_type,
      })

      setItems((current) => current.map((item) => item.id === booking.id ? { ...item, ...res.data } : item))
      setRescheduleId('')

      if (calendarId) {
        const availabilityRes = await api.appointmentCalendars.availability(calendarId, {
          date,
          appointment_type: filters.appointmentType,
        })
        setAvailability(availabilityRes.data)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo reprogramar la cita.')
    } finally {
      setSavingId('')
    }
  }

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <div>
          <h3 style={styles.title}>{calendarDraft?.name || 'Agenda'}</h3>
          <p style={styles.copy}>
            Configura disponibilidad, tipos de cita, bloqueos, cupos y reservas.
          </p>
        </div>

        <button
          type="button"
          style={styles.secondaryBtn}
          onClick={refreshAll}
          disabled={bookingsLoading || calendarLoading}
        >
          {bookingsLoading || calendarLoading ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      <div
        style={{
          border: '1px solid #c7d2fe',
          borderRadius: 10,
          background: '#f5f7ff',
          color: '#3730a3',
          padding: 11,
          fontSize: 12.5,
          lineHeight: 1.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <strong>Configuración de Agenda</strong>
        <span>
          Aquí defines horarios, tipos de cita, cupos y bloqueos, y puedes revisar las reservas generadas.
        </span>
      </div>

      {tab === 'settings' && (
        <>
          {calendarLoading || !calendarDraft ? (
            <p style={styles.empty}>Cargando configuración de Agenda...</p>
          ) : (
            <div style={styles.settings}>
              <div style={styles.section}>
                <div style={styles.sectionTitle}>Información y reglas generales</div>

                <div style={styles.grid}>
                  <Field label="Nombre interno">
                    <input
                      style={styles.input}
                      value={calendarDraft.name}
                      disabled={calendarSaving}
                      onChange={(event) => patchCalendar({ name: event.target.value })}
                    />
                  </Field>

                  <Field label="Zona horaria">
                    <input
                      style={styles.input}
                      value={calendarDraft.timezone}
                      disabled={calendarSaving}
                      onChange={(event) => patchCalendar({ timezone: event.target.value })}
                      placeholder="America/Santo_Domingo"
                    />
                  </Field>

                  <Field label="Duración predeterminada (min)">
                    <input
                      style={styles.input}
                      type="number"
                      min={5}
                      value={calendarDraft.default_duration_minutes}
                      disabled={calendarSaving}
                      onChange={(event) => patchCalendar({ default_duration_minutes: Number(event.target.value) })}
                    />
                  </Field>

                  <Field label="Intervalo de inicio (min)">
                    <input
                      style={styles.input}
                      type="number"
                      min={5}
                      value={calendarDraft.slot_interval_minutes}
                      disabled={calendarSaving}
                      onChange={(event) => patchCalendar({ slot_interval_minutes: Number(event.target.value) })}
                    />
                  </Field>

                  <Field label="Margen entre citas (min)">
                    <input
                      style={styles.input}
                      type="number"
                      min={0}
                      value={calendarDraft.default_buffer_minutes}
                      disabled={calendarSaving}
                      onChange={(event) => patchCalendar({ default_buffer_minutes: Number(event.target.value) })}
                    />
                  </Field>

                  <Field label="Cupo por horario">
                    <input
                      style={styles.input}
                      type="number"
                      min={1}
                      value={calendarDraft.max_per_slot}
                      disabled={calendarSaving}
                      onChange={(event) => patchCalendar({ max_per_slot: Number(event.target.value) })}
                    />
                  </Field>

                  <Field label="Cupo diario">
                    <input
                      style={styles.input}
                      type="number"
                      min={1}
                      value={calendarDraft.max_per_day}
                      disabled={calendarSaving}
                      onChange={(event) => patchCalendar({ max_per_day: Number(event.target.value) })}
                    />
                  </Field>

                  <Field label="Anticipación mínima (min)">
                    <input
                      style={styles.input}
                      type="number"
                      min={0}
                      value={calendarDraft.min_notice_minutes}
                      disabled={calendarSaving}
                      onChange={(event) => patchCalendar({ min_notice_minutes: Number(event.target.value) })}
                    />
                  </Field>

                  <Field label="Horizonte de reserva (días)">
                    <input
                      style={styles.input}
                      type="number"
                      min={1}
                      value={calendarDraft.booking_horizon_days}
                      disabled={calendarSaving}
                      onChange={(event) => patchCalendar({ booking_horizon_days: Number(event.target.value) })}
                    />
                  </Field>

                  <Field label="Expiración de pendiente (min)">
                    <input
                      style={styles.input}
                      type="number"
                      min={1}
                      value={calendarDraft.hold_expires_after_minutes}
                      disabled={calendarSaving}
                      onChange={(event) => patchCalendar({ hold_expires_after_minutes: Number(event.target.value) })}
                    />
                  </Field>
                </div>
              </div>

              <div style={styles.section}>
                <div style={styles.sectionHead}>
                  <div>
                    <div style={styles.sectionTitle}>Disponibilidad semanal</div>
                    <span style={styles.help}>
                      Crea una franja para un día o aplícala por lote a varios días. Cada día seguirá siendo editable por separado.
                    </span>
                  </div>

                  <button
                    type="button"
                    style={styles.secondaryBtn}
                    disabled={calendarSaving}
                    onClick={() => setShowBatchWindow((current) => !current)}
                  >
                    {showBatchWindow ? 'Cerrar lote' : '+ Agregar franja'}
                  </button>
                </div>

                {showBatchWindow && (
                  <div style={{
                    border: '1px solid #c7d2fe',
                    borderRadius: 10,
                    background: '#f8faff',
                    padding: 12,
                    marginBottom: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}>
                    <strong style={{ color: '#111827', fontSize: 13 }}>
                      Aplicar una misma franja a varios días
                    </strong>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                      <button type="button" style={styles.secondaryBtn} disabled={calendarSaving} onClick={() => setBatchWeekdays([1, 2, 3, 4, 5])}>
                        Lunes a Viernes
                      </button>
                      <button type="button" style={styles.secondaryBtn} disabled={calendarSaving} onClick={() => setBatchWeekdays([0, 6])}>
                        Fin de semana
                      </button>
                      <button type="button" style={styles.secondaryBtn} disabled={calendarSaving} onClick={() => setBatchWeekdays([0, 1, 2, 3, 4, 5, 6])}>
                        Todos los días
                      </button>
                      <button type="button" style={styles.secondaryBtn} disabled={calendarSaving} onClick={() => setBatchWeekdays([])}>
                        Limpiar
                      </button>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                      {weekdayLabels.map((day, weekday) => {
                        const selected = batchWeekdays.includes(weekday)
                        return (
                          <label
                            key={day}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              border: `1px solid ${selected ? '#4f46e5' : '#d1d5db'}`,
                              borderRadius: 8,
                              background: selected ? '#eef2ff' : '#fff',
                              padding: '7px 9px',
                              color: '#374151',
                              fontSize: 12,
                              cursor: calendarSaving ? 'default' : 'pointer',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={calendarSaving}
                              onChange={() => toggleBatchWeekday(weekday)}
                            />
                            {day}
                          </label>
                        )
                      })}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                      <Field label="Inicio">
                        <input
                          style={styles.input}
                          type="time"
                          value={batchStartTime}
                          disabled={calendarSaving}
                          onChange={(event) => setBatchStartTime(event.target.value)}
                        />
                      </Field>

                      <Field label="Fin">
                        <input
                          style={styles.input}
                          type="time"
                          value={batchEndTime}
                          disabled={calendarSaving}
                          onChange={(event) => setBatchEndTime(event.target.value)}
                        />
                      </Field>

                      <label style={styles.checkField}>
                        <input
                          type="checkbox"
                          checked={batchActive}
                          disabled={calendarSaving}
                          onChange={(event) => setBatchActive(event.target.checked)}
                        />
                        Publicar franja
                      </label>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        style={styles.primaryBtn}
                        disabled={calendarSaving}
                        onClick={addBatchWindows}
                      >
                        Agregar a {batchWeekdays.length || 0} día(s)
                      </button>
                    </div>
                  </div>
                )}

                {!weeklyWindows.length ? (
                  <p style={styles.empty}>Aún no hay horarios. La Agenda no mostrará disponibilidad hasta agregar al menos una franja activa.</p>
                ) : (
                  <div style={styles.rows}>
                    {weeklyWindows.map((window, index) => (
                      <div key={`${window.weekday}-${index}`} style={styles.rowGrid}>
                        <Field label="Día">
                          <select
                            style={styles.input}
                            value={window.weekday}
                            disabled={calendarSaving}
                            onChange={(event) => patchWindow(index, { weekday: Number(event.target.value) })}
                          >
                            {weekdayLabels.map((day, dayIndex) => (
                              <option key={day} value={dayIndex}>{day}</option>
                            ))}
                          </select>
                        </Field>

                        <Field label="Inicio">
                          <input
                            style={styles.input}
                            type="time"
                            value={window.start_time}
                            disabled={calendarSaving}
                            onChange={(event) => patchWindow(index, { start_time: event.target.value })}
                          />
                        </Field>

                        <Field label="Fin">
                          <input
                            style={styles.input}
                            type="time"
                            value={window.end_time}
                            disabled={calendarSaving}
                            onChange={(event) => patchWindow(index, { end_time: event.target.value })}
                          />
                        </Field>

                        <label style={styles.checkField}>
                          <input
                            type="checkbox"
                            checked={window.active !== false && Number(window.active) !== 0}
                            disabled={calendarSaving}
                            onChange={(event) => patchWindow(index, { active: event.target.checked })}
                          />
                          Publicar franja
                        </label>

                        <button
                          type="button"
                          style={styles.dangerBtn}
                          disabled={calendarSaving}
                          onClick={() => setWeeklyWindows((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                        >
                          Quitar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={styles.section}>
                <div style={styles.sectionHead}>
                  <div>
                    <div style={styles.sectionTitle}>Excepciones, bloqueos y horarios extra</div>
                    <span style={styles.help}>Puedes bloquear un día completo, una franja parcial o abrir horarios extraordinarios.</span>
                  </div>

                  <button
                    type="button"
                    style={styles.secondaryBtn}
                    disabled={calendarSaving}
                    onClick={() => setExceptions((current) => [...current, newException()])}
                  >
                    + Agregar excepción
                  </button>
                </div>

                {!exceptions.length ? (
                  <p style={styles.empty}>No hay bloqueos ni horarios extra registrados.</p>
                ) : (
                  <div style={styles.rows}>
                    {exceptions.map((exception, index) => {
                      const isFullBlock = exception.kind === 'blocked_full'

                      return (
                        <div key={`${exception.date}-${index}`} style={styles.exceptionGrid}>
                          <Field label="Fecha">
                            <input
                              style={styles.input}
                              type="date"
                              value={exception.date}
                              disabled={calendarSaving}
                              onChange={(event) => patchException(index, { date: event.target.value })}
                            />
                          </Field>

                          <Field label="Tipo">
                            <select
                              style={styles.input}
                              value={exception.kind}
                              disabled={calendarSaving}
                              onChange={(event) => patchException(index, {
                                kind: event.target.value as AppointmentCalendarException['kind'],
                                start_time: event.target.value === 'blocked_full' ? null : exception.start_time,
                                end_time: event.target.value === 'blocked_full' ? null : exception.end_time,
                              })}
                            >
                              {exceptionKinds.map((kind) => (
                                <option key={kind.value} value={kind.value}>{kind.label}</option>
                              ))}
                            </select>
                          </Field>

                          {!isFullBlock && (
                            <>
                              <Field label="Inicio">
                                <input
                                  style={styles.input}
                                  type="time"
                                  value={exception.start_time ?? ''}
                                  disabled={calendarSaving}
                                  onChange={(event) => patchException(index, { start_time: event.target.value || null })}
                                />
                              </Field>

                              <Field label="Fin">
                                <input
                                  style={styles.input}
                                  type="time"
                                  value={exception.end_time ?? ''}
                                  disabled={calendarSaving}
                                  onChange={(event) => patchException(index, { end_time: event.target.value || null })}
                                />
                              </Field>
                            </>
                          )}

                          <Field label="Cupo máximo opcional">
                            <input
                              style={styles.input}
                              type="number"
                              min={1}
                              value={exception.max_per_slot_override ?? ''}
                              disabled={calendarSaving}
                              onChange={(event) => patchException(index, {
                                max_per_slot_override: numberOrNull(event.target.value),
                              })}
                            />
                          </Field>

                          <Field label="Nota interna">
                            <input
                              style={styles.input}
                              value={exception.note ?? ''}
                              disabled={calendarSaving}
                              onChange={(event) => patchException(index, { note: event.target.value || null })}
                              placeholder="Ej.: Feriado nacional"
                            />
                          </Field>

                          <button
                            type="button"
                            style={styles.dangerBtn}
                            disabled={calendarSaving}
                            onClick={() => setExceptions((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                          >
                            Quitar
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              <div style={styles.section}>
                <div style={styles.sectionHead}>
                  <div>
                    <div style={styles.sectionTitle}>Tipos de cita</div>
                    <span style={styles.help}>
                      La modalidad, duración, cupo, ubicación, enlace privado e indicaciones se configuran por tipo de cita.
                    </span>
                  </div>

                  <button
                    type="button"
                    style={styles.secondaryBtn}
                    disabled={calendarSaving}
                    onClick={() => setAppointmentTypes((current) => [...current, newAppointmentType(current.length)])}
                  >
                    + Agregar tipo
                  </button>
                </div>

                {!appointmentTypes.length ? (
                  <p style={styles.empty}>Aún no hay tipos de cita. La Agenda no será reservable hasta crear al menos uno activo.</p>
                ) : (
                  <div style={styles.typeList}>
                    {appointmentTypes.map((appointmentType, index) => {
                      const mode = appointmentType.delivery_mode ?? 'in_person'

                      return (
                        <article key={`${appointmentType.id ?? 'nuevo'}-${index}`} style={styles.typeCard}>
                          <div style={styles.typeHead}>
                            <strong>Tipo de cita {index + 1}</strong>

                            <label style={styles.checkField}>
                              <input
                                type="checkbox"
                                checked={appointmentType.active !== false && Number(appointmentType.active) !== 0}
                                disabled={calendarSaving}
                                onChange={(event) => patchAppointmentType(index, { active: event.target.checked })}
                              />
                              Activo para reservas
                            </label>
                          </div>

                          <div style={styles.grid}>
                            <Field label="Nombre visible">
                              <input
                                style={styles.input}
                                value={appointmentType.label}
                                disabled={calendarSaving}
                                onChange={(event) => patchAppointmentType(index, { label: event.target.value })}
                                placeholder="Ej.: Visita guiada"
                              />
                            </Field>

                            <Field label="Modalidad">
                              <select
                                style={styles.input}
                                value={mode}
                                disabled={calendarSaving}
                                onChange={(event) => patchAppointmentType(index, {
                                  delivery_mode: event.target.value as DeliveryMode,
                                })}
                              >
                                {deliveryModes.map((item) => (
                                  <option key={item.value} value={item.value}>{item.label}</option>
                                ))}
                              </select>
                            </Field>

                            <Field label="Duración (min) · opcional">
                              <input
                                style={styles.input}
                                type="number"
                                min={5}
                                value={appointmentType.duration_minutes ?? ''}
                                disabled={calendarSaving}
                                onChange={(event) => patchAppointmentType(index, {
                                  duration_minutes: numberOrNull(event.target.value),
                                })}
                              />
                            </Field>

                            <Field label="Margen (min) · opcional">
                              <input
                                style={styles.input}
                                type="number"
                                min={0}
                                value={appointmentType.buffer_minutes ?? ''}
                                disabled={calendarSaving}
                                onChange={(event) => patchAppointmentType(index, {
                                  buffer_minutes: numberOrNull(event.target.value),
                                })}
                              />
                            </Field>

                            <Field label="Cupo por horario · opcional">
                              <input
                                style={styles.input}
                                type="number"
                                min={1}
                                value={appointmentType.max_per_slot ?? ''}
                                disabled={calendarSaving}
                                onChange={(event) => patchAppointmentType(index, {
                                  max_per_slot: numberOrNull(event.target.value),
                                })}
                              />
                            </Field>

                            {mode === 'in_person' && (
                              <Field label="Ubicación / punto de encuentro">
                                <input
                                  style={styles.input}
                                  value={appointmentType.location_text ?? ''}
                                  disabled={calendarSaving}
                                  onChange={(event) => patchAppointmentType(index, {
                                    location_text: event.target.value || null,
                                  })}
                                  placeholder="Ej.: Sala de ventas, Torre A"
                                />
                              </Field>
                            )}

                            {mode === 'video_call' && (
                              <Field label="Enlace de videollamada privado">
                                <input
                                  style={styles.input}
                                  type="url"
                                  value={appointmentType.meeting_url ?? ''}
                                  disabled={calendarSaving}
                                  onChange={(event) => patchAppointmentType(index, {
                                    meeting_url: event.target.value || null,
                                  })}
                                  placeholder="https://meet.google.com/..."
                                />
                              </Field>
                            )}

                            {mode === 'other' && (
                              <Field label="Detalle de modalidad">
                                <input
                                  style={styles.input}
                                  value={appointmentType.location_text ?? ''}
                                  disabled={calendarSaving}
                                  onChange={(event) => patchAppointmentType(index, {
                                    location_text: event.target.value || null,
                                  })}
                                  placeholder="Describe cómo se realiza la cita"
                                />
                              </Field>
                            )}
                          </div>

                          <Field label="Indicaciones para el cliente">
                            <textarea
                              style={{ ...styles.input, minHeight: 72, resize: 'vertical' }}
                              value={appointmentType.customer_instructions ?? ''}
                              disabled={calendarSaving}
                              onChange={(event) => patchAppointmentType(index, {
                                customer_instructions: event.target.value || null,
                              })}
                              placeholder="Ej.: Preséntate 10 minutos antes con tu documento de identidad."
                            />
                          </Field>

                          <div style={styles.typeFoot}>
                            <span style={styles.help}>
                              Los enlaces privados no se exponen en la disponibilidad pública.
                            </span>

                            <button
                              type="button"
                              style={styles.dangerBtn}
                              disabled={calendarSaving}
                              onClick={() => setAppointmentTypes((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                            >
                              Eliminar tipo
                            </button>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                )}
              </div>

              <div style={styles.actions}>
                <button
                  type="button"
                  style={styles.primaryBtn}
                  disabled={calendarSaving}
                  onClick={saveCalendar}
                >
                  {calendarSaving ? 'Guardando Agenda...' : 'Guardar configuración de Agenda'}
                </button>
              </div>

              {calendarMessage && (
                <p style={calendarMessage.includes('guardada') ? styles.success : styles.error}>
                  {calendarMessage}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {tab === 'bookings' && (
        <>
          <div style={styles.filters}>
            <select
              style={styles.input}
              value={view}
              onChange={(event) => setView(event.target.value as BookingView)}
            >
              <option value="day">Día</option>
              <option value="week">Semana</option>
              <option value="list">Lista · 31 días</option>
            </select>

            <input
              style={styles.input}
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />

            <select
              style={styles.input}
              value={status}
              onChange={(event) => setStatus(event.target.value as AppointmentBooking['status'] | '')}
            >
              {statuses.map((item) => (
                <option key={item.value || 'all'} value={item.value}>{item.label}</option>
              ))}
            </select>

            <select
              style={styles.input}
              value={appointmentTypeInput}
              onChange={(event) => setAppointmentTypeInput(event.target.value)}
            >
              <option value="">Todos los tipos de cita</option>
              {bookingTypeOptions.map((item) => (
                <option key={`${item.label}-${item.sort_order ?? 0}`} value={item.label}>
                  {item.label}{item.active === false || Number(item.active) === 0 ? ' · inactivo' : ''}
                </option>
              ))}
            </select>

            <button
              type="button"
              style={styles.secondaryBtn}
              onClick={applyFilters}
              disabled={bookingsLoading}
            >
              Aplicar filtros
            </button>
          </div>

          <p style={styles.help}>
            Consulta acotada: {range.from} a {range.to}, máximo 50 reservas por carga.
          </p>

          {calendarId && availability && (
            <div style={styles.availability}>
              <b>Cupos restantes · {availability.date}</b>
              <span>{availability.timezone}</span>
              <span>
                {availability.slots.length
                  ? `${availability.slots.length} horario(s) disponible(s)`
                  : 'Sin horarios disponibles'}
              </span>
            </div>
          )}

          {error && <p style={styles.error}>{error}</p>}

          {!bookingsLoading && !items.length ? (
            <p style={styles.empty}>No hay citas para los filtros y el rango seleccionados.</p>
          ) : (
            <div style={styles.list}>
              {items.map((item) => (
                <article
                  key={item.id}
                  style={{
                    ...styles.card,
                    ...(focusBookingId === item.id ? styles.cardFocused : {}),
                  }}
                >
                  <div style={styles.cardHead}>
                    <div>
                      <strong>{item.marker_name || 'Ficha vinculada'}</strong>
                      <p style={styles.copy}>
                        {item.marker_reference ? `Referencia: ${item.marker_reference} · ` : ''}
                        {item.appointment_type}
                      </p>
                    </div>

                    <span style={styles.badge}>{statusLabel(item.status)}</span>
                  </div>

                  <div style={styles.meta}>
                    <span>{formatDateTime(item)}</span>
                    <span>{item.calendar_name || calendarDraft?.name || 'Agenda'}</span>
                    {item.customer_name && <span>{item.customer_name} · {item.customer_phone}</span>}
                    {item.customer_email && <span>{item.customer_email}</span>}
                  </div>

                  <div style={styles.actions}>
                    {statusActions.map((action) => (
                      <button
                        key={action.value}
                        type="button"
                        style={styles.secondaryBtn}
                        disabled={savingId === item.id || item.status === action.value}
                        onClick={() => updateStatus(item, action.value)}
                      >
                        {savingId === item.id ? 'Guardando...' : action.label}
                      </button>
                    ))}

                    <button
                      type="button"
                      style={styles.secondaryBtn}
                      disabled={savingId === item.id}
                      onClick={() => startReschedule(item)}
                    >
                      Reprogramar
                    </button>
                  </div>

                  {rescheduleId === item.id && (
                    <div style={styles.reschedule}>
                      <input
                        style={styles.input}
                        type="date"
                        value={rescheduleDate}
                        onChange={(event) => setRescheduleDate(event.target.value)}
                      />

                      <input
                        style={styles.input}
                        type="time"
                        value={rescheduleTime}
                        onChange={(event) => setRescheduleTime(event.target.value)}
                      />

                      <button
                        type="button"
                        style={styles.secondaryBtn}
                        disabled={savingId === item.id}
                        onClick={() => saveReschedule(item)}
                      >
                        {savingId === item.id ? 'Guardando...' : 'Guardar reprogramación'}
                      </button>

                      <button
                        type="button"
                        style={styles.secondaryBtn}
                        disabled={savingId === item.id}
                        onClick={() => setRescheduleId('')}
                      >
                        Cerrar
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}

          {page?.has_more && page.next_cursor && (
            <button
              type="button"
              style={styles.secondaryBtn}
              disabled={loadingMore}
              onClick={() => void loadBookings(page.next_cursor ?? '', true)}
            >
              {loadingMore ? 'Cargando más...' : 'Cargar más reservas'}
            </button>
          )}
        </>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={styles.field}>
      <span style={styles.label}>{label}</span>
      {children}
    </label>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 12 },
  header: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' },
  title: { margin: 0, fontSize: 15, color: '#111827' },
  copy: { margin: 0, fontSize: 12, color: '#6b7280', lineHeight: 1.45 },
  tabs: { display: 'flex', gap: 8, borderBottom: '1px solid #e5e7eb', paddingBottom: 8, flexWrap: 'wrap' },
  tab: { border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', color: '#4b5563', padding: '8px 10px', fontWeight: 800, cursor: 'pointer' },
  tabActive: { background: '#eff6ff', borderColor: '#93c5fd', color: '#1d4ed8' },
  settings: { display: 'flex', flexDirection: 'column', gap: 12 },
  section: { display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#fff' },
  sectionHead: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' },
  sectionTitle: { fontSize: 13, color: '#111827', fontWeight: 900 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 8 },
  rows: { display: 'flex', flexDirection: 'column', gap: 8 },
  rowGrid: { display: 'grid', gridTemplateColumns: 'minmax(130px, 1fr) minmax(100px, .7fr) minmax(100px, .7fr) auto auto', gap: 8, alignItems: 'end', borderTop: '1px solid #f3f4f6', paddingTop: 9 },
  exceptionGrid: { display: 'grid', gridTemplateColumns: 'minmax(130px, .9fr) minmax(180px, 1.2fr) minmax(100px, .65fr) minmax(100px, .65fr) minmax(150px, .9fr) minmax(170px, 1.2fr) auto', gap: 8, alignItems: 'end', borderTop: '1px solid #f3f4f6', paddingTop: 9 },
  typeList: { display: 'flex', flexDirection: 'column', gap: 10 },
  typeCard: { display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid #dbeafe', borderRadius: 10, padding: 11, background: '#fbfdff' },
  typeHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', color: '#1e3a8a', fontSize: 13 },
  typeFoot: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  field: { display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 },
  label: { fontSize: 12, color: '#374151', fontWeight: 800 },
  checkField: { display: 'flex', gap: 6, alignItems: 'center', color: '#374151', fontSize: 12, fontWeight: 700, minHeight: 36 },
  help: { fontSize: 11.5, color: '#6b7280', lineHeight: 1.45 },
  filters: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 },
  input: { border: '1px solid #e5e7eb', borderRadius: 7, padding: '8px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', background: '#fff' },
  availability: { display: 'flex', flexDirection: 'column', gap: 3, border: '1px solid #bfdbfe', borderRadius: 8, background: '#eff6ff', padding: 10, color: '#1e3a8a', fontSize: 12 },
  list: { display: 'flex', flexDirection: 'column', gap: 9 },
  card: { border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 },
  cardFocused: { borderColor: '#4f46e5', boxShadow: '0 0 0 3px rgba(79,70,229,.12)' },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  badge: { borderRadius: 999, background: '#eef2ff', color: '#3730a3', padding: '3px 8px', fontSize: 11, fontWeight: 900 },
  meta: { display: 'flex', flexDirection: 'column', gap: 4, color: '#374151', fontSize: 12.5 },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  reschedule: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, borderTop: '1px solid #f3f4f6', paddingTop: 8 },
  primaryBtn: { border: '1px solid #1d4ed8', borderRadius: 8, background: '#2563eb', color: '#fff', padding: '8px 10px', fontWeight: 800, cursor: 'pointer' },
  secondaryBtn: { border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', color: '#374151', padding: '8px 10px', fontWeight: 700, cursor: 'pointer' },
  dangerBtn: { border: '1px solid #fecaca', borderRadius: 8, background: '#fff', color: '#b91c1c', padding: '8px 10px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' },
  error: { margin: 0, color: '#b91c1c', fontSize: 12, lineHeight: 1.45 },
  success: { margin: 0, color: '#047857', fontSize: 12, lineHeight: 1.45 },
  empty: { margin: 0, padding: 14, border: '1px dashed #d1d5db', borderRadius: 8, color: '#6b7280', fontSize: 13, lineHeight: 1.5 },
}
