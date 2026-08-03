import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { AppointmentCalendar, DynamicMarker, DynamicMarkerStatus } from '../lib/api'
import {
  DYNAMIC_MARKER_LINKED_LOAD_ERROR,
  getDynamicMarkerActionMarkerId,
  resolveDynamicMarkerLinkedSelection,
  shouldCreateDirectDynamicMarker,
} from '../lib/dynamicMarkerLinkedSelection'
import FileField from './FileField'

type Props = {
  publicationId?: string
  pageId?: string
  selectedObject: any | null
  targetKind?: string | null
  ensureElementId: () => string | null
  openImageBank?: (onSelect: (url: string, thumbnailUrl?: string) => void) => void
}

type Visibility = 'public' | 'internal'
type CustomFieldType = 'text' | 'number' | 'boolean' | 'date' | 'url' | 'email' | 'phone'
type MediaType = 'image' | 'video' | 'audio'

type CustomField = {
  id: string
  label: string
  value: string
  type: CustomFieldType
  visibility: Visibility
  searchable: boolean
  filterable: boolean
  sort_order?: number
}

type ColorOption = {
  id: string
  name: string
  hex: string
  available: boolean
  sort_order?: number
}

type AvailableOption = {
  id: string
  name: string
  available: boolean
  sort_order?: number
}

type SizeOption = {
  id: string
  label: string
  value: string
  available: boolean
  sort_order?: number
}

type MeasurementOption = {
  id: string
  label: string
  value: string
  unit: string
  sort_order?: number
}

type MediaOption = {
  id: string
  type: MediaType
  url: string
  thumbnail_url: string
  title: string
  alt: string
  sort_order: number
  visibility: Visibility
}

type DynamicMarkerActions = {
  contact_whatsapp?: {
    enabled: boolean
    phone: string
    label?: string
    message_template: string
  }
  whatsapp?: {
    enabled: boolean
    phone: string
    label?: string
    message_template: string
  }
  booking?: {
    enabled: boolean
    label?: string
    appointment_types?: string[]
    require_date?: boolean
    require_time?: boolean
  }
  external_link?: {
    enabled: boolean
    label: string
    url: string
  }
  share?: {
    enabled?: boolean
    label?: string
    whatsapp: boolean
    facebook: boolean
    x: boolean
    copy_link: boolean
    native: boolean
    instagram_url?: string
  }
  offer_cta?: {
    target: '' | 'contact_whatsapp' | 'external_link' | 'share'
    preset?: string
    custom_label?: string
  }
}

type FormState = {
  name: string
  reference: string
  category: string
  description: string
  price: string
  previousPrice: string
  currency: string
  availability: string
  promotionText: string
  accentColor: string
  badgeText: string
  promotionEndsAt: string
  postPromotionPrice: string
  colors: ColorOption[]
  materials: AvailableOption[]
  sizes: SizeOption[]
  measurements: MeasurementOption[]
  media: MediaOption[]
  actions: DynamicMarkerActions
  customFields: CustomField[]
  bookingCalendarId: string
}

const emptyForm: FormState = {
  name: '',
  reference: '',
  category: '',
  description: '',
  price: '',
  previousPrice: '',
  currency: '',
  availability: '',
  promotionText: '',
  accentColor: '#F59E0B',
  badgeText: '',
  promotionEndsAt: '',
  postPromotionPrice: '',
  colors: [],
  materials: [],
  sizes: [],
  measurements: [],
  media: [],
  actions: emptyActions(),
  customFields: [],
  bookingCalendarId: '',
}

const currencyOptions = ['', 'DOP', 'USD', 'EUR', 'CAD', 'MXN', 'COP']
const availabilityOptions = [
  '',
  'Disponible',
  'Agotado',
  'Por encargo',
  'Próximamente',
  'Consultar disponibilidad',
]
const visibilityOptions: Visibility[] = ['public', 'internal']
const customFieldTypes: CustomFieldType[] = ['text', 'number', 'boolean', 'date', 'url', 'email', 'phone']
const customFieldTypeLabels: Record<CustomFieldType, string> = {
  text: 'Texto',
  number: 'Número',
  boolean: 'Sí/No',
  date: 'Fecha',
  url: 'Enlace',
  email: 'Correo electrónico',
  phone: 'Teléfono',
}
const offerCtaOptions: Array<{ value: NonNullable<DynamicMarkerActions['offer_cta']>['target']; label: string }> = [
  { value: '', label: 'Sin CTA destacado' },
  { value: 'contact_whatsapp', label: 'WhatsApp / Contactar vendedor' },
]
const offerCtaPresets = ['La quiero ahora', 'Me interesa', 'La aprovecharé', 'Quiero esta oferta', 'Deseo más información']
const mediaTypes: MediaType[] = ['image', 'video', 'audio']
const mediaUploadConfig: Record<MediaType, { label: string; accept: string; hint: string }> = {
  image: {
    label: 'Examinar imagen',
    accept: 'image/jpeg,image/png,image/webp,image/gif,image/svg+xml',
    hint: 'JPG, PNG, WEBP, GIF o SVG',
  },
  video: {
    label: 'Examinar video',
    accept: 'video/mp4,video/webm,video/quicktime',
    hint: 'MP4, WEBM o MOV',
  },
  audio: {
    label: 'Examinar audio',
    accept: 'audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/m4a,audio/ogg',
    hint: 'MP3, WAV, M4A u OGG',
  },
}

 function localId() {
  return crypto.randomUUID()
}

function emptyActions(): DynamicMarkerActions {
  return {
    contact_whatsapp: { enabled: false, phone: '', label: 'Contactar vendedor', message_template: '' },
    booking: { enabled: false, label: 'Agendar', appointment_types: [], require_date: true, require_time: true },
    external_link: { enabled: false, label: 'Ver más', url: '' },
    share: { enabled: false, label: 'Compartir', whatsapp: true, facebook: true, x: false, copy_link: true, native: true, instagram_url: '' },
    offer_cta: { target: '', preset: 'La quiero ahora', custom_label: '' },
  }
}

function statusLabel(status: DynamicMarkerStatus) {
  if (status === 'active') return 'Activa'
  if (status === 'inactive') return 'Inactiva'
  return 'Borrador'
}

function statusStyle(status: DynamicMarkerStatus): React.CSSProperties {
  if (status === 'active') return { background: '#ecfdf5', color: '#047857', borderColor: '#a7f3d0' }
  if (status === 'inactive') return { background: '#f3f4f6', color: '#4b5563', borderColor: '#e5e7eb' }
  return { background: '#fffbeb', color: '#92400e', borderColor: '#fde68a' }
}

function minorToInput(value: number | null) {
  if (value == null) return ''
  return (value / 100).toFixed(2).replace(/\.00$/, '')
}

function inputToMinor(value: string, field: string): number | null {
  const raw = value.trim().replace(',', '.')
  if (!raw) return null
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new Error(`${field} debe ser un importe valido`)
  return Math.round(Number(raw) * 100)
}

function normalizeCurrency(value: string | null) {
  const normalized = (value ?? '').trim().toUpperCase()
  return currencyOptions.includes(normalized) ? normalized : ''
}

function normalizeAccentColor(value: string | null | undefined) {
  const raw = (value ?? '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toUpperCase() : '#F59E0B'
}

function isoToLocalDateTimeInput(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function localDateTimeInputToIso(value: string) {
  const raw = value.trim()
  if (!raw) return null
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) throw new Error('Fin de oferta debe ser una fecha valida')
  return date.toISOString()
}

function normalizeAvailability(value: string | null) {
  const raw = (value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()

  const map: Record<string, string> = {
    DISPONIBLE: 'Disponible',
    AGOTADO: 'Agotado',
    'POR ENCARGO': 'Por encargo',
    PROXIMAMENTE: 'Próximamente',
    'CONSULTAR DISPONIBILIDAD': 'Consultar disponibilidad',
  }

  return map[raw] ?? ''
}

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

function normalizeVisibility(value: unknown): Visibility {
  return value === 'internal' ? 'internal' : 'public'
}

function normalizeCustomFieldType(value: unknown): CustomFieldType {
  return customFieldTypes.includes(value as CustomFieldType) ? value as CustomFieldType : 'text'
}

function normalizeMediaType(value: unknown): MediaType {
  return mediaTypes.includes(value as MediaType) ? value as MediaType : 'image'
}

function parseCustomFields(value: string): CustomField[] {
  return parseJsonArray(value)
    .filter((field) => (
      field &&
      typeof field === 'object' &&
      typeof (field as Record<string, unknown>).label === 'string' &&
      typeof (field as Record<string, unknown>).value === 'string'
    ))
    .map((field) => {
      const item = field as Record<string, unknown>
      return {
        id: typeof item.id === 'string' && item.id ? item.id : localId(),
        label: item.label as string,
        value: item.value as string,
        type: normalizeCustomFieldType(item.type),
        visibility: normalizeVisibility(item.visibility),
        searchable: typeof item.searchable === 'boolean' ? item.searchable : false,
        filterable: typeof item.filterable === 'boolean' ? item.filterable : false,
        sort_order: typeof item.sort_order === 'number' ? item.sort_order : undefined,
      }
    })
}

function parseColors(value: string): ColorOption[] {
  return parseJsonArray(value)
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const color = item as Record<string, unknown>
      const hex = typeof color.hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(color.hex) ? color.hex : '#111827'
      return {
        id: typeof color.id === 'string' && color.id ? color.id : localId(),
        name: typeof color.name === 'string' ? color.name : '',
        hex,
        available: typeof color.available === 'boolean' ? color.available : true,
        sort_order: typeof color.sort_order === 'number' ? color.sort_order : undefined,
      }
    })
}

function parseAvailableOptions(value: string): AvailableOption[] {
  return parseJsonArray(value)
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const option = item as Record<string, unknown>
      return {
        id: typeof option.id === 'string' && option.id ? option.id : localId(),
        name: typeof option.name === 'string' ? option.name : '',
        available: typeof option.available === 'boolean' ? option.available : true,
        sort_order: typeof option.sort_order === 'number' ? option.sort_order : undefined,
      }
    })
}

function parseSizes(value: string): SizeOption[] {
  return parseJsonArray(value)
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const option = item as Record<string, unknown>
      return {
        id: typeof option.id === 'string' && option.id ? option.id : localId(),
        label: typeof option.label === 'string' ? option.label : '',
        value: typeof option.value === 'string' ? option.value : '',
        available: typeof option.available === 'boolean' ? option.available : true,
        sort_order: typeof option.sort_order === 'number' ? option.sort_order : undefined,
      }
    })
}

function parseMeasurements(value: string): MeasurementOption[] {
  return parseJsonArray(value)
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const option = item as Record<string, unknown>
      return {
        id: typeof option.id === 'string' && option.id ? option.id : localId(),
        label: typeof option.label === 'string' ? option.label : '',
        value: typeof option.value === 'string' ? option.value : '',
        unit: typeof option.unit === 'string' ? option.unit : '',
        sort_order: typeof option.sort_order === 'number' ? option.sort_order : undefined,
      }
    })
}

function parseMedia(value: string): MediaOption[] {
  return parseJsonArray(value)
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const option = item as Record<string, unknown>
      return {
        id: typeof option.id === 'string' && option.id ? option.id : localId(),
        type: normalizeMediaType(option.type),
        url: typeof option.url === 'string' ? option.url : '',
        thumbnail_url: typeof option.thumbnail_url === 'string' ? option.thumbnail_url : '',
        title: typeof option.title === 'string' ? option.title : '',
        alt: typeof option.alt === 'string' ? option.alt : '',
        sort_order: typeof option.sort_order === 'number' ? option.sort_order : 0,
        visibility: normalizeVisibility(option.visibility),
      }
    })
}

function parseActions(value: string): DynamicMarkerActions {
  const parsed = parseJsonObject(value)
  const defaults = emptyActions()
  const contactWhatsApp = parsed.contact_whatsapp && typeof parsed.contact_whatsapp === 'object' && !Array.isArray(parsed.contact_whatsapp)
    ? parsed.contact_whatsapp as Record<string, unknown>
    : parsed.whatsapp && typeof parsed.whatsapp === 'object' && !Array.isArray(parsed.whatsapp)
      ? parsed.whatsapp as Record<string, unknown>
    : {}
  const booking = parsed.booking && typeof parsed.booking === 'object' && !Array.isArray(parsed.booking)
    ? parsed.booking as Record<string, unknown>
    : {}
  const externalLink = parsed.external_link && typeof parsed.external_link === 'object' && !Array.isArray(parsed.external_link)
    ? parsed.external_link as Record<string, unknown>
    : {}
  const share = parsed.share && typeof parsed.share === 'object' && !Array.isArray(parsed.share)
    ? parsed.share as Record<string, unknown>
    : {}
  const offerCta = parsed.offer_cta && typeof parsed.offer_cta === 'object' && !Array.isArray(parsed.offer_cta)
    ? parsed.offer_cta as Record<string, unknown>
    : {}

  return {
    contact_whatsapp: {
      enabled: typeof contactWhatsApp.enabled === 'boolean' ? contactWhatsApp.enabled : defaults.contact_whatsapp!.enabled,
      phone: typeof contactWhatsApp.phone === 'string' ? contactWhatsApp.phone : defaults.contact_whatsapp!.phone,
      label: typeof contactWhatsApp.label === 'string' ? contactWhatsApp.label : defaults.contact_whatsapp!.label,
      message_template: typeof contactWhatsApp.message_template === 'string' ? contactWhatsApp.message_template : defaults.contact_whatsapp!.message_template,
    },
    booking: {
      enabled: typeof booking.enabled === 'boolean' ? booking.enabled : defaults.booking!.enabled,
      label: typeof booking.label === 'string' ? booking.label : defaults.booking!.label,
      appointment_types: Array.isArray(booking.appointment_types)
        ? booking.appointment_types.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean)
        : [],
      require_date: typeof booking.require_date === 'boolean' ? booking.require_date : defaults.booking!.require_date,
      require_time: typeof booking.require_time === 'boolean' ? booking.require_time : defaults.booking!.require_time,
    },
    external_link: {
      enabled: typeof externalLink.enabled === 'boolean' ? externalLink.enabled : defaults.external_link!.enabled,
      label: typeof externalLink.label === 'string' ? externalLink.label : defaults.external_link!.label,
      url: typeof externalLink.url === 'string' ? externalLink.url : defaults.external_link!.url,
    },
    share: {
      enabled: typeof share.enabled === 'boolean'
        ? share.enabled
        : Boolean(share.whatsapp || share.facebook || share.copy_link || share.native),
      label: typeof share.label === 'string' ? share.label : defaults.share!.label,
      whatsapp: typeof share.whatsapp === 'boolean' ? share.whatsapp : defaults.share!.whatsapp,
      facebook: typeof share.facebook === 'boolean' ? share.facebook : defaults.share!.facebook,
      x: typeof share.x === 'boolean' ? share.x : defaults.share!.x,
      copy_link: typeof share.copy_link === 'boolean' ? share.copy_link : defaults.share!.copy_link,
      native: typeof share.native === 'boolean' ? share.native : defaults.share!.native,
      instagram_url: typeof share.instagram_url === 'string' ? share.instagram_url : defaults.share!.instagram_url,
    },
    offer_cta: {
      target: offerCtaOptions.some((option) => option.value === offerCta.target)
        ? offerCta.target as NonNullable<DynamicMarkerActions['offer_cta']>['target']
        : defaults.offer_cta!.target,
      preset: typeof offerCta.preset === 'string' && offerCtaPresets.includes(offerCta.preset)
        ? offerCta.preset
        : defaults.offer_cta!.preset,
      custom_label: typeof offerCta.custom_label === 'string' ? offerCta.custom_label : defaults.offer_cta!.custom_label,
    },
  }
}

function formFromMarker(marker: DynamicMarker): FormState {
  return {
    name: marker.name ?? '',
    reference: marker.reference ?? '',
    category: marker.category ?? '',
    description: marker.description ?? '',
    price: minorToInput(marker.price_minor),
    previousPrice: minorToInput(marker.previous_price_minor),
    currency: normalizeCurrency(marker.currency),
    availability: normalizeAvailability(marker.availability),
    promotionText: marker.promotion_text ?? '',
    accentColor: normalizeAccentColor(marker.accent_color),
    badgeText: marker.badge_text ?? '',
    promotionEndsAt: isoToLocalDateTimeInput(marker.promotion_ends_at),
    postPromotionPrice: minorToInput(marker.post_promotion_price_minor),
    colors: parseColors(marker.colors_json),
    materials: parseAvailableOptions(marker.materials_json),
    sizes: parseSizes(marker.sizes_json),
    measurements: parseMeasurements(marker.measurements_json),
    media: parseMedia(marker.media_json),
    actions: parseActions(marker.actions_json),
    customFields: parseCustomFields(marker.custom_fields_json),
    bookingCalendarId: marker.booking_calendar_id ?? '',
  }
}

export default function DynamicMarkerPanel({ publicationId, pageId, selectedObject, targetKind, ensureElementId, openImageBank }: Props) {
  const targetObjectId = selectedObject?.data?.elementId ?? ''
  const linkedActionMarkerId = getDynamicMarkerActionMarkerId(selectedObject)
  const linkedSelection = useMemo(
    () => resolveDynamicMarkerLinkedSelection(selectedObject),
    [linkedActionMarkerId, selectedObject, targetObjectId],
  )
  const [marker, setMarker] = useState<DynamicMarker | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [linkedCalendar, setLinkedCalendar] = useState<AppointmentCalendar | null>(null)
  const [sharedCalendarQuery, setSharedCalendarQuery] = useState('')
  const [activeCalendarQuery, setActiveCalendarQuery] = useState('')
  const [sharedCalendars, setSharedCalendars] = useState<AppointmentCalendar[]>([])
  const [calendarSearching, setCalendarSearching] = useState(false)
  const [calendarLoadingMore, setCalendarLoadingMore] = useState(false)
  const [calendarLoaded, setCalendarLoaded] = useState(false)
  const [calendarPage, setCalendarPage] = useState<{ has_more: boolean; next_cursor: string | null }>({
    has_more: false,
    next_cursor: null,
  })
  const [calendarMessage, setCalendarMessage] = useState('')

  const canUseApi = !!publicationId && !!pageId
  const canActivate = !!form.name.trim()
  const persistedBookingEnabled = Boolean(marker && parseActions(marker.actions_json).booking?.enabled)
  const canManageBookingCalendar = Boolean(marker && persistedBookingEnabled)
  const calendarOptions = useMemo(() => {
    const unique = new Map<string, AppointmentCalendar>()
    for (const calendar of [linkedCalendar, ...sharedCalendars]) {
      if (calendar) unique.set(calendar.id, calendar)
    }
    return Array.from(unique.values())
  }, [linkedCalendar, sharedCalendars])

  const calendarIsReady = (calendar: AppointmentCalendar | null | undefined) => (
    Boolean(calendar?.has_active_windows) && Boolean(calendar?.has_active_types)
  )

  const selectedCalendar = calendarOptions.find((calendar) => calendar.id === form.bookingCalendarId) ?? null
  const hasIncompleteLinkedCalendar = Boolean(
    form.bookingCalendarId && selectedCalendar && !calendarIsReady(selectedCalendar),
  )

  const variantsCount = form.colors.length + form.materials.length + form.sizes.length + form.measurements.length
  const offerEnabled = !!(form.promotionEndsAt || form.postPromotionPrice || form.promotionText || form.badgeText)

  const humanKind = useMemo(() => {
    const kind = targetKind || selectedObject?.type || 'elemento'
    if (kind === 'linkzone') return 'zona'
    if (kind === 'button') return 'boton'
    if (kind === 'image') return 'imagen'
    return kind
  }, [selectedObject?.type, targetKind])

  useEffect(() => {
    let cancelled = false
    setError('')
    setSaved('')
    setMarker(null)
    setForm(emptyForm)

    if (!selectedObject || !canUseApi || linkedSelection.kind === 'none') return

    setLoading(true)
    ;(linkedSelection.kind === 'linked-marker'
      ? api.dynamicMarkers.get(linkedSelection.markerId)
      : api.dynamicMarkers.list(publicationId!, pageId!))
      .then((res) => {
        if (cancelled) return
        if (linkedSelection.kind === 'linked-marker') {
          const found = res.data as DynamicMarker
          setMarker(found)
          setForm(formFromMarker(found))
          return
        }
        const found = ((res.data ?? []) as DynamicMarker[]).find((item) => item.target_object_id === linkedSelection.targetObjectId) ?? null
        setMarker(found)
        setForm(found ? formFromMarker(found) : emptyForm)
      })
      .catch((err: any) => {
        if (!cancelled) setError(linkedSelection.kind === 'linked-marker'
          ? DYNAMIC_MARKER_LINKED_LOAD_ERROR
          : err?.message ?? 'No se pudo cargar la ficha interactiva')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [canUseApi, linkedSelection, pageId, publicationId, selectedObject])

  useEffect(() => {
    let cancelled = false
    const calendarId = form.bookingCalendarId

    if (!calendarId) {
      setLinkedCalendar(null)
      return () => { cancelled = true }
    }

    setLinkedCalendar((current) => current?.id === calendarId ? current : null)

    api.appointmentCalendars.get(calendarId)
      .then((res) => {
        if (cancelled) return

        setLinkedCalendar({
          ...res.data.calendar,
          has_active_windows: res.data.windows.some((window) => Boolean(window.active)),
          has_active_types: res.data.types.some(
            (type) => Boolean(type.active) && Boolean(type.label?.trim()),
          ),
        })
      })
      .catch(() => {
        if (!cancelled) setLinkedCalendar(null)
      })

    return () => { cancelled = true }
  }, [form.bookingCalendarId])

  const patchForm = (patch: Partial<FormState>) => {
    setSaved('')
    setForm((current) => ({ ...current, ...patch }))
  }

  const buildUpdate = () => ({
    name: form.name.trim() || null,
    reference: form.reference.trim() || null,
    category: form.category.trim() || null,
    description: form.description.trim() || null,
    price_minor: inputToMinor(form.price, 'Precio actual'),
    previous_price_minor: inputToMinor(form.previousPrice, 'Precio anterior'),
    currency: form.currency.trim() ? form.currency.trim().toUpperCase() : null,
    availability: form.availability.trim() || null,
    promotion_text: form.promotionText.trim() || null,
    accent_color: normalizeAccentColor(form.accentColor),
    badge_text: form.badgeText.trim() || null,
    promotion_ends_at: localDateTimeInputToIso(form.promotionEndsAt),
    post_promotion_price_minor: inputToMinor(form.postPromotionPrice, 'Precio posterior a la oferta'),
    colors_json: form.colors
      .filter((color) => color.name.trim())
      .map((color, index) => ({ id: color.id, name: color.name.trim(), hex: color.hex, available: color.available, sort_order: index })),
    materials_json: form.materials
      .filter((material) => material.name.trim())
      .map((material, index) => ({ id: material.id, name: material.name.trim(), available: material.available, sort_order: index })),
    sizes_json: form.sizes
      .filter((size) => size.label.trim())
      .map((size, index) => ({ id: size.id, label: size.label.trim(), value: size.value.trim(), available: size.available, sort_order: index })),
    measurements_json: form.measurements
      .filter((measurement) => measurement.label.trim() && measurement.value.trim())
      .map((measurement, index) => ({ id: measurement.id, label: measurement.label.trim(), value: measurement.value.trim(), unit: measurement.unit.trim(), sort_order: index })),
    media_json: form.media
      .filter((item) => item.url.trim())
      .map((item, index) => ({
        id: item.id,
        type: item.type,
        url: item.url.trim(),
        thumbnail_url: item.thumbnail_url.trim() || undefined,
        title: item.title.trim() || undefined,
        alt: item.alt.trim() || undefined,
        sort_order: index,
        visibility: item.visibility,
      })),
    actions_json: form.actions,
    booking_calendar_id: form.bookingCalendarId || null,
    custom_fields_json: form.customFields
      .filter((field) => field.label.trim() || field.value.trim())
      .map((field, index) => ({
        id: field.id,
        label: field.label.trim(),
        value: field.value.trim(),
        type: field.type,
        visibility: field.visibility,
        searchable: field.searchable,
        filterable: field.filterable,
        sort_order: index,
      })),
  })

  const updateCustomField = (index: number, patch: Partial<CustomField>) => {
    setSaved('')
    setForm((current) => ({
      ...current,
      customFields: current.customFields.map((field, i) => (i === index ? { ...field, ...patch } : field)),
    }))
  }

  const updateListItem = <K extends keyof Pick<FormState, 'colors' | 'materials' | 'sizes' | 'measurements' | 'media'>>(
    key: K,
    index: number,
    patch: Partial<FormState[K][number]>,
  ) => {
    setSaved('')
    setForm((current) => ({
      ...current,
      [key]: (current[key] as any[]).map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }))
  }

  const addListItem = <K extends keyof Pick<FormState, 'colors' | 'materials' | 'sizes' | 'measurements' | 'media'>>(
    key: K,
    item: FormState[K][number],
  ) => {
    setSaved('')
    setForm((current) => ({ ...current, [key]: [...(current[key] as any[]), item] }))
  }

  const removeListItem = <K extends keyof Pick<FormState, 'colors' | 'materials' | 'sizes' | 'measurements' | 'media'>>(
    key: K,
    index: number,
  ) => {
    setSaved('')
    setForm((current) => ({ ...current, [key]: (current[key] as any[]).filter((_, i) => i !== index) }))
  }

  const updateAction = <K extends keyof DynamicMarkerActions>(key: K, patch: Partial<NonNullable<DynamicMarkerActions[K]>>) => {
    setSaved('')
    setForm((current) => ({
      ...current,
      actions: {
        ...current.actions,
        [key]: { ...current.actions[key], ...patch } as NonNullable<DynamicMarkerActions[K]>,
      },
    }))
  }

  const loadInitialCalendars = async () => {
    if (!canManageBookingCalendar) return

    setCalendarSearching(true)
    setCalendarMessage('')

    try {
      const res = await api.appointmentCalendars.list({
        scope: 'tenant',
        limit: 12,
      })

      setSharedCalendars(res.data ?? [])
      setCalendarPage({
        has_more: Boolean(res.page?.has_more),
        next_cursor: res.page?.next_cursor ?? null,
      })
      setActiveCalendarQuery('')
      setCalendarLoaded(true)
    } catch (err: any) {
      setSharedCalendars([])
      setCalendarPage({ has_more: false, next_cursor: null })
      setCalendarLoaded(true)
      setCalendarMessage(err?.message ?? 'No se pudieron cargar las Agendas disponibles.')
    } finally {
      setCalendarSearching(false)
    }
  }

  useEffect(() => {
    if (!canManageBookingCalendar) {
      setSharedCalendars([])
      setCalendarPage({ has_more: false, next_cursor: null })
      setCalendarLoaded(false)
      setActiveCalendarQuery('')
      return
    }

    void loadInitialCalendars()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageBookingCalendar])

  const searchSharedCalendars = async (requestedQuery = sharedCalendarQuery) => {
    const query = requestedQuery.trim()

    setCalendarSearching(true)
    setCalendarMessage('')

    try {
      const res = await api.appointmentCalendars.list({
        q: query || undefined,
        scope: 'tenant',
        limit: 12,
      })

      setSharedCalendars(res.data ?? [])
      setCalendarPage({
        has_more: Boolean(res.page?.has_more),
        next_cursor: res.page?.next_cursor ?? null,
      })
      setActiveCalendarQuery(query)
      setCalendarLoaded(true)

      if (!res.data?.length) {
        setCalendarMessage(query ? 'No se encontraron Agendas.' : 'Aún no hay Agendas disponibles.')
      }
    } catch (err: any) {
      setSharedCalendars([])
      setCalendarPage({ has_more: false, next_cursor: null })
      setCalendarLoaded(true)
      setCalendarMessage(err?.message ?? 'No se pudo cargar la Agenda.')
    } finally {
      setCalendarSearching(false)
    }
  }

  const loadMoreSharedCalendars = async () => {
    const cursor = calendarPage.next_cursor
    if (!cursor) return

    setCalendarLoadingMore(true)
    setCalendarMessage('')

    try {
      const res = await api.appointmentCalendars.list({
        q: activeCalendarQuery || undefined,
        scope: 'tenant',
        limit: 12,
        cursor,
      })

      setSharedCalendars((current) => {
        const known = new Set(current.map((calendar) => calendar.id))
        return [...current, ...(res.data ?? []).filter((calendar) => !known.has(calendar.id))]
      })

      setCalendarPage({
        has_more: Boolean(res.page?.has_more),
        next_cursor: res.page?.next_cursor ?? null,
      })
    } catch (err: any) {
      setCalendarMessage(err?.message ?? 'No se pudieron cargar más Agendas.')
    } finally {
      setCalendarLoadingMore(false)
    }
  }

   const selectCalendar = (calendarId: string) => {
    if (!calendarId) {
      patchForm({ bookingCalendarId: '' })
      void saveBookingConfiguration('')
      return
    }

    const calendar = calendarOptions.find((item) => item.id === calendarId)

    if (!calendar || !calendarIsReady(calendar)) {
      setCalendarMessage(
        'Completa al menos un horario activo y un tipo de cita activo en Agenda antes de vincularla.',
      )
      return
    }

    patchForm({ bookingCalendarId: calendar.id })
    void saveBookingConfiguration(calendar.id)
  }

  const addCustomField = () => {
    setSaved('')
    setForm((current) => ({
      ...current,
      customFields: [...current.customFields, { id: localId(), label: '', value: '', type: 'text', visibility: 'public', searchable: false, filterable: false }],
    }))
  }

  const removeCustomField = (index: number) => {
    setSaved('')
    setForm((current) => ({
      ...current,
      customFields: current.customFields.filter((_, i) => i !== index),
    }))
  }

  const activateArea = async () => {
    if (!shouldCreateDirectDynamicMarker(linkedSelection)) {
      setError('')
      setSaved('')
      return
    }
    if (!canUseApi) {
      setError('No se pudo identificar la publicacion o la pagina activa')
      return
    }
    setError('')
    setSaved('')
    setSaving(true)
    try {
      const elementId = ensureElementId()
      if (!elementId) throw new Error('No se pudo asignar un identificador a esta área')
      const res = await api.dynamicMarkers.create({
        publication_id: publicationId!,
        page_id: pageId!,
        target_object_id: elementId,
        target_kind: targetKind || selectedObject?.type || null,
      })
      setMarker(res.data)
      setForm(formFromMarker(res.data))
      setSaved('Ficha creada como borrador')
    } catch (err: any) {
      if (String(err?.message ?? '').includes('Ya existe')) {
        try {
          const elementId = selectedObject?.data?.elementId
          const res = await api.dynamicMarkers.list(publicationId!, pageId!)
          const found = (res.data ?? []).find((item) => item.target_object_id === elementId) ?? null
          if (found) {
            setMarker(found)
            setForm(formFromMarker(found))
            setSaved('Ficha existente cargada')
            return
          }
        } catch {}
      }
      setError(err?.message ?? 'No se pudo activar la ficha')
    } finally {
      setSaving(false)
    }
  }

  const save = async () => {
    if (!marker) return
    setError('')
    setSaved('')
    setSaving(true)
    try {
      const res = await api.dynamicMarkers.update(marker.id, buildUpdate())
      setMarker(res.data)
      setForm(formFromMarker(res.data))
      setSaved('Cambios guardados')
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo guardar la ficha')
    } finally {
      setSaving(false)
    }
  }

  const saveBookingConfiguration = async (
    nextBookingCalendarId = form.bookingCalendarId,
    nextBookingAction = form.actions.booking,
  ) => {
    if (!marker) return false

    setError('')
    setSaved('')
    setSaving(true)
    setCalendarMessage('Guardando configuración de Agenda...')

    try {
      const persistedActions = parseActions(marker.actions_json)
      const agendaActions = {
        ...persistedActions,
        booking: nextBookingAction,
      }

      const res = await api.dynamicMarkers.update(marker.id, {
        actions_json: agendaActions,
        booking_calendar_id: nextBookingCalendarId || null,
      })

      const savedActions = parseActions(res.data.actions_json)

      setMarker(res.data)
      setForm((current) => ({
        ...current,
        actions: {
          ...current.actions,
          booking: savedActions.booking,
        },
        bookingCalendarId: res.data.booking_calendar_id ?? '',
      }))
      setCalendarMessage('Configuración de Agenda guardada.')
      setSaved('Configuración de Agenda guardada.')
      return true
    } catch (err: any) {
      const message = err?.message ?? 'No se pudo guardar la configuración de Agenda.'
      setError(message)
      setCalendarMessage(message)
      return false
    } finally {
      setSaving(false)
    }
  }

  const setStatus = async (status: DynamicMarkerStatus) => {
    if (!marker) return
    if (status === 'active' && !canActivate) return
    setError('')
    setSaved('')
    setSaving(true)
    try {
      let current = marker
      if (status === 'active') {
        const savedMarker = await api.dynamicMarkers.update(marker.id, buildUpdate())
        current = savedMarker.data
      }
      const res = await api.dynamicMarkers.setStatus(current.id, status)
      setMarker(res.data)
      setForm(formFromMarker(res.data))
      setSaved(status === 'active' ? 'Ficha activada' : 'Ficha desactivada')
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo cambiar el estado')
    } finally {
      setSaving(false)
    }
  }

  if (!selectedObject) {
    return (
      <div style={styles.empty}>
        Selecciona un elemento del lienzo para conectar una ficha interactiva.
      </div>
    )
  }

  if (!canUseApi) {
    return <div style={styles.empty}>No se pudo identificar la publicacion o la pagina activa.</div>
  }

  if (loading) return <div style={styles.empty}>Cargando ficha...</div>

  if (!targetObjectId || !marker) {
    return (
      <div style={styles.stack}>
        <p style={styles.copy}>
          Esta ficha quedará vinculada a esta {humanKind}. Se creará un Marker ID automático y la información comercial se guardará fuera del lienzo.
        </p>
        {error && <div style={styles.error}>{error}</div>}
        {saved && <div style={styles.success}>{saved}</div>}
        <button type="button" style={styles.primaryBtn} disabled={saving} onClick={activateArea}>
          {saving ? 'Activando...' : 'Activar ficha para esta área'}
        </button>
      </div>
    )
  }

  return (
    <div style={styles.stack}>
      <div style={styles.saveBar}>
        <div style={styles.saveBarText}>
          <strong style={styles.saveBarTitle}>Guardar ficha</strong>
          <span
            style={{
              ...styles.saveBarStatus,
              color: error
                ? '#b91c1c'
                : saved
                  ? '#047857'
                  : saving
                    ? '#4338ca'
                    : '#6b7280',
            }}
          >
            {saving
              ? 'Guardando...'
              : error
                ? 'Revisa el error antes de continuar'
                : saved || 'Guarda antes de abrir Vista previa'}
          </span>
        </div>

        <button
          type="button"
          style={{
            ...styles.primaryBtn,
            width: 'auto',
            minWidth: 124,
            padding: '9px 12px',
            opacity: saving ? 0.65 : 1,
            cursor: saving ? 'wait' : 'pointer',
          }}
          disabled={saving}
          onClick={save}
        >
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </div>

      <Accordion title="Información principal" open>
        <div style={styles.headerRow}>
          <span style={{ ...styles.badge, ...statusStyle(marker.status) }}>{statusLabel(marker.status)}</span>
        </div>
        <Field label="Nombre de la ficha">
          <input style={styles.input} value={form.name} onChange={(e) => patchForm({ name: e.target.value })} placeholder="Ej: Vaso térmico personalizado" />
        </Field>
        <Field label="Descripción">
          <textarea style={{ ...styles.input, minHeight: 74, resize: 'vertical' }} value={form.description} onChange={(e) => patchForm({ description: e.target.value })} />
        </Field>
        <Field label="Referencia">
          <input style={styles.input} value={form.reference} onChange={(e) => patchForm({ reference: e.target.value })} placeholder="Ej: VT-NOMBRE-LÁSER" />
        </Field>
        <Field label="Categoría">
          <input style={styles.input} value={form.category} onChange={(e) => patchForm({ category: e.target.value })} />
        </Field>
        <Field label="Disponibilidad">
          <select style={styles.input} value={form.availability} onChange={(e) => patchForm({ availability: e.target.value })}>
            {availabilityOptions.map((option) => (
              <option key={option || 'empty'} value={option}>{option || 'Sin definir'}</option>
            ))}
          </select>
        </Field>
      </Accordion>

      <Accordion title="Precio y conversión">
        <div style={styles.adaptiveGrid}>
          {!offerEnabled && (
            <>
              <Field label="Precio actual">
                <input style={styles.input} inputMode="decimal" value={form.price} onChange={(e) => patchForm({ price: e.target.value })} placeholder="850.50" />
              </Field>
              <Field label="Precio anterior o regular">
                <input style={styles.input} inputMode="decimal" value={form.previousPrice} onChange={(e) => patchForm({ previousPrice: e.target.value })} />
              </Field>
            </>
          )}
          <Field label="Moneda">
            <select style={styles.input} value={form.currency} onChange={(e) => patchForm({ currency: e.target.value })}>
              {currencyOptions.map((option) => (
                <option key={option || 'empty'} value={option}>{option || 'Sin definir'}</option>
              ))}
            </select>
          </Field>
        </div>
        {offerEnabled && <p style={styles.copy}>Los precios de esta ficha se editan en el bloque Oferta limitada.</p>}
        <Field label="Color de acento">
          <div style={styles.accentRow}>
            <input
              style={styles.colorInput}
              type="color"
              value={normalizeAccentColor(form.accentColor)}
              onChange={(e) => patchForm({ accentColor: e.target.value.toUpperCase() })}
              aria-label="Color de acento"
            />
            <input
              style={styles.input}
              value={form.accentColor}
              onChange={(e) => patchForm({ accentColor: e.target.value })}
              placeholder="#F59E0B"
            />
            <button type="button" style={styles.smallButton} onClick={() => patchForm({ accentColor: '#F59E0B' })}>
              Restablecer
            </button>
          </div>
          <span style={{ ...styles.accentPreview, background: normalizeAccentColor(form.accentColor) }} />
        </Field>
      </Accordion>

      <Accordion title="Oferta limitada">
        <div style={styles.offerBox}>
          <label style={styles.checkLabel}>
            <input
              type="checkbox"
              checked={offerEnabled}
              onChange={(e) => {
                if (e.target.checked) {
                  patchForm({ badgeText: form.badgeText || 'Oferta', promotionText: form.promotionText || 'Oferta temporal' })
                } else {
                  patchForm({ badgeText: '', promotionText: '', promotionEndsAt: '', postPromotionPrice: '' })
                }
              }}
            />
            Activar oferta limitada
          </label>
          <Field label="Título de la oferta">
            <input style={styles.input} value={form.badgeText} onChange={(e) => patchForm({ badgeText: e.target.value })} placeholder="Oferta, Nuevo, Edición limitada..." />
          </Field>
          <Field label="Mensaje visible durante la oferta">
            <input style={styles.input} value={form.promotionText} onChange={(e) => patchForm({ promotionText: e.target.value })} placeholder="Luego costará US$12" />
            <span style={styles.helpText}>Se mostrará debajo del reloj y desaparecerá al vencer la oferta.</span>
          </Field>
          <div style={styles.adaptiveGrid}>
            <Field label="Precio durante la oferta">
              <input style={styles.input} inputMode="decimal" value={form.price} onChange={(e) => patchForm({ price: e.target.value })} placeholder="850.50" />
            </Field>
            <Field label="Precio regular anterior">
              <input style={styles.input} inputMode="decimal" value={form.previousPrice} onChange={(e) => patchForm({ previousPrice: e.target.value })} />
            </Field>
            <Field label="Fecha de vencimiento">
              <input style={styles.input} type="datetime-local" value={form.promotionEndsAt} onChange={(e) => patchForm({ promotionEndsAt: e.target.value })} />
            </Field>
            <Field label="Precio al finalizar">
              <input style={styles.input} inputMode="decimal" value={form.postPromotionPrice} onChange={(e) => patchForm({ postPromotionPrice: e.target.value })} placeholder="1250.00" />
            </Field>
          </div>
          <Field label="CTA destacado debajo del reloj">
            <select style={styles.input} value={form.actions.offer_cta?.target ?? ''} onChange={(e) => updateAction('offer_cta', { target: e.target.value as NonNullable<DynamicMarkerActions['offer_cta']>['target'] })}>
              {offerCtaOptions.map((option) => <option key={option.value || 'none'} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <Field label="Copy visible del CTA">
            <select style={styles.input} value={form.actions.offer_cta?.preset ?? 'La quiero ahora'} onChange={(e) => updateAction('offer_cta', { target: 'contact_whatsapp', preset: e.target.value })}>
              {offerCtaPresets.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
            </select>
          </Field>
          <Field label="Copy personalizado opcional">
            <input style={styles.input} value={form.actions.offer_cta?.custom_label ?? ''} onChange={(e) => updateAction('offer_cta', { target: 'contact_whatsapp', custom_label: e.target.value })} placeholder="Ej: Apartar esta oferta" />
          </Field>
          <p style={styles.copy}>El precio vigente durante la oferta es el precio actual. Al vencer, el Viewer mostrará el precio al finalizar sin escribir automáticamente en D1.</p>
        </div>
      </Accordion>

      <Accordion title={`Variantes y especificaciones · ${variantsCount}`}>
        <div style={styles.section}>
        <div style={styles.sectionTitle}>Colores</div>
        {form.colors.map((color, index) => (
          <div key={color.id} style={styles.customField}>
            <input style={styles.input} value={color.name} onChange={(e) => updateListItem('colors', index, { name: e.target.value })} placeholder="Nombre" />
            <div style={styles.inlineRow}>
              <input style={styles.colorInput} type="color" value={color.hex} onChange={(e) => updateListItem('colors', index, { hex: e.target.value })} />
              <input style={styles.input} value={color.hex} onChange={(e) => updateListItem('colors', index, { hex: e.target.value })} placeholder="#111827" />
            </div>
            <label style={styles.checkLabel}>
              <input type="checkbox" checked={color.available} onChange={(e) => updateListItem('colors', index, { available: e.target.checked })} />
              Disponible
            </label>
            <button type="button" style={styles.removeBtn} onClick={() => removeListItem('colors', index)}>Eliminar</button>
          </div>
        ))}
        <button type="button" style={styles.secondaryBtn} onClick={() => addListItem('colors', { id: localId(), name: '', hex: '#111827', available: true })}>
          Agregar color
        </button>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Materiales</div>
        {form.materials.map((material, index) => (
          <div key={material.id} style={styles.customField}>
            <input style={styles.input} value={material.name} onChange={(e) => updateListItem('materials', index, { name: e.target.value })} placeholder="Nombre" />
            <label style={styles.checkLabel}>
              <input type="checkbox" checked={material.available} onChange={(e) => updateListItem('materials', index, { available: e.target.checked })} />
              Disponible
            </label>
            <button type="button" style={styles.removeBtn} onClick={() => removeListItem('materials', index)}>Eliminar</button>
          </div>
        ))}
        <button type="button" style={styles.secondaryBtn} onClick={() => addListItem('materials', { id: localId(), name: '', available: true })}>
          Agregar material
        </button>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Variantes y tallas</div>
        {form.sizes.map((size, index) => (
          <div key={size.id} style={styles.customField}>
            <input style={styles.input} value={size.label} onChange={(e) => updateListItem('sizes', index, { label: e.target.value })} placeholder="Etiqueta" />
            <input style={styles.input} value={size.value} onChange={(e) => updateListItem('sizes', index, { value: e.target.value })} placeholder="Valor" />
            <label style={styles.checkLabel}>
              <input type="checkbox" checked={size.available} onChange={(e) => updateListItem('sizes', index, { available: e.target.checked })} />
              Disponible
            </label>
            <button type="button" style={styles.removeBtn} onClick={() => removeListItem('sizes', index)}>Eliminar</button>
          </div>
        ))}
        <button type="button" style={styles.secondaryBtn} onClick={() => addListItem('sizes', { id: localId(), label: '', value: '', available: true })}>
          Agregar variante
        </button>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Medidas</div>
        {form.measurements.map((measurement, index) => (
          <div key={measurement.id} style={styles.customField}>
            <input style={styles.input} value={measurement.label} onChange={(e) => updateListItem('measurements', index, { label: e.target.value })} placeholder="Etiqueta" />
            <input style={styles.input} value={measurement.value} onChange={(e) => updateListItem('measurements', index, { value: e.target.value })} placeholder="Valor" />
            <input style={styles.input} value={measurement.unit} onChange={(e) => updateListItem('measurements', index, { unit: e.target.value })} placeholder="Unidad" />
            <button type="button" style={styles.removeBtn} onClick={() => removeListItem('measurements', index)}>Eliminar</button>
          </div>
        ))}
        <button type="button" style={styles.secondaryBtn} onClick={() => addListItem('measurements', { id: localId(), label: '', value: '', unit: '' })}>
          Agregar medida
        </button>
      </div>
      </Accordion>

      <Accordion title={`Multimedia · ${form.media.length}`}>
        <div style={styles.section}>
        <div style={styles.sectionTitle}>Multimedia manual</div>
        {form.media.map((item, index) => (
          <div key={item.id} style={styles.customField}>
            <select style={styles.input} value={item.type} onChange={(e) => updateListItem('media', index, { type: e.target.value as MediaType })}>
              {mediaTypes.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <div style={styles.mediaUpload}>
              <div style={styles.mediaUploadTitle}>{mediaUploadConfig[item.type].label}</div>
              {item.type === 'image' && openImageBank ? (
                <div>
                  {item.url ? (
                    <img
                      src={item.url}
                      alt={item.alt || item.title || 'Vista previa'}
                      style={{
                        display: 'block',
                        width: '100%',
                        maxHeight: 130,
                        objectFit: 'contain',
                        borderRadius: 8,
                        background: '#f8fafc',
                        marginBottom: 8,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        border: '2px dashed #c7d2fe',
                        borderRadius: 10,
                        padding: '18px 12px',
                        textAlign: 'center',
                        color: '#9ca3af',
                        fontSize: 12,
                        background: '#f8fafc',
                        marginBottom: 8,
                      }}
                    >
                      Sin imagen seleccionada
                    </div>
                  )}

                  <button
                    type="button"
                    style={{ ...styles.secondaryBtn, width: '100%' }}
                    onClick={() => openImageBank((url, thumbnailUrl) => {
                      updateListItem('media', index, {
                        url,
                        thumbnail_url: thumbnailUrl ?? '',
                      })
                    })}
                  >
                    Examinar imagen
                  </button>

                  <input
                    style={{ ...styles.input, marginTop: 6 }}
                    value={item.url}
                    onChange={(event) => updateListItem('media', index, {
                      url: event.target.value,
                    })}
                    placeholder="…o pega una URL: https://…"
                  />
                </div>
              ) : (
                <FileField
                  value={item.url}
                  onChange={(url) => updateListItem('media', index, { url })}
                  accept={mediaUploadConfig[item.type].accept}
                  hint={mediaUploadConfig[item.type].hint}
                  browseLabel={mediaUploadConfig[item.type].label}
                />
              )}
            </div>
            <input style={styles.input} value={item.thumbnail_url} onChange={(e) => updateListItem('media', index, { thumbnail_url: e.target.value })} placeholder="URL miniatura opcional" />
            <input style={styles.input} value={item.title} onChange={(e) => updateListItem('media', index, { title: e.target.value })} placeholder="Título opcional" />
            <input style={styles.input} value={item.alt} onChange={(e) => updateListItem('media', index, { alt: e.target.value })} placeholder="Texto alternativo opcional" />
            <select style={styles.input} value={item.visibility} onChange={(e) => updateListItem('media', index, { visibility: e.target.value as Visibility })}>
              {visibilityOptions.map((option) => <option key={option} value={option}>{visibilityLabel(option)}</option>)}
            </select>
            <button type="button" style={styles.removeBtn} onClick={() => removeListItem('media', index)}>Eliminar</button>
          </div>
        ))}
        <button type="button" style={styles.secondaryBtn} onClick={() => addListItem('media', { id: localId(), type: 'image', url: '', thumbnail_url: '', title: '', alt: '', sort_order: form.media.length, visibility: 'public' })}>
          Agregar multimedia
        </button>
      </div>
      </Accordion>

      <Accordion title="Acciones de ficha">
        <div style={styles.section}>
        <div style={styles.sectionTitle}>Contactar vendedor</div>
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={!!form.actions.contact_whatsapp?.enabled} onChange={(e) => updateAction('contact_whatsapp', { enabled: e.target.checked })} />
          Activar
        </label>
        <input style={styles.input} value={form.actions.contact_whatsapp?.label ?? ''} onChange={(e) => updateAction('contact_whatsapp', { label: e.target.value })} placeholder="Texto de botón" />
        <input style={styles.input} value={form.actions.contact_whatsapp?.phone ?? ''} onChange={(e) => updateAction('contact_whatsapp', { phone: e.target.value })} placeholder="Teléfono del vendedor" />
        <textarea style={{ ...styles.input, minHeight: 64, resize: 'vertical' }} value={form.actions.contact_whatsapp?.message_template ?? ''} onChange={(e) => updateAction('contact_whatsapp', { message_template: e.target.value })} placeholder="Mensaje personalizado opcional" />
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Agendar</div>
        <label style={styles.checkLabel}>
          <input
            type="checkbox"
            checked={!!form.actions.booking?.enabled}
            onChange={(e) => {
              const enabled = e.target.checked
              const nextBookingAction = {
                ...form.actions.booking,
                enabled,
                label: form.actions.booking?.label || 'Agendar',
                appointment_types: [],
                require_date: form.actions.booking?.require_date ?? true,
                require_time: form.actions.booking?.require_time ?? true,
              }

              updateAction('booking', nextBookingAction)

              if (!enabled) {
                patchForm({ bookingCalendarId: '' })
                void saveBookingConfiguration('', nextBookingAction)
                return
              }

              void saveBookingConfiguration(form.bookingCalendarId, nextBookingAction)
            }}
          />
          Activar
        </label>
        <input
          style={styles.input}
          value={form.actions.booking?.label ?? ''}
          onChange={(e) => updateAction('booking', { label: e.target.value })}
          placeholder="Texto de botón"
        />
        <div style={styles.advancedRow}>
          <label style={styles.checkLabel}>
            <input
              type="checkbox"
              checked={form.actions.booking?.require_date !== false}
              onChange={(e) => updateAction('booking', { require_date: e.target.checked })}
            />
            Fecha requerida
          </label>
          <label style={styles.checkLabel}>
            <input
              type="checkbox"
              checked={form.actions.booking?.require_time !== false}
              onChange={(e) => updateAction('booking', { require_time: e.target.checked })}
            />
            Hora requerida
          </label>
        </div>

        <div style={styles.calendarBox}>
          <div style={styles.sectionTitle}>Agenda vinculada</div>
          {!canManageBookingCalendar ? (
            <p style={styles.copy}>
              Guarda primero la ficha con Agendar activado para vincular una Agenda existente.
            </p>
          ) : (
            <>
              <Field label="Agenda para esta ficha">
                <select
                  style={styles.input}
                  value={form.bookingCalendarId}
                  onChange={(e) => selectCalendar(e.target.value)}
                >
                  <option value="">Sin Agenda vinculada</option>
                  {calendarOptions.map((calendar) => {
                    const ready = calendarIsReady(calendar)
                    const selected = form.bookingCalendarId === calendar.id

                    return (
                      <option
                        key={calendar.id}
                        value={calendar.id}
                        disabled={!ready && !selected}
                      >
                        {calendar.name}
                        {calendar.marker_count ? ` · ${calendar.marker_count} ficha(s)` : ''}
                        {!ready ? ' · requiere horario y tipo activo' : ''}
                      </option>
                    )
                  })}
                </select>
                <span style={styles.helpText}>
                  Las reglas operativas se administran desde el módulo Agenda. Aquí solo se vincula, cambia o desvincula.
                </span>
              </Field>

              <Field label="Buscar o filtrar Agenda">
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    style={styles.input}
                    value={sharedCalendarQuery}
                    onChange={(e) => {
                      const value = e.target.value
                      setSharedCalendarQuery(value)

                      if (!value.trim() && activeCalendarQuery) {
                        void searchSharedCalendars('')
                      }
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') void searchSharedCalendars() }}
                    placeholder="Nombre, ficha, referencia o publicación"
                  />
                  <button
                    type="button"
                    style={{ ...styles.secondaryBtn, width: 'auto', whiteSpace: 'nowrap' }}
                    disabled={calendarSearching}
                    onClick={() => void searchSharedCalendars()}
                  >
                    {calendarSearching ? 'Cargando...' : 'Buscar'}
                  </button>
                </div>
                <span style={styles.helpText}>
                  Al abrir se muestran hasta 12 Agendas recientes. La búsqueda es opcional.
                </span>
              </Field>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <strong style={{ fontSize: 12, color: '#374151' }}>
                    {activeCalendarQuery ? 'Resultados de Agenda' : 'Agendas disponibles recientes'}
                  </strong>

                  <button
                    type="button"
                    style={{ ...styles.smallButton, padding: '5px 8px' }}
                    disabled={calendarSearching}
                    onClick={() => void searchSharedCalendars(activeCalendarQuery)}
                  >
                    Actualizar
                  </button>
                </div>

                {!calendarLoaded || calendarSearching ? (
                  <span style={styles.helpText}>Cargando Agendas disponibles...</span>
                ) : !calendarOptions.length ? (
                  <span style={styles.helpText}>No hay Agendas disponibles todavía.</span>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {calendarOptions.map((calendar) => {
                      const selected = form.bookingCalendarId === calendar.id
                      const readiness = calendarIsReady(calendar)
                        ? 'Lista para reservar'
                        : calendar.has_active_windows
                          ? 'Falta tipo de cita activo'
                          : 'Falta horario activo'
                      const ready = calendarIsReady(calendar)

                      return (
                        <button
                          key={calendar.id}
                          type="button"
                          disabled={!ready}
                          onClick={() => selectCalendar(calendar.id)}
                          style={{
                            border: `1px solid ${selected ? '#4F46E5' : '#dbeafe'}`,
                            background: selected ? '#eef2ff' : '#fff',
                            borderRadius: 7,
                            padding: '8px 9px',
                            color: '#374151',
                            cursor: ready ? 'pointer' : 'not-allowed',
                            opacity: ready ? 1 : 0.62,
                            textAlign: 'left',
                            fontFamily: 'inherit',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 3,
                          }}
                        >
                          <strong style={{ fontSize: 12 }}>{calendar.name}</strong>
                          <span style={{ fontSize: 11, color: '#6b7280' }}>
                            {readiness} · {calendar.marker_count ? `${calendar.marker_count} ficha(s)` : 'Sin fichas vinculadas'}
                          </span>
                          {!ready && (
                            <span style={{ fontSize: 11, color: '#92400e' }}>
                              Completa horarios y al menos un tipo de cita activo en Agenda antes de vincularla.
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}

                <button
                  type="button"
                  style={{ ...styles.primaryBtn, width: '100%', marginTop: 2 }}
                  disabled={saving || calendarSearching}
                  onClick={() => void saveBookingConfiguration()}
                >
                  {saving ? 'Guardando...' : 'Guardar configuración de Agenda'}
                </button>

                {hasIncompleteLinkedCalendar && (
                  <p style={styles.copy}>
                    La Agenda actualmente vinculada está incompleta. No se desvinculó automáticamente,
                    pero el Viewer no debe mostrar disponibilidad ni aceptar reservas hasta completarla.
                  </p>
                )}

                {calendarPage.has_more && calendarPage.next_cursor && (
                  <button
                    type="button"
                    style={{ ...styles.smallButton, width: '100%' }}
                    disabled={calendarLoadingMore}
                    onClick={() => void loadMoreSharedCalendars()}
                  >
                    {calendarLoadingMore ? 'Cargando...' : 'Cargar más Agendas'}
                  </button>
                )}
              </div>

             </>
          )}
          {calendarMessage && (
            <p style={calendarMessage.includes('creada') || calendarMessage.includes('encontradas') || calendarMessage.includes('confirmar') || calendarMessage.includes('guardada') ? styles.success : styles.copy}>
              {calendarMessage}
            </p>
          )}
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Enlace externo</div>
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={!!form.actions.external_link?.enabled} onChange={(e) => updateAction('external_link', { enabled: e.target.checked })} />
          Activar
        </label>
        <input style={styles.input} value={form.actions.external_link?.label ?? ''} onChange={(e) => updateAction('external_link', { label: e.target.value })} placeholder="Texto de botón" />
        <input style={styles.input} value={form.actions.external_link?.url ?? ''} onChange={(e) => updateAction('external_link', { url: e.target.value })} placeholder="URL" />
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Compartir</div>
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={!!form.actions.share?.enabled} onChange={(e) => updateAction('share', { enabled: e.target.checked })} />
          Activar
        </label>
        <input style={styles.input} value={form.actions.share?.label ?? ''} onChange={(e) => updateAction('share', { label: e.target.value })} placeholder="Texto de botón" />
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={!!form.actions.share?.whatsapp} onChange={(e) => updateAction('share', { whatsapp: e.target.checked })} />
          Compartir por WhatsApp
        </label>
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={!!form.actions.share?.facebook} onChange={(e) => updateAction('share', { facebook: e.target.checked })} />
          Facebook
        </label>
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={!!form.actions.share?.x} onChange={(e) => updateAction('share', { x: e.target.checked })} />
          X
        </label>
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={!!form.actions.share?.copy_link} onChange={(e) => updateAction('share', { copy_link: e.target.checked })} />
          Copiar enlace
        </label>
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={!!form.actions.share?.native} onChange={(e) => updateAction('share', { native: e.target.checked })} />
          Compartir nativo
        </label>
        <input style={styles.input} value={form.actions.share?.instagram_url ?? ''} onChange={(e) => updateAction('share', { instagram_url: e.target.value })} placeholder="URL de Instagram opcional" />
      </div>
      </Accordion>

      <Accordion title={`Campos personalizados · ${form.customFields.length}`}>
        <div style={styles.section}>
        <div style={styles.sectionTitle}>Campos personalizados avanzados</div>
        {form.customFields.map((field, index) => (
          <div key={field.id} style={styles.customField}>
            <input
              style={styles.input}
              value={field.label}
              onChange={(e) => updateCustomField(index, { label: e.target.value })}
              placeholder="Etiqueta"
            />
            <input
              style={styles.input}
              value={field.value}
              onChange={(e) => updateCustomField(index, { value: e.target.value })}
              placeholder="Valor"
            />
            <select style={styles.input} value={field.type} onChange={(e) => updateCustomField(index, { type: e.target.value as CustomFieldType })}>
              {customFieldTypes.map((type) => <option key={type} value={type}>{customFieldTypeLabels[type]}</option>)}
            </select>
            <select style={styles.input} value={field.visibility} onChange={(e) => updateCustomField(index, { visibility: e.target.value as Visibility })}>
              {visibilityOptions.map((option) => <option key={option} value={option}>{visibilityLabel(option)}</option>)}
            </select>
            <button type="button" style={styles.removeBtn} onClick={() => removeCustomField(index)}>
              Eliminar
            </button>
          </div>
        ))}
        <button type="button" style={styles.secondaryBtn} onClick={addCustomField}>
          Agregar campo personalizado
        </button>
      </div>
      </Accordion>

      <Accordion title="Opciones avanzadas">
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Campos personalizados</div>
          {form.customFields.length ? form.customFields.map((field, index) => (
            <div key={field.id} style={styles.advancedRow}>
              <span style={styles.advancedLabel}>{field.label.trim() || `Campo ${index + 1}`}</span>
              <label style={styles.checkLabel}>
                <input type="checkbox" checked={field.searchable} onChange={(e) => updateCustomField(index, { searchable: e.target.checked })} />
                Buscable
              </label>
              <label style={styles.checkLabel}>
                <input type="checkbox" checked={field.filterable} onChange={(e) => updateCustomField(index, { filterable: e.target.checked })} />
                Filtrable
              </label>
            </div>
          )) : <p style={styles.copy}>Agrega campos personalizados para configurar opciones avanzadas.</p>}
        </div>
      </Accordion>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.actions}>
        {marker.status === 'active' ? (
          <button type="button" style={styles.secondaryBtn} disabled={saving} onClick={() => setStatus('inactive')}>
            Desactivar
          </button>
        ) : (
          <button type="button" style={{ ...styles.primaryBtn, opacity: canActivate && !saving ? 1 : 0.45 }} disabled={saving || !canActivate} onClick={() => setStatus('active')}>
            Activar ficha
          </button>
        )}
      </div>
    </div>
  )
}

function visibilityLabel(value: Visibility) {
  return value === 'internal' ? 'Interno' : 'Público'
}

function Accordion({ title, open = false, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(open)

  return (
    <details style={styles.accordion} open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary style={styles.accordionSummary}>
        <span>{title}</span>
        <span style={styles.accordionHint}>Abrir/cerrar</span>
      </summary>
      <div style={styles.accordionBody}>
        {children}
      </div>
    </details>
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
  stack: { display: 'flex', flexDirection: 'column', gap: 14 },
  empty: { fontSize: 12, color: '#9ca3af', lineHeight: 1.5, padding: '8px 0' },
  copy: { fontSize: 12, color: '#6b7280', lineHeight: 1.5, margin: 0 },
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  badge: { display: 'inline-flex', alignItems: 'center', border: '1px solid', borderRadius: 999, padding: '3px 8px', fontSize: 11, fontWeight: 700 },
  field: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 },
  label: { fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' },
  helpText: { fontSize: 12, color: '#6b7280', lineHeight: 1.35 },
  input: { border: '1px solid #e5e7eb', borderRadius: 6, padding: '7px 10px', fontSize: 13, width: '100%', minWidth: 0, boxSizing: 'border-box', background: '#fff', fontFamily: 'inherit' },
  colorInput: { border: '1px solid #e5e7eb', borderRadius: 6, padding: 3, width: 42, height: 34, boxSizing: 'border-box', background: '#fff' },
  inlineRow: { display: 'grid', gridTemplateColumns: '42px 1fr', gap: 6, alignItems: 'center' },
  accentRow: { display: 'grid', gridTemplateColumns: '42px 1fr auto', gap: 6, alignItems: 'center' },
  accentPreview: { display: 'block', width: '100%', height: 6, borderRadius: 999, border: '1px solid #e5e7eb' },
  smallButton: { background: '#fff', color: '#4F46E5', border: '1px solid #c7d2fe', borderRadius: 6, padding: '7px 9px', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'inherit' },
  checkLabel: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#4b5563' },
  twoCols: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  adaptiveGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, minWidth: 0 },
  section: { display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid #f3f4f6', paddingTop: 12 },
  sectionTitle: { fontSize: 12, fontWeight: 800, color: '#374151' },
  offerBox: { display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 8, padding: 10 },
  calendarBox: { display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid #dbeafe', background: '#eff6ff', borderRadius: 8, padding: 10 },
  customField: { display: 'grid', gridTemplateColumns: '1fr', gap: 6 },
  advancedRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: 8, alignItems: 'center', borderTop: '1px solid #f3f4f6', paddingTop: 8 },
  advancedLabel: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 700, color: '#374151' },
  mediaUpload: { display: 'flex', flexDirection: 'column', gap: 6 },
  mediaUploadTitle: { fontSize: 12, fontWeight: 800, color: '#4F46E5' },
  actions: { display: 'flex', flexDirection: 'column', gap: 8 },
  saveBar: {
    position: 'sticky',
    top: 0,
    zIndex: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: 10,
    margin: '-2px -2px 2px',
    border: '1px solid #c7d2fe',
    borderRadius: 10,
    background: 'rgba(255,255,255,0.97)',
    boxShadow: '0 8px 20px rgba(15,23,42,0.12)',
    backdropFilter: 'blur(8px)',
  },
  saveBarText: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  saveBarTitle: {
    color: '#111827',
    fontSize: 12,
    lineHeight: 1.2,
  },
  saveBarStatus: {
    fontSize: 11,
    lineHeight: 1.25,
    overflowWrap: 'anywhere',
  },
  primaryBtn: { width: '100%', background: '#4F46E5', color: '#fff', border: 'none', borderRadius: 8, padding: '10px', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' },
  secondaryBtn: { width: '100%', background: '#fff', color: '#4F46E5', border: '1.5px solid #4F46E5', borderRadius: 8, padding: '9px 10px', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' },
  removeBtn: { width: '100%', background: '#fff', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'inherit' },
  error: { border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', borderRadius: 8, padding: '8px 10px', fontSize: 12, lineHeight: 1.4 },
  success: { border: '1px solid #a7f3d0', background: '#ecfdf5', color: '#047857', borderRadius: 8, padding: '8px 10px', fontSize: 12, lineHeight: 1.4 },
  accordion: { border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', overflow: 'hidden' },
  accordionSummary: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, cursor: 'pointer', padding: '11px 12px', fontSize: 13, fontWeight: 800, color: '#111827', background: '#f9fafb', userSelect: 'none' },
  accordionHint: { fontSize: 11, fontWeight: 700, color: '#6b7280' },
  accordionBody: { display: 'flex', flexDirection: 'column', gap: 12, padding: 12 },
}
