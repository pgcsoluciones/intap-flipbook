import { Hono } from 'hono'
import { jwtMiddleware } from '../middleware/jwt'
import type { Env } from '../index'
import type { AuthVariables } from '../middleware/jwt'

type Variables = AuthVariables

const appointmentRoutes = new Hono<{ Bindings: Env; Variables: Variables }>()

const BOOKING_STATUSES = ['pending', 'confirmed', 'cancelled', 'rejected', 'expired'] as const
type BookingRequestBody = {
  name?: unknown
  phone?: unknown
  email?: unknown
  message?: unknown
  appointment_type?: unknown
  preferred_date?: unknown
  preferred_time?: unknown
  timezone?: unknown
  honeypot?: unknown
  source_url?: unknown
}

function cleanBookingText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function cleanBookingEmail(value: unknown): string | null {
  const email = cleanBookingText(value, 160)
  if (!email) return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

function cleanSourceUrl(value: unknown): string | null {
  const raw = cleanBookingText(value, 2000)
  if (!raw) return null
  try {
    const url = new URL(raw)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

function parsePublicJsonObject(value: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function currentMarkerPriceMinor(marker: {
  price_minor: number | null
  promotion_ends_at: string | null
  post_promotion_price_minor: number | null
}) {
  const end = marker.promotion_ends_at ? new Date(marker.promotion_ends_at).getTime() : 0
  if (end && !Number.isNaN(end) && Date.now() >= end && marker.post_promotion_price_minor != null) {
    return marker.post_promotion_price_minor
  }
  return marker.price_minor
}

function normalizeHex(value: unknown) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim().toUpperCase() : ''
}

function publicBookingConfig(actionsJson: string | null) {
  const actions = parsePublicJsonObject(actionsJson)
  const booking = actions.booking && typeof actions.booking === 'object' && !Array.isArray(actions.booking)
    ? actions.booking as Record<string, unknown>
    : {}
  const appointmentTypes = Array.isArray(booking.appointment_types)
    ? booking.appointment_types.map((item) => cleanBookingText(item, 60)).filter(Boolean).slice(0, 12)
    : []
  return {
    enabled: booking.enabled === true,
    label: cleanBookingText(booking.label, 80) || 'Agendar',
    appointment_types: Array.from(new Set(appointmentTypes)),
    require_date: booking.require_date !== false,
    require_time: booking.require_time !== false,
  }
}

function publicBookingTypes(calendarTypes: AppointmentTypeRow[]) {
  const seen = new Set<string>()

  return calendarTypes.reduce<string[]>((labels, item) => {
    if (Number(item.active) !== 1) return labels
    const label = cleanBookingText(item.label, 60)
    const key = label.toLocaleLowerCase('es-DO')
    if (!label || seen.has(key)) return labels
    seen.add(key)
    labels.push(label)
    return labels
  }, [])
}

function cleanPreferredDate(value: unknown, required: boolean) {
  const date = cleanBookingText(value, 20)
  if (!date) {
    if (required) throw new Error('Fecha preferida es requerida')
    return null
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Fecha preferida inválida')
  const today = new Date().toISOString().slice(0, 10)
  if (date < today) throw new Error('La fecha preferida debe ser futura')
  return date
}

function cleanPreferredTime(value: unknown, required: boolean) {
  const time = cleanBookingText(value, 10)
  if (!time) {
    if (required) throw new Error('Hora preferida es requerida')
    return null
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Hora preferida inválida')
  return time
}

function cleanInt(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value)
  if (!Number.isInteger(number)) return fallback
  return Math.max(min, Math.min(max, number))
}

function cleanPublicCatalogBool(value: unknown): boolean | null {
  if (value === undefined || value === null || value === '') return null
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error('has_booking debe ser true o false')
}

function cleanPublicCatalogCursor(value: unknown) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return { updatedAt: '', id: '' }

  const separator = raw.lastIndexOf('|')
  const updatedAt = raw.slice(0, separator)
  const id = raw.slice(separator + 1)
  const valid = (
    separator > 0
    && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(updatedAt)
    && /^[A-Za-z0-9-]{1,120}$/.test(id)
  )

  if (!valid) throw new Error('Cursor de fichas dinamicas invalido')
  return { updatedAt, id }
}

function cleanPublicCatalogMoneyMinor(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new Error(`${field} debe ser decimal`)
  const raw = value.trim()
  if (!raw) return null
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new Error(`${field} debe ser decimal positivo`)
  const amount = Number(raw)
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`${field} debe ser mayor o igual a 0`)
  return Math.round(amount * 100)
}

function cleanDateValue(value: unknown) {
  const date = cleanBookingText(value, 20)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ''
}

function cleanTimeValue(value: unknown) {
  const time = cleanBookingText(value, 10)
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : ''
}

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function timeFromMinutes(value: number) {
  const normalized = ((value % 1440) + 1440) % 1440
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

function addMinutesIso(iso: string, minutes: number) {
  return new Date(new Date(iso).getTime() + minutes * 60000).toISOString()
}

function partsInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date())
    return true
  } catch {
    return false
  }
}

function cleanTimezone(value: unknown) {
  const timezone = cleanBookingText(value, 80) || 'America/Santo_Domingo'
  if (!isValidTimezone(timezone)) throw new Error('Zona horaria inválida')
  return timezone
}

function localDateTimeToUtc(localDate: string, localTime: string, timezone: string) {
  const [year, month, day] = localDate.split('-').map(Number)
  const [hour, minute] = localTime.split(':').map(Number)
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0)
  for (let i = 0; i < 3; i += 1) {
    const parts = partsInTimezone(new Date(utc), timezone)
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    const target = Date.UTC(year, month - 1, day, hour, minute, 0)
    utc += target - asUtc
  }
  return new Date(utc).toISOString()
}

function localToday(timezone: string) {
  const parts = partsInTimezone(new Date(), timezone)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function addDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function weekdayFromDate(dateValue: string) {
  return new Date(`${dateValue}T00:00:00Z`).getUTCDay()
}

type CalendarRow = {
  id: string
  user_id: string
  name: string
  timezone: string
  slot_interval_minutes: number
  default_duration_minutes: number
  default_buffer_minutes: number
  max_per_slot: number
  max_per_day: number
  min_notice_minutes: number
  booking_horizon_days: number
  hold_expires_after_minutes: number
}

type AppointmentTypeRow = {
  id: string
  label: string
  delivery_mode: 'in_person' | 'video_call' | 'phone_call' | 'other'
  location_text: string | null
  meeting_url: string | null
  customer_instructions: string | null
  duration_minutes: number | null
  buffer_minutes: number | null
  max_per_slot: number | null
  active: number
  sort_order: number
}

type WindowRow = {
  weekday: number
  start_time: string
  end_time: string
  active: number
}

type ExceptionRow = {
  date: string
  kind: 'blocked_full' | 'blocked_partial' | 'extra'
  start_time: string | null
  end_time: string | null
  max_per_slot_override: number | null
  note: string | null
}

async function loadCalendarBundle(db: D1Database, calendarId: string) {
  const calendar = await db.prepare('SELECT * FROM appointment_calendars WHERE id = ?')
    .bind(calendarId)
    .first<CalendarRow>()
  if (!calendar) return null
  const [{ results: windows }, { results: exceptions }, { results: types }] = await Promise.all([
    db.prepare('SELECT weekday, start_time, end_time, active FROM appointment_calendar_weekly_windows WHERE calendar_id = ? AND active = 1 ORDER BY weekday, sort_order')
      .bind(calendarId)
      .all<WindowRow>(),
    db.prepare('SELECT date, kind, start_time, end_time, max_per_slot_override, note FROM appointment_calendar_exceptions WHERE calendar_id = ? ORDER BY date, start_time')
      .bind(calendarId)
      .all<ExceptionRow>(),
    db.prepare('SELECT id, label, delivery_mode, location_text, meeting_url, customer_instructions, duration_minutes, buffer_minutes, max_per_slot, active, sort_order FROM appointment_calendar_types WHERE calendar_id = ? ORDER BY sort_order, label')
      .bind(calendarId)
      .all<AppointmentTypeRow>(),
  ])
  return {
    calendar,
    windows: windows ?? [],
    exceptions: exceptions ?? [],
    types: types ?? [],
  }
}

function windowsForDate(date: string, windows: WindowRow[], exceptions: ExceptionRow[]) {
  const dateExceptions = exceptions.filter((item) => item.date === date)
  if (dateExceptions.some((item) => item.kind === 'blocked_full')) return []
  const base = windows
    .filter((item) => item.weekday === weekdayFromDate(date) && item.active === 1)
    .map((item) => ({ start_time: item.start_time, end_time: item.end_time }))
  const extra = dateExceptions
    .filter((item) => item.kind === 'extra' && item.start_time && item.end_time)
    .map((item) => ({ start_time: item.start_time!, end_time: item.end_time! }))
  const blocked = dateExceptions.filter((item) => item.kind === 'blocked_partial' && item.start_time && item.end_time)
  const ranges = [...base, ...extra]
    .map((window) => ({ start: minutesFromTime(window.start_time), end: minutesFromTime(window.end_time) }))
    .filter((window) => window.end > window.start)

  const blockedRanges = blocked
    .map((block) => ({ start: minutesFromTime(block.start_time!), end: minutesFromTime(block.end_time!) }))
    .filter((block) => block.end > block.start)

  return ranges.flatMap((window) => {
    let fragments = [window]
    blockedRanges.forEach((block) => {
      fragments = fragments.flatMap((fragment) => {
        if (fragment.start >= block.end || fragment.end <= block.start) return [fragment]
        const next = []
        if (fragment.start < block.start) next.push({ start: fragment.start, end: block.start })
        if (fragment.end > block.end) next.push({ start: block.end, end: fragment.end })
        return next
      })
    })
    return fragments
  }).map((window) => ({ start_time: timeFromMinutes(window.start), end_time: timeFromMinutes(window.end) }))
}

function capacityForSlot(date: string, slotStartMinute: number, slotEndMinute: number, exceptions: ExceptionRow[], fallback: number) {
  return exceptions
    .filter((item) => {
      if (item.date !== date || item.max_per_slot_override == null) return false
      if (!item.start_time || !item.end_time) return true
      const start = minutesFromTime(item.start_time)
      const end = minutesFromTime(item.end_time)
      return slotStartMinute < end && slotEndMinute > start
    })
    .reduce((current, item) => {
      const override = Number(item.max_per_slot_override)
      if (!Number.isFinite(override) || override < 1) return current
      return Math.min(current, override)
    }, fallback)
}

async function countActiveAllocations(db: D1Database, calendarId: string, slotStartsUtc: string[], excludeBookingId?: string) {
  if (!slotStartsUtc.length) return new Map<string, number>()
  const placeholders = slotStartsUtc.map(() => '?').join(',')
  const nowIso = new Date().toISOString()
  const excludeClause = excludeBookingId ? 'AND a.booking_id != ?' : ''
  const binds = excludeBookingId
    ? [calendarId, ...slotStartsUtc, nowIso, excludeBookingId]
    : [calendarId, ...slotStartsUtc, nowIso]
  const { results } = await db.prepare(
    `SELECT a.slot_start_utc, COUNT(*) AS count
     FROM appointment_slot_allocations a
     JOIN appointment_calendar_bookings b ON b.id = a.booking_id
     WHERE a.calendar_id = ?
       AND a.slot_start_utc IN (${placeholders})
       AND b.status IN ('pending', 'confirmed')
       AND (b.status != 'pending' OR b.hold_expires_at IS NULL OR b.hold_expires_at > ?)
       ${excludeClause}
     GROUP BY a.slot_start_utc`,
  ).bind(...binds).all<{ slot_start_utc: string; count: number }>()
  return new Map((results ?? []).map((row) => [row.slot_start_utc, Number(row.count) || 0]))
}

async function countActiveBookingsForDay(db: D1Database, calendarId: string, date: string, excludeBookingId?: string) {
  const nowIso = new Date().toISOString()
  const excludeClause = excludeBookingId ? 'AND id != ?' : ''
  const binds = excludeBookingId ? [calendarId, date, nowIso, excludeBookingId] : [calendarId, date, nowIso]
  const row = await db.prepare(
    `SELECT COUNT(*) AS count
     FROM appointment_calendar_bookings
     WHERE calendar_id = ?
       AND local_date = ?
       AND status IN ('pending', 'confirmed')
       AND (status != 'pending' OR hold_expires_at IS NULL OR hold_expires_at > ?)
       ${excludeClause}`,
  ).bind(...binds).first<{ count: number }>()
  return Number(row?.count) || 0
}

async function expirePendingBookings(db: D1Database, calendarId: string) {
  const nowIso = new Date().toISOString()
  await db.batch([
    db.prepare(
      `UPDATE appointment_calendar_bookings
       SET status = 'expired', updated_at = datetime('now')
       WHERE calendar_id = ?
         AND status = 'pending'
         AND hold_expires_at IS NOT NULL
         AND hold_expires_at <= ?`,
    ).bind(calendarId, nowIso),
    db.prepare(
      `DELETE FROM appointment_slot_allocations
       WHERE calendar_id = ?
         AND booking_id IN (
           SELECT id
           FROM appointment_calendar_bookings
           WHERE calendar_id = ?
             AND status = 'expired'
         )`,
    ).bind(calendarId, calendarId),
  ])
}

async function loadDailyBookingCounts(db: D1Database, calendarId: string, fromDate: string, days: number) {
  const nowIso = new Date().toISOString()
  const toDate = addDays(fromDate, days)
  const { results } = await db.prepare(
    `SELECT local_date, COUNT(*) AS count
     FROM appointment_calendar_bookings
     WHERE calendar_id = ?
       AND local_date >= ?
       AND local_date < ?
       AND status IN ('pending', 'confirmed')
       AND (status != 'pending' OR hold_expires_at IS NULL OR hold_expires_at > ?)
     GROUP BY local_date`,
  ).bind(calendarId, fromDate, toDate, nowIso).all<{ local_date: string; count: number }>()
  return new Map((results ?? []).map((row) => [row.local_date, Number(row.count) || 0]))
}

function slotsForDuration(startIso: string, durationMinutes: number, intervalMinutes: number) {
  const count = Math.max(1, Math.ceil(durationMinutes / intervalMinutes))
  return Array.from({ length: count }, (_, index) => addMinutesIso(startIso, index * intervalMinutes))
}

async function availableSlotsForDate(
  db: D1Database,
  bundle: NonNullable<Awaited<ReturnType<typeof loadCalendarBundle>>>,
  date: string,
  typeLabel?: string,
  excludeBookingId?: string,
) {
  const { calendar, windows, exceptions, types } = bundle
  const today = localToday(calendar.timezone)
  if (date < today || date > addDays(today, calendar.booking_horizon_days)) return []
  const dailyCount = await countActiveBookingsForDay(db, calendar.id, date, excludeBookingId)
  if (dailyCount >= calendar.max_per_day) return []
  const activeTypes = types.filter((item) => Number(item.active) === 1)
  const type = typeLabel
    ? activeTypes.find((item) => item.label === typeLabel)
    : activeTypes[0]

  if (!type) return []

  const duration = (type.duration_minutes ?? calendar.default_duration_minutes) + (type.buffer_minutes ?? calendar.default_buffer_minutes)
  const capacity = type.max_per_slot ?? calendar.max_per_slot
  const minStart = new Date(Date.now() + calendar.min_notice_minutes * 60000).toISOString()
  const windowsToday = windowsForDate(date, windows, exceptions)
  const candidateSlots: Array<{ time: string; startMinute: number; startIso: string; slotStarts: string[] }> = []
  windowsToday.forEach((window) => {
    const start = minutesFromTime(window.start_time)
    const end = minutesFromTime(window.end_time)
    for (let minute = start; minute + duration <= end; minute += calendar.slot_interval_minutes) {
      const time = timeFromMinutes(minute)
      const startIso = localDateTimeToUtc(date, time, calendar.timezone)
      if (startIso <= minStart) continue
      candidateSlots.push({ time, startMinute: minute, startIso, slotStarts: slotsForDuration(startIso, duration, calendar.slot_interval_minutes) })
    }
  })
  const counts = await countActiveAllocations(db, calendar.id, Array.from(new Set(candidateSlots.flatMap((slot) => slot.slotStarts))), excludeBookingId)
  return candidateSlots
    .filter((slot) => slot.slotStarts.every((slotStart, index) => {
      const slotMinute = slot.startMinute + index * calendar.slot_interval_minutes
      const effectiveCapacity = capacityForSlot(date, slotMinute, slotMinute + calendar.slot_interval_minutes, exceptions, capacity)
      return (counts.get(slotStart) ?? 0) < effectiveCapacity
    }))
    .map((slot) => ({ time: slot.time, label: slot.time, starts_at_utc: slot.startIso }))
}

type RangeSlotPlan = {
  calendar: CalendarRow
  exceptions: ExceptionRow[]
  capacity: number
  candidateSlots: Array<{
    time: string
    startMinute: number
    startIso: string
    slotStarts: string[]
  }>
}

async function loadActiveAllocationCountsForRange(
  db: D1Database,
  calendarId: string,
  fromDate: string,
  days: number,
) {
  const nowIso = new Date().toISOString()
  const toDate = addDays(fromDate, days)

  const { results } = await db.prepare(
    `SELECT a.slot_start_utc, COUNT(*) AS count
     FROM appointment_slot_allocations a
     JOIN appointment_calendar_bookings b ON b.id = a.booking_id
     WHERE a.calendar_id = ?
       AND b.local_date >= ?
       AND b.local_date < ?
       AND b.status IN ('pending', 'confirmed')
       AND (b.status != 'pending' OR b.hold_expires_at IS NULL OR b.hold_expires_at > ?)
     GROUP BY a.slot_start_utc`,
  ).bind(calendarId, fromDate, toDate, nowIso).all<{ slot_start_utc: string; count: number }>()

  return new Map((results ?? []).map((row) => [
    row.slot_start_utc,
    Number(row.count) || 0,
  ]))
}

function slotPlanForDate(
  bundle: NonNullable<Awaited<ReturnType<typeof loadCalendarBundle>>>,
  date: string,
  typeLabel?: string,
): RangeSlotPlan | null {
  const { calendar, windows, exceptions, types } = bundle
  const today = localToday(calendar.timezone)

  if (date < today || date > addDays(today, calendar.booking_horizon_days)) {
    return null
  }

  const type = typeLabel ? types.find((item) => item.label === typeLabel) : types[0]
  if (!type) return null

  const duration = (type.duration_minutes ?? calendar.default_duration_minutes) +
    (type.buffer_minutes ?? calendar.default_buffer_minutes)

  const capacity = type.max_per_slot ?? calendar.max_per_slot
  const minStart = new Date(
    Date.now() + calendar.min_notice_minutes * 60000,
  ).toISOString()

  const candidateSlots: RangeSlotPlan['candidateSlots'] = []

  windowsForDate(date, windows, exceptions).forEach((window) => {
    const start = minutesFromTime(window.start_time)
    const end = minutesFromTime(window.end_time)

    for (
      let minute = start;
      minute + duration <= end;
      minute += calendar.slot_interval_minutes
    ) {
      const time = timeFromMinutes(minute)
      const startIso = localDateTimeToUtc(date, time, calendar.timezone)

      if (startIso <= minStart) continue

      candidateSlots.push({
        time,
        startMinute: minute,
        startIso,
        slotStarts: slotsForDuration(
          startIso,
          duration,
          calendar.slot_interval_minutes,
        ),
      })
    }
  })

  return { calendar, exceptions, capacity, candidateSlots }
}

function slotsFromRangePlan(
  plan: RangeSlotPlan | null,
  date: string,
  dailyCount: number,
  allocationCounts: Map<string, number>,
) {
  if (!plan || dailyCount >= plan.calendar.max_per_day) return []

  return plan.candidateSlots
    .filter((slot) => slot.slotStarts.every((slotStart, index) => {
      const slotMinute = slot.startMinute +
        index * plan.calendar.slot_interval_minutes

      const effectiveCapacity = capacityForSlot(
        date,
        slotMinute,
        slotMinute + plan.calendar.slot_interval_minutes,
        plan.exceptions,
        plan.capacity,
      )

      return (allocationCounts.get(slotStart) ?? 0) < effectiveCapacity
    }))
    .map((slot) => ({
      time: slot.time,
      label: slot.time,
      starts_at_utc: slot.startIso,
    }))
}


async function resolvePublicBookingMarker(db: D1Database, slug: string, markerId: string) {
  return db.prepare(
    `SELECT dm.id, dm.publication_id, dm.user_id AS user_id, dm.name, dm.reference,
            dm.price_minor, dm.currency, dm.promotion_ends_at, dm.post_promotion_price_minor,
            dm.actions_json, dm.booking_calendar_id,
            p.title AS publication_title, p.public_slug
     FROM dynamic_markers dm
     JOIN publications p ON p.id = dm.publication_id
     JOIN pages pg ON pg.id = dm.page_id AND pg.publication_id = p.id
     WHERE p.public_slug = ?
       AND p.status = 'published'
       AND p.deleted_at IS NULL
       AND dm.id = ?
       AND dm.status = 'active'
     LIMIT 1`,
  )
    .bind(slug, markerId)
    .first<{
      id: string
      publication_id: string
      user_id: string
      name: string | null
      reference: string | null
      price_minor: number | null
      currency: string | null
      promotion_ends_at: string | null
      post_promotion_price_minor: number | null
      actions_json: string | null
      booking_calendar_id: string | null
      publication_title: string
      public_slug: string
    }>()
}


appointmentRoutes.get('/view/:slug/markers/:markerId/booking/availability', async (c) => {
  const slug = c.req.param('slug')
  const markerId = c.req.param('markerId')

  const marker = await resolvePublicBookingMarker(c.env.DB, slug, markerId)
  if (!marker) return c.json({ success: false, error: 'Ficha no disponible' }, 404)

  const booking = publicBookingConfig(marker.actions_json)
  if (!booking.enabled) {
    return c.json({ success: false, error: 'Agenda no disponible para esta ficha' }, 404)
  }

  if (!marker.booking_calendar_id) {
    return c.json({ success: false, error: 'Agenda no configurada' }, 404)
  }

  const bundle = await loadCalendarBundle(c.env.DB, marker.booking_calendar_id)
  if (!bundle || bundle.calendar.user_id !== marker.user_id) {
    return c.json({ success: false, error: 'Agenda no disponible' }, 404)
  }

  const safeTypes = publicBookingTypes(bundle.types)
  const appointmentTypeDetails = bundle.types
    .filter((item) => Number(item.active) === 1 && safeTypes.includes(item.label))
    .map((item) => ({
      label: item.label,
      delivery_mode: item.delivery_mode,
      location_text: item.location_text || null,
      customer_instructions: item.customer_instructions || null,
    }))

  const requestedType = cleanBookingText(c.req.query('appointment_type'), 80)
  const selectedType = requestedType && safeTypes.includes(requestedType)
    ? requestedType
    : ''

  const today = localToday(bundle.calendar.timezone)
  const requestedFrom = cleanDateValue(c.req.query('from'))
  const rangeFrom = requestedFrom && requestedFrom >= today ? requestedFrom : today
  const rangeDays = cleanInt(c.req.query('days'), 31, 1, 31)
  const rangeEnd = addDays(rangeFrom, rangeDays)
  const requestedDate = cleanDateValue(c.req.query('date'))

  const days: Array<{ date: string; available: true }> = []
  let dailyCounts = new Map<string, number>()
  let allocationCounts = new Map<string, number>()

  if (selectedType) {
    const [countsByDay, countsBySlot] = await Promise.all([
      loadDailyBookingCounts(
        c.env.DB,
        bundle.calendar.id,
        rangeFrom,
        rangeDays,
      ),
      loadActiveAllocationCountsForRange(
        c.env.DB,
        bundle.calendar.id,
        rangeFrom,
        rangeDays,
      ),
    ])

    dailyCounts = countsByDay
    allocationCounts = countsBySlot

    for (let offset = 0; offset < rangeDays; offset += 1) {
      const date = addDays(rangeFrom, offset)
      const plan = slotPlanForDate(bundle, date, selectedType)

      if (
        slotsFromRangePlan(
          plan,
          date,
          dailyCounts.get(date) ?? 0,
          allocationCounts,
        ).length
      ) {
        days.push({ date, available: true })
      }
    }
  }

  let slots: Array<{ time: string; label: string; starts_at_utc: string }> = []

  if (selectedType && requestedDate) {
    if (requestedDate >= rangeFrom && requestedDate < rangeEnd) {
      slots = slotsFromRangePlan(
        slotPlanForDate(bundle, requestedDate, selectedType),
        requestedDate,
        dailyCounts.get(requestedDate) ?? 0,
        allocationCounts,
      )
    } else {
      slots = await availableSlotsForDate(
        c.env.DB,
        bundle,
        requestedDate,
        selectedType,
      )
    }
  }

  return c.json({
    success: true,
    data: {
      timezone: bundle.calendar.timezone,
      range: { from: rangeFrom, days: rangeDays },
      days,
      selected_date: requestedDate || '',
      slots: slots.map((slot) => ({ time: slot.time, label: slot.label })),
      appointment_types: safeTypes,
      appointment_type_details: appointmentTypeDetails,
      selected_type: selectedType,
    },
  })
})

appointmentRoutes.post('/view/:slug/markers/:markerId/booking', async (c) => {
  const slug = c.req.param('slug')
  const markerId = c.req.param('markerId')
  const body = await c.req.json<BookingRequestBody>().catch(() => ({} as BookingRequestBody))

  if (cleanBookingText(body.honeypot, 80)) return c.json({ success: true, data: { accepted: true } }, 201)

  const name = cleanBookingText(body.name, 120)
  const phone = cleanBookingText(body.phone, 40)
  const email = cleanBookingEmail(body.email)
  const message = cleanBookingText(body.message, 1000)
  const sourceUrl = cleanSourceUrl(body.source_url)

  if (name.length < 2) return c.json({ success: false, error: 'Nombre completo es requerido' }, 400)
  if (!/^[0-9+\-()\s]{7,40}$/.test(phone)) return c.json({ success: false, error: 'WhatsApp es requerido' }, 400)
  if (email === '') return c.json({ success: false, error: 'Correo inválido' }, 400)

  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'
  const rateKey = `booking:${markerId}:${await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip)).then((buf) => Array.from(new Uint8Array(buf)).slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join(''))}`
  const existing = await c.env.SESSIONS.get(rateKey)
  if (existing) return c.json({ success: false, error: 'Espera un momento antes de enviar otra solicitud' }, 429)

  const marker = await resolvePublicBookingMarker(c.env.DB, slug, markerId)
  if (!marker) return c.json({ success: false, error: 'Ficha no disponible' }, 404)
  const booking = publicBookingConfig(marker.actions_json)
  if (!booking.enabled) return c.json({ success: false, error: 'Agenda no disponible para esta ficha' }, 404)
  if (!marker.booking_calendar_id) return c.json({ success: false, error: 'Agenda no configurada' }, 404)
  const bundle = await loadCalendarBundle(c.env.DB, marker.booking_calendar_id)
  if (!bundle || bundle.calendar.user_id !== marker.user_id) return c.json({ success: false, error: 'Agenda no disponible' }, 404)

  const appointmentType = cleanBookingText(body.appointment_type, 60)
  const safeTypes = publicBookingTypes(bundle.types)
  if (!appointmentType || !safeTypes.includes(appointmentType)) {
    return c.json({ success: false, error: 'Selecciona un tipo de cita válido' }, 400)
  }

  let preferredDate: string
  let preferredTime: string
  try {
    const cleanDate = cleanPreferredDate(body.preferred_date, true)
    const cleanTime = cleanPreferredTime(body.preferred_time, true)
    if (!cleanDate || !cleanTime) throw new Error('Fecha y hora son requeridas')
    preferredDate = cleanDate
    preferredTime = cleanTime
  } catch (error) {
    return c.json({ success: false, error: error instanceof Error ? error.message : 'Datos de cita inválidos' }, 400)
  }

  await expirePendingBookings(c.env.DB, bundle.calendar.id)

  const available = await availableSlotsForDate(c.env.DB, bundle, preferredDate, appointmentType)
  const selectedSlot = available.find((slot) => slot.time === preferredTime)
  if (!selectedSlot) return c.json({ success: false, error: 'Ese horario ya no está disponible' }, 409)

  const appointmentTypeConfig = bundle.types.find((type) => type.label === appointmentType) ?? bundle.types[0]
  const deliveryModeSnapshot = appointmentTypeConfig.delivery_mode
  const locationSnapshot = appointmentTypeConfig.location_text || null
  const customerInstructionsSnapshot = appointmentTypeConfig.customer_instructions || null
  const duration = appointmentTypeConfig.duration_minutes ?? bundle.calendar.default_duration_minutes
  const buffer = appointmentTypeConfig.buffer_minutes ?? bundle.calendar.default_buffer_minutes
  const occupiedStarts = slotsForDuration(selectedSlot.starts_at_utc, duration + buffer, bundle.calendar.slot_interval_minutes)
  const baseCapacity = appointmentTypeConfig.max_per_slot ?? bundle.calendar.max_per_slot
  const selectedMinute = minutesFromTime(preferredTime)
  const capacity = occupiedStarts.reduce((current, _slotStart, index) => {
    const slotMinute = selectedMinute + index * bundle.calendar.slot_interval_minutes
    return Math.min(current, capacityForSlot(preferredDate, slotMinute, slotMinute + bundle.calendar.slot_interval_minutes, bundle.exceptions, baseCapacity))
  }, baseCapacity)
  const placeholders = occupiedStarts.map(() => '?').join(',')
  const { results: usedRows } = await c.env.DB.prepare(
    `SELECT slot_start_utc, capacity_unit
     FROM appointment_slot_allocations a
     JOIN appointment_calendar_bookings b ON b.id = a.booking_id
     WHERE a.calendar_id = ?
       AND a.slot_start_utc IN (${placeholders})
       AND b.status IN ('pending', 'confirmed')
       AND (b.status != 'pending' OR b.hold_expires_at IS NULL OR b.hold_expires_at > ?)`,
  ).bind(bundle.calendar.id, ...occupiedStarts, new Date().toISOString()).all<{ slot_start_utc: string; capacity_unit: number }>()
  const usedBySlot = new Map<string, Set<number>>()
  ;(usedRows ?? []).forEach((row) => {
    if (!usedBySlot.has(row.slot_start_utc)) usedBySlot.set(row.slot_start_utc, new Set())
    usedBySlot.get(row.slot_start_utc)!.add(Number(row.capacity_unit))
  })
  let capacityUnit = 0
  for (let unit = 1; unit <= capacity; unit += 1) {
    if (occupiedStarts.every((slotStart) => !usedBySlot.get(slotStart)?.has(unit))) {
      capacityUnit = unit
      break
    }
  }
  if (!capacityUnit) return c.json({ success: false, error: 'Ese horario ya no está disponible' }, 409)

  const now = new Date().toISOString()
  const bookingId = crypto.randomUUID()
  const leadId = crypto.randomUUID()
  const priceMinorUnit = currentMarkerPriceMinor(marker)
  const holdExpiresAt = addMinutesIso(now, bundle.calendar.hold_expires_after_minutes)
  const endsAtUtc = addMinutesIso(selectedSlot.starts_at_utc, duration)
  const snapshot = {
    marker_id: marker.id,
    name: marker.name,
    reference: marker.reference,
    price_minor: priceMinorUnit,
    price_minor_unit: priceMinorUnit,
    currency: marker.currency,
    publication_id: marker.publication_id,
    publication_title: marker.publication_title,
    public_slug: marker.public_slug,
    source_url: sourceUrl,
    appointment_type: appointmentType,
    preferred_date: preferredDate,
    preferred_time: preferredTime,
    timezone: bundle.calendar.timezone,
    delivery_mode: deliveryModeSnapshot,
    location_text: locationSnapshot,
    customer_instructions: customerInstructionsSnapshot,
    booking_id: bookingId,
    starts_at_utc: selectedSlot.starts_at_utc,
    ends_at_utc: endsAtUtc,
    status: 'pending',
    captured_at: now,
  }
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO appointment_calendar_bookings (
          id, user_id, publication_id, marker_id, calendar_id, appointment_type,
          starts_at_utc, ends_at_utc, local_date, local_time, timezone,
          delivery_mode_snapshot, location_snapshot, customer_instructions_snapshot,
          status, hold_expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      ).bind(
        bookingId,
        marker.user_id,
        marker.publication_id,
        marker.id,
        bundle.calendar.id,
        appointmentType,
        selectedSlot.starts_at_utc,
        endsAtUtc,
        preferredDate,
        preferredTime,
        bundle.calendar.timezone,
        deliveryModeSnapshot,
        locationSnapshot,
        customerInstructionsSnapshot,
        holdExpiresAt,
      ),
      c.env.DB.prepare(
        `INSERT INTO lead_intakes (
          id, tenant_id, publication_id, marker_id, request_type, status,
          customer_name, customer_phone, customer_email, customer_message,
          marker_snapshot_json, selection_json, source_url, booking_id
        ) VALUES (?, ?, ?, ?, 'booking', 'new', ?, ?, ?, ?, ?, NULL, ?, ?)`,
      ).bind(
        leadId,
        marker.user_id,
        marker.publication_id,
        marker.id,
        name,
        phone,
        email,
        message || null,
        JSON.stringify(snapshot),
        sourceUrl,
        bookingId,
      ),
      ...occupiedStarts.map((slotStart) => c.env.DB.prepare(
        `INSERT INTO appointment_slot_allocations
         (id, booking_id, calendar_id, slot_start_utc, capacity_unit, status)
         VALUES (?, ?, ?, ?, ?, 'pending')`,
      ).bind(crypto.randomUUID(), bookingId, bundle.calendar.id, slotStart, capacityUnit)),
    ])
  } catch {
    return c.json({ success: false, error: 'Ese horario ya no está disponible' }, 409)
  }
  await c.env.SESSIONS.put(rateKey, '1', { expirationTtl: 60 })

  return c.json({ success: true, data: { id: bookingId, booking_id: bookingId, message: 'Tu cita fue recibida. El vendedor confirmará disponibilidad contigo.' } }, 201)
})


appointmentRoutes.use('/api/*', jwtMiddleware)

function cleanCalendarBody(body: Record<string, unknown>) {
  return {
    name: cleanBookingText(body.name, 160) || 'Agenda',
    timezone: cleanTimezone(body.timezone),
    slot_interval_minutes: cleanInt(body.slot_interval_minutes, 30, 5, 240),
    default_duration_minutes: cleanInt(body.default_duration_minutes, 60, 5, 1440),
    default_buffer_minutes: cleanInt(body.default_buffer_minutes, 0, 0, 1440),
    max_per_slot: cleanInt(body.max_per_slot, 1, 1, 999),
    max_per_day: cleanInt(body.max_per_day, 8, 1, 999),
    min_notice_minutes: cleanInt(body.min_notice_minutes, 120, 0, 525600),
    booking_horizon_days: cleanInt(body.booking_horizon_days, 30, 1, 730),
    hold_expires_after_minutes: cleanInt(body.hold_expires_after_minutes, 30, 1, 10080),
  }
}

function cleanWindows(value: unknown) {
  const seen = new Set<string>()
  const rows = (Array.isArray(value) ? value : []).map((item) => {
    const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {}
    const weekday = cleanInt(row.weekday, -1, -1, 6)
    const start = cleanTimeValue(row.start_time)
    const end = cleanTimeValue(row.end_time)

    if (weekday < 0 || !start || !end || minutesFromTime(end) <= minutesFromTime(start)) {
      throw new Error('Cada franja debe tener día, hora de inicio y hora de fin válidos.')
    }

    const key = `${weekday}|${start}|${end}`
    if (seen.has(key)) {
      throw new Error('No se puede repetir la misma franja en un mismo día.')
    }
    seen.add(key)

    return {
      weekday,
      start_time: start,
      end_time: end,
      active: row.active === false ? 0 : 1,
    }
  }) as Array<{ weekday: number; start_time: string; end_time: string; active: number }>

  const normalized: Array<{ weekday: number; start_time: string; end_time: string; active: number; sort_order: number }> = []

  for (let weekday = 0; weekday <= 6; weekday += 1) {
    const group = rows
      .filter((row) => row.weekday === weekday)
      .sort((a, b) => minutesFromTime(a.start_time) - minutesFromTime(b.start_time))

    for (let index = 1; index < group.length; index += 1) {
      const previous = group[index - 1]
      const current = group[index]

      if (minutesFromTime(current.start_time) < minutesFromTime(previous.end_time)) {
        throw new Error(
          `Hay franjas solapadas el ${['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][weekday]}: ${previous.start_time}–${previous.end_time} y ${current.start_time}–${current.end_time}.`,
        )
      }
    }

    group.forEach((row) => {
      normalized.push({
        ...row,
        sort_order: normalized.length,
      })
    })
  }

  return normalized
}

function cleanExceptions(value: unknown) {
  const kinds = new Set(['blocked_full', 'blocked_partial', 'extra'])
  return (Array.isArray(value) ? value : []).map((item) => {
    const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {}
    const date = cleanDateValue(row.date)
    const kind = cleanBookingText(row.kind, 30)
    const start = cleanTimeValue(row.start_time)
    const end = cleanTimeValue(row.end_time)
    if (!date || !kinds.has(kind)) return null
    if (kind !== 'blocked_full' && (!start || !end || minutesFromTime(end) <= minutesFromTime(start))) return null
    return {
      date,
      kind,
      start_time: kind === 'blocked_full' ? null : start,
      end_time: kind === 'blocked_full' ? null : end,
      max_per_slot_override: row.max_per_slot_override == null ? null : cleanInt(row.max_per_slot_override, 1, 1, 999),
      note: cleanBookingText(row.note, 300) || null,
    }
  }).filter(Boolean) as Array<{ date: string; kind: string; start_time: string | null; end_time: string | null; max_per_slot_override: number | null; note: string | null }>
}

function cleanAppointmentDeliveryMode(value: unknown): AppointmentTypeRow['delivery_mode'] {
  const mode = cleanBookingText(value, 30)
  if (mode === 'video_call' || mode === 'phone_call' || mode === 'other') return mode
  return 'in_person'
}

function cleanAppointmentTypes(value: unknown) {
  const seen = new Set<string>()
  const rows = (Array.isArray(value) ? value : []).map((item) => {
    const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {}
    const label = cleanBookingText(row.label, 80)
    const key = label.toLocaleLowerCase('es-DO')
    if (!label || seen.has(key)) return null
    seen.add(key)

    return {
      label,
      delivery_mode: cleanAppointmentDeliveryMode(row.delivery_mode),
      location_text: cleanBookingText(row.location_text, 240) || null,
      meeting_url: cleanBookingText(row.meeting_url, 1000) || null,
      customer_instructions: cleanBookingText(row.customer_instructions, 2000) || null,
      duration_minutes: row.duration_minutes == null ? null : cleanInt(row.duration_minutes, 60, 5, 1440),
      buffer_minutes: row.buffer_minutes == null ? null : cleanInt(row.buffer_minutes, 0, 0, 1440),
      max_per_slot: row.max_per_slot == null ? null : cleanInt(row.max_per_slot, 1, 1, 999),
      active: row.active === false ? 0 : 1,
      sort_order: 0,
    }
  }).filter(Boolean) as Array<{
    label: string
    delivery_mode: AppointmentTypeRow['delivery_mode']
    location_text: string | null
    meeting_url: string | null
    customer_instructions: string | null
    duration_minutes: number | null
    buffer_minutes: number | null
    max_per_slot: number | null
    active: number
    sort_order: number
  }>

  rows.forEach((row, index) => { row.sort_order = index })
  return rows
}

async function ownedCalendar(db: D1Database, calendarId: string, userId: string) {
  return db.prepare('SELECT * FROM appointment_calendars WHERE id = ? AND user_id = ?')
    .bind(calendarId, userId)
    .first<CalendarRow>()
}

appointmentRoutes.get('/api/appointment-calendars', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const publicationId = cleanBookingText(c.req.query('publication_id'), 80)
  const query = cleanBookingText(c.req.query('q'), 80)
  const scope = c.req.query('scope') === 'tenant' ? 'tenant' : 'publication'
  const limit = cleanInt(c.req.query('limit'), 12, 1, 50)
  const rawCursor = cleanBookingText(c.req.query('cursor'), 240)

  if (scope === 'publication' && !publicationId) {
    return c.json({
      success: true,
      data: [],
      page: { limit, has_more: false, next_cursor: null },
    })
  }

  let cursorUpdatedAt = ''
  let cursorId = ''

  if (rawCursor) {
    const separator = rawCursor.lastIndexOf('|')
    cursorUpdatedAt = rawCursor.slice(0, separator)
    cursorId = rawCursor.slice(separator + 1)

    const validCursor = (
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(cursorUpdatedAt)
      && /^[A-Za-z0-9-]{1,120}$/.test(cursorId)
    )

    if (separator <= 0 || !validCursor) {
      return c.json({ success: false, error: 'Cursor de Agenda inválido.' }, 400)
    }
  }

  const binds: unknown[] = [userId]
  const filters = ['c.user_id = ?']

  if (scope === 'publication') {
    filters.push('dm.publication_id = ?')
    binds.push(publicationId)
  }

  if (query) {
    const like = `%${query}%`
    filters.push(`(
      LOWER(c.name) LIKE LOWER(?)
      OR LOWER(COALESCE(dm.name, '')) LIKE LOWER(?)
      OR LOWER(COALESCE(dm.reference, '')) LIKE LOWER(?)
      OR LOWER(COALESCE(p.title, '')) LIKE LOWER(?)
    )`)
    binds.push(like, like, like, like)
  }

  if (cursorUpdatedAt) {
    filters.push('(c.updated_at < ? OR (c.updated_at = ? AND c.id < ?))')
    binds.push(cursorUpdatedAt, cursorUpdatedAt, cursorId)
  }

  const { results } = await c.env.DB.prepare(
    `SELECT
       c.*,
       COUNT(DISTINCT dm.id) AS marker_count,
       CASE WHEN EXISTS (
         SELECT 1
         FROM appointment_calendar_weekly_windows ww
         WHERE ww.calendar_id = c.id AND ww.active = 1
       ) THEN 1 ELSE 0 END AS has_active_windows,
       CASE WHEN EXISTS (
         SELECT 1
         FROM appointment_calendar_types ct
         WHERE ct.calendar_id = c.id AND ct.active = 1
       ) THEN 1 ELSE 0 END AS has_active_types
     FROM appointment_calendars c
     LEFT JOIN dynamic_markers dm ON dm.booking_calendar_id = c.id
     LEFT JOIN publications p ON p.id = dm.publication_id
     WHERE ${filters.join(' AND ')}
     GROUP BY c.id
     ORDER BY c.updated_at DESC, c.id DESC
     LIMIT ?`,
  ).bind(...binds, limit + 1).all()

  const rows = (results ?? []) as Array<{ id: string; updated_at: string }>
  const hasMore = rows.length > limit
  const data = rows.slice(0, limit)
  const last = data[data.length - 1]

  return c.json({
    success: true,
    data,
    page: {
      limit,
      has_more: hasMore,
      next_cursor: hasMore && last ? `${last.updated_at}|${last.id}` : null,
    },
  })
})

appointmentRoutes.post('/api/appointment-calendars', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))

  if (cleanBookingText(body.marker_id, 80)) {
    return c.json({
      success: false,
      error: 'Las Agendas se crean desde el módulo Agenda. Vincúlala desde Data Dinámica después de crearla.',
    }, 400)
  }

  let calendar: ReturnType<typeof cleanCalendarBody>
  let windows: ReturnType<typeof cleanWindows>
  let exceptions: ReturnType<typeof cleanExceptions>
  let types: ReturnType<typeof cleanAppointmentTypes>

  try {
    calendar = cleanCalendarBody(body)
    windows = cleanWindows(body.weekly_windows)
    exceptions = cleanExceptions(body.exceptions)
    types = cleanAppointmentTypes(body.appointment_types)
  } catch (error: any) {
    return c.json({ success: false, error: error.message || 'Configuración de Agenda inválida.' }, 400)
  }

  const id = crypto.randomUUID()

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO appointment_calendars (
        id, user_id, name, timezone, slot_interval_minutes, default_duration_minutes,
        default_buffer_minutes, max_per_slot, max_per_day, min_notice_minutes,
        booking_horizon_days, hold_expires_after_minutes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      userId,
      calendar.name,
      calendar.timezone,
      calendar.slot_interval_minutes,
      calendar.default_duration_minutes,
      calendar.default_buffer_minutes,
      calendar.max_per_slot,
      calendar.max_per_day,
      calendar.min_notice_minutes,
      calendar.booking_horizon_days,
      calendar.hold_expires_after_minutes,
    ),
    ...windows.map((window) => c.env.DB.prepare(
      `INSERT INTO appointment_calendar_weekly_windows
       (id, calendar_id, weekday, start_time, end_time, active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      id,
      window.weekday,
      window.start_time,
      window.end_time,
      window.active,
      window.sort_order,
    )),
    ...exceptions.map((exception) => c.env.DB.prepare(
      `INSERT INTO appointment_calendar_exceptions
       (id, calendar_id, date, kind, start_time, end_time, max_per_slot_override, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      id,
      exception.date,
      exception.kind,
      exception.start_time,
      exception.end_time,
      exception.max_per_slot_override,
      exception.note,
    )),
    ...types.map((type) => c.env.DB.prepare(
      `INSERT INTO appointment_calendar_types
       (id, calendar_id, label, delivery_mode, location_text, meeting_url, customer_instructions,
        duration_minutes, buffer_minutes, max_per_slot, active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      id,
      type.label,
      type.delivery_mode,
      type.location_text,
      type.meeting_url,
      type.customer_instructions,
      type.duration_minutes,
      type.buffer_minutes,
      type.max_per_slot,
      type.active,
      type.sort_order,
    )),
  ])

  const created = await c.env.DB.prepare(
    'SELECT * FROM appointment_calendars WHERE id = ?',
  ).bind(id).first()

  return c.json({ success: true, data: created }, 201)
})

appointmentRoutes.get('/api/appointment-calendars/:id', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const calendar = await ownedCalendar(c.env.DB, c.req.param('id'), userId)
  if (!calendar) return c.json({ success: false, error: 'Agenda no encontrada' }, 404)
  const bundle = await loadCalendarBundle(c.env.DB, calendar.id)
  return c.json({ success: true, data: bundle })
})

appointmentRoutes.put('/api/appointment-calendars/:id', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const calendarId = c.req.param('id')
  const existing = await ownedCalendar(c.env.DB, calendarId, userId)
  if (!existing) return c.json({ success: false, error: 'Agenda no encontrada' }, 404)
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
  let calendar: ReturnType<typeof cleanCalendarBody>
  let windows: ReturnType<typeof cleanWindows>
  let exceptions: ReturnType<typeof cleanExceptions>
  let types: ReturnType<typeof cleanAppointmentTypes>

  try {
    calendar = cleanCalendarBody(body)
    windows = cleanWindows(body.weekly_windows)
    exceptions = cleanExceptions(body.exceptions)
    types = cleanAppointmentTypes(body.appointment_types)
  } catch (error: any) {
    return c.json({ success: false, error: error.message || 'Configuración de Agenda inválida.' }, 400)
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE appointment_calendars
       SET name = ?, timezone = ?, slot_interval_minutes = ?, default_duration_minutes = ?,
           default_buffer_minutes = ?, max_per_slot = ?, max_per_day = ?, min_notice_minutes = ?,
           booking_horizon_days = ?, hold_expires_after_minutes = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    ).bind(calendar.name, calendar.timezone, calendar.slot_interval_minutes, calendar.default_duration_minutes, calendar.default_buffer_minutes, calendar.max_per_slot, calendar.max_per_day, calendar.min_notice_minutes, calendar.booking_horizon_days, calendar.hold_expires_after_minutes, calendarId, userId),
    c.env.DB.prepare('DELETE FROM appointment_calendar_weekly_windows WHERE calendar_id = ?').bind(calendarId),
    c.env.DB.prepare('DELETE FROM appointment_calendar_exceptions WHERE calendar_id = ?').bind(calendarId),
    c.env.DB.prepare('DELETE FROM appointment_calendar_types WHERE calendar_id = ?').bind(calendarId),
    ...windows.map((window) => c.env.DB.prepare(
      `INSERT INTO appointment_calendar_weekly_windows
       (id, calendar_id, weekday, start_time, end_time, active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), calendarId, window.weekday, window.start_time, window.end_time, window.active, window.sort_order)),
    ...exceptions.map((exception) => c.env.DB.prepare(
      `INSERT INTO appointment_calendar_exceptions
       (id, calendar_id, date, kind, start_time, end_time, max_per_slot_override, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), calendarId, exception.date, exception.kind, exception.start_time, exception.end_time, exception.max_per_slot_override, exception.note)),
    ...types.map((type) => c.env.DB.prepare(
      `INSERT INTO appointment_calendar_types
       (id, calendar_id, label, delivery_mode, location_text, meeting_url, customer_instructions,
        duration_minutes, buffer_minutes, max_per_slot, active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      calendarId,
      type.label,
      type.delivery_mode,
      type.location_text,
      type.meeting_url,
      type.customer_instructions,
      type.duration_minutes,
      type.buffer_minutes,
      type.max_per_slot,
      type.active,
      type.sort_order,
    )),
  ])
  const bundle = await loadCalendarBundle(c.env.DB, calendarId)
  return c.json({ success: true, data: bundle })
})

appointmentRoutes.get('/api/appointment-calendars/:id/availability', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const calendar = await ownedCalendar(c.env.DB, c.req.param('id'), userId)
  if (!calendar) return c.json({ success: false, error: 'Agenda no encontrada' }, 404)
  const bundle = await loadCalendarBundle(c.env.DB, calendar.id)
  if (!bundle) return c.json({ success: false, error: 'Agenda no encontrada' }, 404)
  const date = cleanDateValue(c.req.query('date')) || localToday(bundle.calendar.timezone)
  const type = cleanBookingText(c.req.query('appointment_type'), 80) || undefined
  const slots = await availableSlotsForDate(c.env.DB, bundle, date, type)
  return c.json({ success: true, data: { timezone: bundle.calendar.timezone, date, slots } })
})

appointmentRoutes.get('/api/appointments', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const calendarId = cleanBookingText(c.req.query('calendar_id'), 80)
  const publicationId = cleanBookingText(c.req.query('publication_id'), 80)
  const markerId = cleanBookingText(c.req.query('marker_id'), 80)
  const status = cleanBookingText(c.req.query('status'), 30)
  const type = cleanBookingText(c.req.query('appointment_type'), 80)

  const rawFrom = c.req.query('from') || ''
  const rawTo = c.req.query('to') || ''
  const from = cleanDateValue(rawFrom) || new Date().toISOString().slice(0, 10)
  const to = cleanDateValue(rawTo) || addDays(from, 31)

  if ((rawFrom && !cleanDateValue(rawFrom)) || (rawTo && !cleanDateValue(rawTo))) {
    return c.json({ success: false, error: 'Rango de fechas inválido' }, 400)
  }

  if (to <= from || to > addDays(from, 31)) {
    return c.json({
      success: false,
      error: 'El rango debe ser mayor que cero y no superar 31 días.',
    }, 400)
  }

  const limit = cleanInt(c.req.query('limit'), 100, 1, 100)
  const rawCursor = cleanBookingText(c.req.query('cursor'), 240)
  const [cursorAt = '', cursorId = ''] = rawCursor.split('|', 2)

  const hasCursor = Boolean(
    cursorAt &&
    cursorId &&
    !Number.isNaN(Date.parse(cursorAt)) &&
    /^[A-Za-z0-9-]{1,120}$/.test(cursorId),
  )

  const binds: unknown[] = [userId, from, to]
  const filters = [
    'b.user_id = ?',
    'b.local_date >= ?',
    'b.local_date < ?',
  ]

  if (calendarId) {
    filters.push('b.calendar_id = ?')
    binds.push(calendarId)
  }

  if (publicationId) {
    filters.push('b.publication_id = ?')
    binds.push(publicationId)
  }

  if (markerId) {
    filters.push('b.marker_id = ?')
    binds.push(markerId)
  }

  if ((BOOKING_STATUSES as readonly string[]).includes(status)) {
    filters.push('b.status = ?')
    binds.push(status)
  }

  if (type) {
    filters.push('b.appointment_type = ?')
    binds.push(type)
  }

  if (hasCursor) {
    filters.push('(b.starts_at_utc > ? OR (b.starts_at_utc = ? AND b.id > ?))')
    binds.push(cursorAt, cursorAt, cursorId)
  }

  const { results } = await c.env.DB.prepare(
    `SELECT b.*, c.name AS calendar_name, dm.name AS marker_name, dm.reference AS marker_reference
     FROM appointment_calendar_bookings b
     JOIN appointment_calendars c ON c.id = b.calendar_id
     LEFT JOIN dynamic_markers dm ON dm.id = b.marker_id
     WHERE ${filters.join(' AND ')}
     ORDER BY b.starts_at_utc ASC, b.id ASC
     LIMIT ?`,
  ).bind(...binds, limit + 1).all()

  const rows = results ?? []
  const hasMore = rows.length > limit
  const data = hasMore ? rows.slice(0, limit) : rows
  const last = data[data.length - 1] as {
    starts_at_utc?: string
    id?: string
  } | undefined

  return c.json({
    success: true,
    data,
    page: {
      from,
      to,
      limit,
      has_more: hasMore,
      next_cursor: hasMore && last?.starts_at_utc && last?.id
        ? `${last.starts_at_utc}|${last.id}`
        : null,
    },
  })
})

appointmentRoutes.patch('/api/appointments/:id/status', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const id = c.req.param('id')
  const body = await c.req.json<{ status?: unknown }>().catch(() => ({} as { status?: unknown }))
  const status = typeof body.status === 'string' && ['confirmed', 'cancelled', 'rejected'].includes(body.status)
    ? body.status
    : ''

  if (!status) {
    return c.json({ success: false, error: 'Solo puedes confirmar, cancelar o rechazar una cita' }, 400)
  }

  const current = await c.env.DB.prepare(
    'SELECT id, calendar_id, status, hold_expires_at FROM appointment_calendar_bookings WHERE id = ? AND user_id = ?',
  ).bind(id, userId).first<{ id: string; calendar_id: string; status: string; hold_expires_at: string | null }>()

  if (!current) return c.json({ success: false, error: 'Cita no encontrada' }, 404)

  await expirePendingBookings(c.env.DB, current.calendar_id)

  const fresh = await c.env.DB.prepare(
    'SELECT id, status, hold_expires_at FROM appointment_calendar_bookings WHERE id = ? AND user_id = ?',
  ).bind(id, userId).first<{ id: string; status: string; hold_expires_at: string | null }>()

  if (!fresh) return c.json({ success: false, error: 'Cita no encontrada' }, 404)

  if (['cancelled', 'rejected', 'expired'].includes(fresh.status)) {
    return c.json({ success: false, error: 'La cita ya está cerrada y no puede modificarse' }, 409)
  }

  if (fresh.status === 'confirmed' && status !== 'confirmed' && status !== 'cancelled') {
    return c.json({ success: false, error: 'Una cita confirmada solo puede cancelarse' }, 409)
  }

  if (status === 'confirmed' && fresh.status === 'pending' && fresh.hold_expires_at && fresh.hold_expires_at <= new Date().toISOString()) {
    return c.json({ success: false, error: 'La cita pendiente expiró y ya no puede confirmarse' }, 409)
  }

  const releasesCapacity = status === 'cancelled' || status === 'rejected'

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE appointment_calendar_bookings
       SET status = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    ).bind(status, id, userId),

    ...(status === 'confirmed'
      ? [c.env.DB.prepare(
          "UPDATE appointment_slot_allocations SET status = 'confirmed' WHERE booking_id = ?",
        ).bind(id)]
      : []),

    ...(releasesCapacity
      ? [c.env.DB.prepare(
          'DELETE FROM appointment_slot_allocations WHERE booking_id = ?',
        ).bind(id)]
      : []),
  ])

  const updated = await c.env.DB.prepare(
    'SELECT * FROM appointment_calendar_bookings WHERE id = ?',
  ).bind(id).first()

  return c.json({ success: true, data: updated })
})

appointmentRoutes.patch('/api/appointments/:id/reschedule', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const id = c.req.param('id')
  const body = await c.req.json<{ local_date?: unknown; local_time?: unknown; appointment_type?: unknown }>().catch(() => ({} as { local_date?: unknown; local_time?: unknown; appointment_type?: unknown }))
  const current = await c.env.DB.prepare(
    `SELECT b.*
     FROM appointment_calendar_bookings b
     JOIN appointment_calendars c ON c.id = b.calendar_id
     WHERE b.id = ? AND b.user_id = ? AND c.user_id = ?`,
  ).bind(id, userId, userId).first<{
    id: string
    calendar_id: string
    appointment_type: string
    status: string
    hold_expires_at: string | null
  }>()
  if (!current) return c.json({ success: false, error: 'Cita no encontrada' }, 404)
  if (!['pending', 'confirmed'].includes(current.status)) {
    return c.json({ success: false, error: 'Solo se pueden reprogramar citas pendientes o confirmadas' }, 400)
  }
  if (current.status === 'pending' && current.hold_expires_at && current.hold_expires_at <= new Date().toISOString()) {
    return c.json({ success: false, error: 'Esta cita pendiente ya expiró' }, 409)
  }
  await expirePendingBookings(c.env.DB, current.calendar_id)

  const bundle = await loadCalendarBundle(c.env.DB, current.calendar_id)
  if (!bundle || bundle.calendar.user_id !== userId) return c.json({ success: false, error: 'Agenda no encontrada' }, 404)
  const localDate = cleanDateValue(body.local_date)
  const localTime = cleanTimeValue(body.local_time)
  const appointmentType = cleanBookingText(body.appointment_type, 80) || current.appointment_type
  if (!localDate || !localTime) return c.json({ success: false, error: 'Fecha y hora son requeridas' }, 400)
  const appointmentTypeConfig = bundle.types.find((type) => type.label === appointmentType)
  if (!appointmentTypeConfig) return c.json({ success: false, error: 'Tipo de cita inválido' }, 400)

  const slots = await availableSlotsForDate(c.env.DB, bundle, localDate, appointmentType, id)
  const selectedSlot = slots.find((slot) => slot.time === localTime)
  if (!selectedSlot) return c.json({ success: false, error: 'Ese horario no está disponible' }, 409)

  const duration = appointmentTypeConfig.duration_minutes ?? bundle.calendar.default_duration_minutes
  const buffer = appointmentTypeConfig.buffer_minutes ?? bundle.calendar.default_buffer_minutes
  const occupiedStarts = slotsForDuration(selectedSlot.starts_at_utc, duration + buffer, bundle.calendar.slot_interval_minutes)
  const baseCapacity = appointmentTypeConfig.max_per_slot ?? bundle.calendar.max_per_slot
  const selectedMinute = minutesFromTime(localTime)
  const capacity = occupiedStarts.reduce((current, _slotStart, index) => {
    const slotMinute = selectedMinute + index * bundle.calendar.slot_interval_minutes
    return Math.min(current, capacityForSlot(localDate, slotMinute, slotMinute + bundle.calendar.slot_interval_minutes, bundle.exceptions, baseCapacity))
  }, baseCapacity)
  const placeholders = occupiedStarts.map(() => '?').join(',')
  const { results: usedRows } = await c.env.DB.prepare(
    `SELECT slot_start_utc, capacity_unit
     FROM appointment_slot_allocations a
     JOIN appointment_calendar_bookings b ON b.id = a.booking_id
     WHERE a.calendar_id = ?
       AND a.booking_id != ?
       AND a.slot_start_utc IN (${placeholders})
       AND b.status IN ('pending', 'confirmed')
       AND (b.status != 'pending' OR b.hold_expires_at IS NULL OR b.hold_expires_at > ?)`,
  ).bind(bundle.calendar.id, id, ...occupiedStarts, new Date().toISOString()).all<{ slot_start_utc: string; capacity_unit: number }>()
  const usedBySlot = new Map<string, Set<number>>()
  ;(usedRows ?? []).forEach((row) => {
    if (!usedBySlot.has(row.slot_start_utc)) usedBySlot.set(row.slot_start_utc, new Set())
    usedBySlot.get(row.slot_start_utc)!.add(Number(row.capacity_unit))
  })
  let capacityUnit = 0
  for (let unit = 1; unit <= capacity; unit += 1) {
    if (occupiedStarts.every((slotStart) => !usedBySlot.get(slotStart)?.has(unit))) {
      capacityUnit = unit
      break
    }
  }
  if (!capacityUnit) return c.json({ success: false, error: 'Ese horario no está disponible' }, 409)

  const endsAtUtc = addMinutesIso(selectedSlot.starts_at_utc, duration)
  const nextHoldExpiresAt = current.status === 'pending'
    ? addMinutesIso(new Date().toISOString(), bundle.calendar.hold_expires_after_minutes)
    : current.hold_expires_at
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE appointment_calendar_bookings
       SET appointment_type = ?, starts_at_utc = ?, ends_at_utc = ?, local_date = ?,
           local_time = ?, timezone = ?, hold_expires_at = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    ).bind(appointmentType, selectedSlot.starts_at_utc, endsAtUtc, localDate, localTime, bundle.calendar.timezone, nextHoldExpiresAt, id, userId),
    c.env.DB.prepare('DELETE FROM appointment_slot_allocations WHERE booking_id = ?').bind(id),
    ...occupiedStarts.map((slotStart) => c.env.DB.prepare(
      `INSERT INTO appointment_slot_allocations
       (id, booking_id, calendar_id, slot_start_utc, capacity_unit, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), id, bundle.calendar.id, slotStart, capacityUnit, current.status === 'confirmed' ? 'confirmed' : 'pending')),
  ])
  const updated = await c.env.DB.prepare('SELECT * FROM appointment_calendar_bookings WHERE id = ?').bind(id).first()
  return c.json({ success: true, data: updated })
})


export default appointmentRoutes
