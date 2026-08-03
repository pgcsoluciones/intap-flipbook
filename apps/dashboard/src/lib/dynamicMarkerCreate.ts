import type { CreateIndependentDynamicMarkerInput, DynamicMarker, DynamicMarkerCatalogItem } from './api'
import { getDynamicMarkerThumbnail, normalizeDynamicMarkerMediaItems, type DynamicMarkerMediaItem } from './dynamicMarkerMedia'

export type DynamicMarkerCreatePublication = {
  id: string
  title: string | null
}

export type DynamicMarkerCreateFormState = {
  publicationId: string
  name: string
  reference: string
  category: string
  description: string
  price: string
  currency: string
  availability: string
  accentColor: string
}

export type DynamicMarkerCreateMediaType = 'image' | 'video' | 'audio'

export type DynamicMarkerCreateUploadedMedia = {
  id: string
  type: DynamicMarkerCreateMediaType
  url: string
  title?: string
  alt?: string
}

export type DynamicMarkerCreateValidation = {
  valid: boolean
  errors: Partial<Record<keyof DynamicMarkerCreateFormState | 'publications', string>>
}

export const NEW_DYNAMIC_MARKER_BUTTON_LABEL = 'Nueva ficha'
export const DYNAMIC_MARKER_CREATE_SUBMIT_LABEL = 'Crear ficha'
export const DYNAMIC_MARKER_CREATE_SAVING_LABEL = 'Creando ficha...'
export const DYNAMIC_MARKER_CREATE_GENERIC_ERROR = 'No pudimos crear la ficha.'
export const DYNAMIC_MARKER_CREATE_NO_PUBLICATIONS = 'Necesitas una publicación antes de crear una ficha.'
export const DYNAMIC_MARKER_CREATE_PUBLICATION_REQUIRED = 'Selecciona una publicación.'
export const DYNAMIC_MARKER_CREATE_NAME_REQUIRED = 'Escribe un nombre para la ficha.'
export const DYNAMIC_MARKER_CREATE_PRICE_INVALID = 'Ingresa un precio válido.'
export const DYNAMIC_MARKER_CREATE_CURRENCY_INVALID = 'Selecciona una moneda válida.'
export const DYNAMIC_MARKER_CREATE_AVAILABILITY_INVALID = 'Selecciona una disponibilidad válida.'
export const DYNAMIC_MARKER_CREATE_MEDIA_UPLOAD_ERROR = 'No pudimos cargar este archivo.'

export const DYNAMIC_MARKER_CREATE_CURRENCY_OPTIONS = ['', 'DOP', 'USD', 'EUR', 'CAD', 'MXN', 'COP'] as const
export const DYNAMIC_MARKER_CREATE_AVAILABILITY_OPTIONS = [
  '',
  'Disponible',
  'Agotado',
  'Por encargo',
  'Próximamente',
  'Consultar disponibilidad',
] as const
export const DYNAMIC_MARKER_CREATE_MEDIA_UPLOAD_CONFIG: Record<DynamicMarkerCreateMediaType, { label: string; accept: string; hint: string }> = {
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
export const DYNAMIC_MARKER_CREATE_MEDIA_ACCEPT = Object.values(DYNAMIC_MARKER_CREATE_MEDIA_UPLOAD_CONFIG)
  .map((config) => config.accept)
  .join(',')

export const EMPTY_DYNAMIC_MARKER_CREATE_FORM: DynamicMarkerCreateFormState = {
  publicationId: '',
  name: '',
  reference: '',
  category: '',
  description: '',
  price: '',
  currency: 'DOP',
  availability: '',
  accentColor: '#4f46e5',
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalText(value: unknown) {
  const cleaned = cleanText(value)
  return cleaned ? cleaned : undefined
}

export function normalizeDynamicMarkerCreatePublications(rows: unknown[]): DynamicMarkerCreatePublication[] {
  return rows
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const record = row as Record<string, unknown>
      const id = cleanText(record.id)
      if (!id) return null
      return {
        id,
        title: optionalText(record.title) ?? optionalText(record.name) ?? optionalText(record.public_slug) ?? null,
      }
    })
    .filter((row): row is DynamicMarkerCreatePublication => Boolean(row))
}

export function initialDynamicMarkerCreatePublicationId(
  publications: DynamicMarkerCreatePublication[],
  preferredPublicationId = '',
) {
  const preferred = cleanText(preferredPublicationId)
  if (preferred && publications.some((publication) => publication.id === preferred)) return preferred
  if (publications.length === 1) return publications[0].id
  return ''
}

export function dynamicMarkerCreateInitialForm(
  publications: DynamicMarkerCreatePublication[],
  preferredPublicationId = '',
): DynamicMarkerCreateFormState {
  return {
    ...EMPTY_DYNAMIC_MARKER_CREATE_FORM,
    publicationId: initialDynamicMarkerCreatePublicationId(publications, preferredPublicationId),
  }
}

export function parseDynamicMarkerCreatePriceMinor(value: string) {
  const cleaned = cleanText(value).replace(',', '.')
  if (!cleaned) return null
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return Number.NaN
  const numeric = Number(cleaned)
  if (!Number.isFinite(numeric) || numeric < 0) return Number.NaN
  return Math.round(numeric * 100)
}

export function isDynamicMarkerCreateCurrencyAllowed(value: string) {
  return DYNAMIC_MARKER_CREATE_CURRENCY_OPTIONS.includes(cleanText(value).toUpperCase() as typeof DYNAMIC_MARKER_CREATE_CURRENCY_OPTIONS[number])
}

export function isDynamicMarkerCreateAvailabilityAllowed(value: string) {
  return DYNAMIC_MARKER_CREATE_AVAILABILITY_OPTIONS.includes(cleanText(value) as typeof DYNAMIC_MARKER_CREATE_AVAILABILITY_OPTIONS[number])
}

export function validateDynamicMarkerCreateForm(
  form: DynamicMarkerCreateFormState,
  publications: DynamicMarkerCreatePublication[],
): DynamicMarkerCreateValidation {
  const errors: DynamicMarkerCreateValidation['errors'] = {}

  if (!publications.length) {
    errors.publications = DYNAMIC_MARKER_CREATE_NO_PUBLICATIONS
  } else if (!cleanText(form.publicationId)) {
    errors.publicationId = DYNAMIC_MARKER_CREATE_PUBLICATION_REQUIRED
  } else if (!publications.some((publication) => publication.id === form.publicationId)) {
    errors.publicationId = DYNAMIC_MARKER_CREATE_PUBLICATION_REQUIRED
  }

  if (!cleanText(form.name)) errors.name = DYNAMIC_MARKER_CREATE_NAME_REQUIRED

  const priceMinor = parseDynamicMarkerCreatePriceMinor(form.price)
  if (Number.isNaN(priceMinor)) errors.price = DYNAMIC_MARKER_CREATE_PRICE_INVALID
  if (!isDynamicMarkerCreateCurrencyAllowed(form.currency)) errors.currency = DYNAMIC_MARKER_CREATE_CURRENCY_INVALID
  if (!isDynamicMarkerCreateAvailabilityAllowed(form.availability)) errors.availability = DYNAMIC_MARKER_CREATE_AVAILABILITY_INVALID

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  }
}

export function dynamicMarkerCreateMediaTypeFromFile(file: Pick<File, 'type' | 'name'>): DynamicMarkerCreateMediaType | null {
  if (file.type.startsWith('image/')) {
    return DYNAMIC_MARKER_CREATE_MEDIA_UPLOAD_CONFIG.image.accept.split(',').includes(file.type) ? 'image' : null
  }
  if (file.type.startsWith('video/')) {
    return DYNAMIC_MARKER_CREATE_MEDIA_UPLOAD_CONFIG.video.accept.split(',').includes(file.type) ? 'video' : null
  }
  if (file.type.startsWith('audio/')) {
    return DYNAMIC_MARKER_CREATE_MEDIA_UPLOAD_CONFIG.audio.accept.split(',').includes(file.type) ? 'audio' : null
  }

  const name = file.name.toLowerCase()
  if (/\.(jpe?g|png|webp|gif|svg)$/.test(name)) return 'image'
  if (/\.(mp4|webm|mov)$/.test(name)) return 'video'
  if (/\.(mp3|wav|m4a|ogg)$/.test(name)) return 'audio'
  return null
}

export function buildDynamicMarkerCreateMediaJson(media: DynamicMarkerCreateUploadedMedia[]) {
  return media
    .filter((item) => item.url.trim())
    .map((item, index) => ({
      id: item.id,
      type: item.type,
      url: item.url.trim(),
      title: optionalText(item.title),
      alt: optionalText(item.alt),
      sort_order: index,
      visibility: 'public',
    }))
}

export function withDynamicMarkerCreateMedia(
  input: CreateIndependentDynamicMarkerInput,
  media: DynamicMarkerCreateUploadedMedia[],
): CreateIndependentDynamicMarkerInput {
  const mediaJson = buildDynamicMarkerCreateMediaJson(media)
  if (!mediaJson.length) return input
  return {
    ...input,
    media_json: mediaJson,
  }
}

export function withDynamicMarkerCreateMediaItems(
  input: CreateIndependentDynamicMarkerInput,
  media: DynamicMarkerMediaItem[],
): CreateIndependentDynamicMarkerInput {
  const mediaJson = normalizeDynamicMarkerMediaItems(media)
  if (!mediaJson.length) return input
  return {
    ...input,
    media_json: mediaJson,
  }
}

export function buildDynamicMarkerCreateIndependentInput(
  form: DynamicMarkerCreateFormState,
  publications: DynamicMarkerCreatePublication[],
): CreateIndependentDynamicMarkerInput {
  const validation = validateDynamicMarkerCreateForm(form, publications)
  if (!validation.valid) {
    throw new Error(Object.values(validation.errors)[0] ?? DYNAMIC_MARKER_CREATE_GENERIC_ERROR)
  }

  const priceMinor = parseDynamicMarkerCreatePriceMinor(form.price)
  const input: CreateIndependentDynamicMarkerInput = {
    publication_id: cleanText(form.publicationId),
    name: cleanText(form.name),
  }

  const reference = optionalText(form.reference)
  const category = optionalText(form.category)
  const description = optionalText(form.description)
  const currency = optionalText(form.currency)
  const availability = optionalText(form.availability)
  const accentColor = optionalText(form.accentColor)

  if (reference !== undefined) input.reference = reference
  if (category !== undefined) input.category = category
  if (description !== undefined) input.description = description
  if (priceMinor !== null && !Number.isNaN(priceMinor)) input.price_minor = priceMinor
  if (currency !== undefined) input.currency = currency.toUpperCase()
  if (availability !== undefined) input.availability = availability
  if (accentColor !== undefined) input.accent_color = accentColor

  return input
}

export function dynamicMarkerCreateCanSubmit(
  saving: boolean,
  form: DynamicMarkerCreateFormState,
  publications: DynamicMarkerCreatePublication[],
) {
  return !saving && validateDynamicMarkerCreateForm(form, publications).valid
}

export function catalogItemFromIndependentDynamicMarker(
  marker: DynamicMarker,
  publicationTitle: string | null,
): DynamicMarkerCatalogItem {
  const usageCount = Number(marker.usage_count ?? 0)
  return {
    id: marker.id,
    publication_id: marker.publication_id,
    publication_title: publicationTitle,
    page_id: marker.page_id,
    page_number: null,
    target_object_id: marker.target_object_id,
    target_kind: marker.target_kind,
    status: marker.status,
    name: marker.name,
    reference: marker.reference,
    category: marker.category,
    price_minor: marker.price_minor,
    currency: marker.currency,
    availability: marker.availability,
    cover_url: getDynamicMarkerThumbnail(marker.media_json),
    usage_count: usageCount,
    is_in_use: usageCount > 0 || Boolean(marker.is_in_use),
    booking_calendar: null,
    updated_at: marker.updated_at,
  }
}

export function mergeCreatedDynamicMarkerCatalogItem(
  items: DynamicMarkerCatalogItem[],
  created: DynamicMarkerCatalogItem,
  limit: number,
) {
  return [created, ...items.filter((item) => item.id !== created.id)].slice(0, Math.max(1, limit))
}

export function isDynamicMarkerCatalogItemDimmed(item: Pick<DynamicMarkerCatalogItem, 'usage_count' | 'is_in_use'>) {
  return (item.usage_count ?? 0) > 0 || Boolean(item.is_in_use)
}

export function dynamicMarkerCreateSuccessPlan(createdId: string) {
  return {
    pageIndex: 0,
    cursorHistory: [null] as Array<string | null>,
    activeQuery: '',
    status: '',
    selectedId: createdId,
    shouldRefreshCatalog: true,
  }
}
