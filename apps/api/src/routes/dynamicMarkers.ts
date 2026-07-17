import { Hono } from 'hono'
import { jwtMiddleware } from '../middleware/jwt'
import type { Env } from '../index'
import type { AuthVariables } from '../middleware/jwt'

type Variables = AuthVariables

const dynamicMarkers = new Hono<{ Bindings: Env; Variables: Variables }>()

dynamicMarkers.use('*', jwtMiddleware)

const STATUSES = ['draft', 'active', 'inactive'] as const
type DynamicMarkerStatus = typeof STATUSES[number]
const VISIBILITIES = ['public', 'internal'] as const
const CUSTOM_FIELD_TYPES = ['text', 'number', 'boolean', 'date', 'url', 'email', 'phone'] as const
const MEDIA_TYPES = ['image', 'video', 'audio'] as const
const OFFER_CTA_TARGETS = ['', 'contact_whatsapp', 'external_link', 'share'] as const

type CreateInput = {
  publication_id?: unknown
  page_id?: unknown
  target_object_id?: unknown
  target_kind?: unknown
}

type ReuseInput = {
  target_marker_id?: unknown
  name?: unknown
  reference?: unknown
}

type UpdateInput = {
  status?: unknown
  name?: unknown
  reference?: unknown
  category?: unknown
  description?: unknown
  price_minor?: unknown
  previous_price_minor?: unknown
  currency?: unknown
  availability?: unknown
  promotion_text?: unknown
  accent_color?: unknown
  badge_text?: unknown
  promotion_ends_at?: unknown
  post_promotion_price_minor?: unknown
  colors_json?: unknown
  materials_json?: unknown
  sizes_json?: unknown
  measurements_json?: unknown
  media_json?: unknown
  actions_json?: unknown
  custom_fields_json?: unknown
  target_kind?: unknown
}

type DynamicMarkerRow = {
  id: string
  user_id: string
  publication_id: string
  page_id: string
  target_object_id: string
  target_kind: string | null
  status: DynamicMarkerStatus
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
  colors_json: string
  materials_json: string
  sizes_json: string
  measurements_json: string
  media_json: string
  actions_json: string
  custom_fields_json: string
  cloned_from_marker_id: string | null
  created_at: string
  updated_at: string
}

type DynamicMarkerCatalogRow = {
  id: string
  publication_id: string
  publication_title: string | null
  publication_cover_url: string | null
  first_page_image_url: string | null
  page_id: string
  page_number: number | null
  target_object_id: string
  target_kind: string | null
  status: DynamicMarkerStatus
  name: string | null
  reference: string | null
  category: string | null
  price_minor: number | null
  currency: string | null
  availability: string | null
  updated_at: string
}

const MARKER_COLUMNS = `
  id,
  user_id,
  publication_id,
  page_id,
  target_object_id,
  target_kind,
  status,
  name,
  reference,
  category,
  description,
  price_minor,
  previous_price_minor,
  currency,
  availability,
  promotion_text,
  accent_color,
  badge_text,
  promotion_ends_at,
  post_promotion_price_minor,
  colors_json,
  materials_json,
  sizes_json,
  measurements_json,
  media_json,
  actions_json,
  custom_fields_json,
  cloned_from_marker_id,
  created_at,
  updated_at
`

function hasOwn(body: Record<string, unknown>, field: string) {
  return Object.prototype.hasOwnProperty.call(body, field)
}

function cleanText(value: unknown, field: string, max = 500): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${field} debe ser texto`)
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > max) throw new Error(`${field} no puede exceder ${max} caracteres`)
  return trimmed
}

function cleanRequiredText(value: unknown, field: string, max = 160): string {
  const cleaned = cleanText(value, field, max)
  if (!cleaned) throw new Error(`${field} es requerido`)
  return cleaned
}

function cleanStatus(value: unknown): DynamicMarkerStatus {
  if (typeof value !== 'string' || !STATUSES.includes(value as DynamicMarkerStatus)) {
    throw new Error('status debe ser draft, active o inactive')
  }
  return value as DynamicMarkerStatus
}

function cleanMoneyMinor(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${field} debe ser un entero mayor o igual a 0`)
  }
  return value
}

function cleanCurrency(value: unknown): string | null {
  const currency = cleanText(value, 'currency', 3)
  if (!currency) return null
  const upper = currency.toUpperCase()
  if (!/^[A-Z]{3}$/.test(upper)) throw new Error('currency debe tener tres letras')
  return upper
}

function cleanAccentColor(value: unknown): string {
  const color = cleanText(value, 'accent_color', 7)
  if (!color) return '#F59E0B'
  const upper = color.toUpperCase()
  if (!/^#[0-9A-F]{6}$/.test(upper)) throw new Error('accent_color debe usar formato #RRGGBB')
  return upper
}

function cleanIsoDateTime(value: unknown, field: string): string | null {
  const raw = cleanText(value, field, 40)
  if (!raw) return null
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) throw new Error(`${field} debe ser una fecha valida`)
  return date.toISOString()
}

function cleanUuidText(value: unknown, field: string): string | null {
  const cleaned = cleanText(value, field, 80)
  if (!cleaned) return null
  return cleaned
}

function cleanCatalogLimit(value: unknown): number {
  if (value === undefined || value === null || value === '') return 24
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return 24
  return Math.min(Math.max(parsed, 1), 50)
}

function cleanCatalogCursor(value: unknown) {
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

function parseJsonInput(value: unknown, field: string, maxLength = 50000): unknown {
  if (value === undefined || value === null || value === '') return '[]'
  if (typeof value === 'string') {
    if (value.length > maxLength) throw new Error(`${field} no puede exceder ${maxLength} caracteres`)
    try {
      return JSON.parse(value)
    } catch {
      throw new Error(`${field} debe ser JSON valido`)
    }
  }
  return value
}

function parseJsonArrayInput(value: unknown, field: string, maxLength = 50000): unknown[] {
  const parsed = value === undefined || value === null || value === ''
    ? []
    : parseJsonInput(value, field, maxLength)
  if (!Array.isArray(parsed)) throw new Error(`${field} debe ser un array JSON valido`)
  return parsed
}

function parseJsonObjectInput(value: unknown, field: string, maxLength = 50000): Record<string, unknown> {
  const parsed = value === undefined || value === null || value === ''
    ? {}
    : parseJsonInput(value, field, maxLength)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${field} debe ser un objeto JSON valido`)
  }
  return parsed as Record<string, unknown>
}

function requiredString(value: unknown, field: string, index: number, max = 500): string {
  if (typeof value !== 'string') throw new Error(`${field}[${index}] debe tener texto valido`)
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${field}[${index}] debe tener texto valido`)
  if (trimmed.length > max) throw new Error(`${field}[${index}] no puede exceder ${max} caracteres`)
  return trimmed
}

function optionalString(value: unknown, field: string, index: number, max = 500): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`${field}[${index}] debe tener texto valido`)
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.length > max) throw new Error(`${field}[${index}] no puede exceder ${max} caracteres`)
  return trimmed
}

function optionalBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function optionalSortOrder(value: unknown, index: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : index
}

function cleanId(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : crypto.randomUUID()
}

function assertObject(item: unknown, field: string, index: number): Record<string, unknown> {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error(`${field}[${index}] debe ser un objeto`)
  }
  return item as Record<string, unknown>
}

function cleanVisibility(value: unknown, field: string, index: number) {
  if (value === undefined || value === null || value === '') return 'public'
  if (typeof value !== 'string' || !VISIBILITIES.includes(value as any)) {
    throw new Error(`${field}[${index}].visibility debe ser public o internal`)
  }
  return value
}

function cleanCustomFieldType(value: unknown, field: string, index: number) {
  if (value === undefined || value === null || value === '') return 'text'
  if (typeof value !== 'string' || !CUSTOM_FIELD_TYPES.includes(value as any)) {
    throw new Error(`${field}[${index}].type no es valido`)
  }
  return value
}

function cleanUrl(value: unknown, field: string, index: number, required: boolean): string | undefined {
  const url = required
    ? requiredString(value, field, index, 2000)
    : optionalString(value, field, index, 2000)
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
  } catch {
    throw new Error(`${field}[${index}] debe ser una URL valida`)
  }
  return url
}

function cleanColors(value: unknown): string {
  const items = parseJsonArrayInput(value, 'colors_json')
  return JSON.stringify(items.map((item, index) => {
    const color = assertObject(item, 'colors_json', index)
    const name = requiredString(color.name, 'colors_json.name', index, 160)
    const hex = requiredString(color.hex, 'colors_json.hex', index, 7)
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`colors_json[${index}].hex debe usar formato #RRGGBB`)
    if (typeof color.available !== 'boolean') throw new Error(`colors_json[${index}].available debe ser booleano`)
    return {
      id: cleanId(color.id),
      name,
      hex,
      available: color.available,
      sort_order: optionalSortOrder(color.sort_order, index),
    }
  }))
}

function cleanMaterials(value: unknown): string {
  const items = parseJsonArrayInput(value, 'materials_json')
  return JSON.stringify(items.map((item, index) => {
    const material = assertObject(item, 'materials_json', index)
    return {
      id: cleanId(material.id),
      name: requiredString(material.name, 'materials_json.name', index, 160),
      available: optionalBoolean(material.available, true),
      sort_order: optionalSortOrder(material.sort_order, index),
    }
  }))
}

function cleanSizes(value: unknown): string {
  const items = parseJsonArrayInput(value, 'sizes_json')
  return JSON.stringify(items.map((item, index) => {
    const size = assertObject(item, 'sizes_json', index)
    return {
      id: cleanId(size.id),
      label: requiredString(size.label, 'sizes_json.label', index, 160),
      value: optionalString(size.value, 'sizes_json.value', index, 160) ?? '',
      available: optionalBoolean(size.available, true),
      sort_order: optionalSortOrder(size.sort_order, index),
    }
  }))
}

function cleanMeasurements(value: unknown): string {
  const items = parseJsonArrayInput(value, 'measurements_json')
  return JSON.stringify(items.map((item, index) => {
    const measurement = assertObject(item, 'measurements_json', index)
    return {
      id: cleanId(measurement.id),
      label: requiredString(measurement.label, 'measurements_json.label', index, 160),
      value: requiredString(measurement.value, 'measurements_json.value', index, 160),
      unit: optionalString(measurement.unit, 'measurements_json.unit', index, 80) ?? '',
      sort_order: optionalSortOrder(measurement.sort_order, index),
    }
  }))
}

function cleanMedia(value: unknown): string {
  const items = parseJsonArrayInput(value, 'media_json')
  return JSON.stringify(items.map((item, index) => {
    const media = assertObject(item, 'media_json', index)
    if (typeof media.type !== 'string' || !MEDIA_TYPES.includes(media.type as any)) {
      throw new Error(`media_json[${index}].type debe ser image, video o audio`)
    }
    const cleaned: Record<string, unknown> = {
      id: cleanId(media.id),
      type: media.type,
      url: cleanUrl(media.url, 'media_json.url', index, true),
      visibility: cleanVisibility(media.visibility, 'media_json', index),
      sort_order: optionalSortOrder(media.sort_order, index),
    }
    const thumbnailUrl = cleanUrl(media.thumbnail_url, 'media_json.thumbnail_url', index, false)
    if (thumbnailUrl) cleaned.thumbnail_url = thumbnailUrl
    const title = optionalString(media.title, 'media_json.title', index, 200)
    if (title) cleaned.title = title
    const alt = optionalString(media.alt, 'media_json.alt', index, 300)
    if (alt) cleaned.alt = alt
    return cleaned
  }))
}

function requireObjectProperty(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} debe ser un objeto`)
  return value as Record<string, unknown>
}

function cleanContactWhatsAppAction(value: unknown, field: string): Record<string, unknown> {
  const whatsapp = requireObjectProperty(value, field)
  const enabled = typeof whatsapp.enabled === 'boolean' ? whatsapp.enabled : false
  const phone = typeof whatsapp.phone === 'string' ? whatsapp.phone.trim() : ''
  if (enabled && !phone) throw new Error(`${field}.phone es requerido cuando Contactar vendedor esta activo`)
  return {
    enabled,
    phone,
    label: typeof whatsapp.label === 'string' && whatsapp.label.trim() ? whatsapp.label.trim() : 'Contactar vendedor',
    message_template: typeof whatsapp.message_template === 'string' ? whatsapp.message_template : '',
  }
}

function cleanActions(value: unknown): string {
  const actions = parseJsonObjectInput(value, 'actions_json')
  const cleaned: Record<string, unknown> = {}

  if (actions.contact_whatsapp !== undefined) {
    cleaned.contact_whatsapp = cleanContactWhatsAppAction(actions.contact_whatsapp, 'actions_json.contact_whatsapp')
  } else if (actions.whatsapp !== undefined) {
    cleaned.contact_whatsapp = cleanContactWhatsAppAction(actions.whatsapp, 'actions_json.whatsapp')
  }
  if (actions.external_link !== undefined) {
    const externalLink = requireObjectProperty(actions.external_link, 'actions_json.external_link')
    const enabled = typeof externalLink.enabled === 'boolean' ? externalLink.enabled : false
    const label = typeof externalLink.label === 'string' ? externalLink.label.trim() : ''
    const url = typeof externalLink.url === 'string' ? externalLink.url.trim() : ''
    if (enabled && !label) throw new Error('actions_json.external_link.label es requerido cuando el enlace externo esta activo')
    if (enabled) cleanUrl(url, 'actions_json.external_link.url', 0, true)
    cleaned.external_link = { enabled, label, url }
  }
  if (actions.share !== undefined) {
    const share = requireObjectProperty(actions.share, 'actions_json.share')
    cleaned.share = {
      enabled: typeof share.enabled === 'boolean'
        ? share.enabled
        : Boolean(share.whatsapp || share.facebook || share.copy_link || share.native),
      label: typeof share.label === 'string' && share.label.trim() ? share.label.trim() : 'Compartir',
      whatsapp: typeof share.whatsapp === 'boolean' ? share.whatsapp : false,
      facebook: typeof share.facebook === 'boolean' ? share.facebook : false,
      x: typeof share.x === 'boolean' ? share.x : false,
      copy_link: typeof share.copy_link === 'boolean' ? share.copy_link : false,
      native: typeof share.native === 'boolean' ? share.native : false,
    }
    const instagramUrl = cleanUrl(share.instagram_url, 'actions_json.share.instagram_url', 0, false)
    if (instagramUrl) cleaned.share = { ...(cleaned.share as Record<string, unknown>), instagram_url: instagramUrl }
  }
  if (actions.offer_cta !== undefined) {
    const offerCta = requireObjectProperty(actions.offer_cta, 'actions_json.offer_cta')
    const target = typeof offerCta.target === 'string' && (OFFER_CTA_TARGETS as readonly string[]).includes(offerCta.target)
      ? offerCta.target
      : ''
    const preset = typeof offerCta.preset === 'string' ? offerCta.preset.trim().slice(0, 80) : ''
    const customLabel = typeof offerCta.custom_label === 'string' ? offerCta.custom_label.trim().slice(0, 80) : ''
    cleaned.offer_cta = { target, preset, custom_label: customLabel }
  }

  return JSON.stringify(cleaned)
}

function cleanCustomFields(value: unknown): string {
  const items = parseJsonArrayInput(value, 'custom_fields_json', 20000)
  const cleaned = items.reduce<Array<Record<string, unknown>>>((fields, item, index) => {
    const field = assertObject(item, 'custom_fields_json', index)
    const label = optionalString(field.label, 'custom_fields_json.label', index, 160) ?? ''
    const fieldValue = optionalString(field.value, 'custom_fields_json.value', index, 2000) ?? ''
    if (!label && !fieldValue) return fields
    fields.push({
      id: cleanId(field.id),
      label,
      value: fieldValue,
      type: cleanCustomFieldType(field.type, 'custom_fields_json', index),
      visibility: cleanVisibility(field.visibility, 'custom_fields_json', index),
      searchable: typeof field.searchable === 'boolean' ? field.searchable : false,
      filterable: typeof field.filterable === 'boolean' ? field.filterable : false,
      sort_order: optionalSortOrder(field.sort_order, fields.length),
    })
    return fields
  }, [])
  return JSON.stringify(cleaned)
}

function cloneMediaWithNewIds(value: unknown): string {
  const items = JSON.parse(cleanMedia(value)) as Array<Record<string, unknown>>
  return JSON.stringify(items.map((item) => ({
    ...item,
    id: crypto.randomUUID(),
  })))
}

function cloneCustomFieldsWithNewIds(value: unknown): string {
  const items = JSON.parse(cleanCustomFields(value)) as Array<Record<string, unknown>>
  return JSON.stringify(items.map((item) => ({
    ...item,
    id: crypto.randomUUID(),
  })))
}

function cleanReuseOfferCta(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  const offerCta = requireObjectProperty(value, 'actions_json.offer_cta')
  const target = typeof offerCta.target === 'string' ? offerCta.target.trim() : ''
  const preset = typeof offerCta.preset === 'string' ? offerCta.preset.trim().slice(0, 80) : ''
  const customLabel = typeof offerCta.custom_label === 'string' ? offerCta.custom_label.trim().slice(0, 80) : ''

  return { target, preset, custom_label: customLabel }
}

function actionIsEnabled(actions: Record<string, unknown>, key: string) {
  const action = actions[key]
  if (!action || typeof action !== 'object' || Array.isArray(action)) return false
  const data = action as Record<string, unknown>
  if (data.enabled !== true) return false

  if (key === 'contact_whatsapp') {
    return typeof data.phone === 'string' && Boolean(data.phone.trim())
  }
  if (key === 'external_link') {
    return (
      typeof data.label === 'string'
      && Boolean(data.label.trim())
      && typeof data.url === 'string'
      && Boolean(data.url.trim())
    )
  }

  return key === 'share'
}

function normalizeOfferCtaForFinalActions(actions: Record<string, unknown>) {
  const offerCta = actions.offer_cta
  if (!offerCta || typeof offerCta !== 'object' || Array.isArray(offerCta)) return
  const current = offerCta as Record<string, unknown>
  const target = typeof current.target === 'string' ? current.target : ''

  if (!target) return
  if (!['contact_whatsapp', 'external_link', 'share'].includes(target) || !actionIsEnabled(actions, target)) {
    actions.offer_cta = {
      ...current,
      target: '',
    }
  }
}

function buildReuseActions(source: DynamicMarkerRow, target: DynamicMarkerRow): string {
  const rawSourceActions = parseJsonObjectInput(source.actions_json, 'actions_json')
  const sourceActions = JSON.parse(cleanActions({
    contact_whatsapp: rawSourceActions.contact_whatsapp ?? rawSourceActions.whatsapp,
    external_link: rawSourceActions.external_link,
    share: rawSourceActions.share,
  })) as Record<string, unknown>
  const combined: Record<string, unknown> = {}

  for (const key of ['contact_whatsapp', 'external_link', 'share']) {
    if (sourceActions[key] !== undefined) combined[key] = sourceActions[key]
  }

  const offerCta = cleanReuseOfferCta(rawSourceActions.offer_cta)
  if (offerCta) combined.offer_cta = offerCta



  normalizeOfferCtaForFinalActions(combined)
  return JSON.stringify(combined)
}

function dbError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (message.toLowerCase().includes('unique')) {
    return { status: 409, error: 'Ya existe una ficha para este objeto o area en esta pagina' }
  }
  if (message.toLowerCase().includes('check')) {
    return { status: 400, error: 'Los datos de la ficha no cumplen las reglas de validacion' }
  }
  return { status: 500, error: 'Error al guardar ficha dinamica' }
}

async function ownedPublication(db: D1Database, publicationId: string, userId: string) {
  return db.prepare(
    `SELECT id FROM publications WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
  ).bind(publicationId, userId).first<{ id: string }>()
}

async function pageInPublication(db: D1Database, pageId: string, publicationId: string) {
  return db.prepare(
    `SELECT id FROM pages WHERE id = ? AND publication_id = ?`,
  ).bind(pageId, publicationId).first<{ id: string }>()
}

async function ownedMarker(db: D1Database, markerId: string, userId: string) {
  return db.prepare(
    `SELECT dm.*
     FROM dynamic_markers dm
     JOIN publications p ON p.id = dm.publication_id
     WHERE dm.id = ? AND p.user_id = ? AND p.deleted_at IS NULL`,
  ).bind(markerId, userId).first<DynamicMarkerRow>()
}

async function validatePublicationPage(db: D1Database, publicationId: string, pageId: string, userId: string) {
  const pub = await ownedPublication(db, publicationId, userId)
  if (!pub) throw new Error('Publicacion no encontrada')
  const page = await pageInPublication(db, pageId, publicationId)
  if (!page) throw new Error('Pagina no encontrada para esta publicacion')
}

function selectMarkersSql(where: string) {
  return `SELECT * FROM dynamic_markers ${where} ORDER BY updated_at DESC, created_at DESC`
}

dynamicMarkers.get('/', async (c) => {
  const userId = c.get('user').sub
  const publicationId = c.req.query('publication_id')
  const pageId = c.req.query('page_id')
  if (!publicationId) return c.json({ success: false, error: 'publication_id es requerido' }, 400)

  const pub = await ownedPublication(c.env.DB, publicationId, userId)
  if (!pub) return c.json({ success: false, error: 'Publicacion no encontrada' }, 404)
  if (pageId) {
    const page = await pageInPublication(c.env.DB, pageId, publicationId)
    if (!page) return c.json({ success: false, error: 'Pagina no encontrada para esta publicacion' }, 404)
  }

  const sql = pageId
    ? selectMarkersSql('WHERE publication_id = ? AND page_id = ?')
    : selectMarkersSql('WHERE publication_id = ?')
  const stmt = c.env.DB.prepare(sql)
  const { results } = pageId
    ? await stmt.bind(publicationId, pageId).all<DynamicMarkerRow>()
    : await stmt.bind(publicationId).all<DynamicMarkerRow>()

  return c.json({ success: true, data: results ?? [] })
})

dynamicMarkers.get('/catalog', async (c) => {
  const userId = c.get('user').sub
  const limit = cleanCatalogLimit(c.req.query('limit'))

  let query: string | null = null
  let publicationId: string | null = null
  let status: DynamicMarkerStatus | null = null
  let cursor: { updatedAt: string; id: string }

  try {
    query = cleanText(c.req.query('q'), 'q', 120)
    publicationId = cleanUuidText(c.req.query('publication_id'), 'publication_id')
    const rawStatus = c.req.query('status')
    status = rawStatus ? cleanStatus(rawStatus) : null
    cursor = cleanCatalogCursor(c.req.query('cursor'))
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }

  const filters = ['dm.user_id = ?', 'p.user_id = ?', 'p.deleted_at IS NULL']
  const binds: unknown[] = [userId, userId]

  if (query) {
    const like = `%${query}%`
    filters.push(`(
      LOWER(COALESCE(dm.name, '')) LIKE LOWER(?)
      OR LOWER(COALESCE(dm.reference, '')) LIKE LOWER(?)
      OR LOWER(COALESCE(dm.category, '')) LIKE LOWER(?)
      OR LOWER(COALESCE(p.title, '')) LIKE LOWER(?)
    )`)
    binds.push(like, like, like, like)
  }

  if (status) {
    filters.push('dm.status = ?')
    binds.push(status)
  }

  if (publicationId) {
    filters.push('dm.publication_id = ?')
    binds.push(publicationId)
  }


  if (cursor.updatedAt) {
    filters.push('(dm.updated_at < ? OR (dm.updated_at = ? AND dm.id < ?))')
    binds.push(cursor.updatedAt, cursor.updatedAt, cursor.id)
  }

  const { results } = await c.env.DB.prepare(
    `SELECT
       dm.id,
       dm.publication_id,
       p.title AS publication_title,
       p.cover_image_url AS publication_cover_url,
       (
         SELECT first_pg.image_url
         FROM pages first_pg
         WHERE first_pg.publication_id = dm.publication_id
         ORDER BY first_pg.page_number ASC
         LIMIT 1
       ) AS first_page_image_url,
       dm.page_id,
       pg.page_number,
       dm.target_object_id,
       dm.target_kind,
       dm.status,
       dm.name,
       dm.reference,
       dm.category,
       dm.price_minor,
       dm.currency,
       dm.availability,
       dm.updated_at
     FROM dynamic_markers dm
     JOIN publications p
       ON p.id = dm.publication_id
     LEFT JOIN pages pg
       ON pg.id = dm.page_id
      AND pg.publication_id = dm.publication_id
     WHERE ${filters.join(' AND ')}
     ORDER BY dm.updated_at DESC, dm.id DESC
     LIMIT ?`,
  ).bind(...binds, limit + 1).all<DynamicMarkerCatalogRow>()

  const rows = results ?? []
  const hasMore = rows.length > limit
  const pageRows = rows.slice(0, limit)
  const last = pageRows[pageRows.length - 1]

  const data = pageRows.map((row) => ({
    id: row.id,
    publication_id: row.publication_id,
    publication_title: row.publication_title,
    page_id: row.page_id,
    page_number: row.page_number,
    target_object_id: row.target_object_id,
    target_kind: row.target_kind,
    status: row.status,
    name: row.name,
    reference: row.reference,
    category: row.category,
    price_minor: row.price_minor,
    currency: row.currency,
    availability: row.availability,
    cover_url: row.publication_cover_url || row.first_page_image_url || null,
    updated_at: row.updated_at,
  }))

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

dynamicMarkers.post('/:id/reuse', async (c) => {
  const userId = c.get('user').sub
  const sourceId = c.req.param('id')
  const body = await c.req.json<ReuseInput & Record<string, unknown>>().catch(() => null)
  if (!body || typeof body !== 'object') return c.json({ success: false, error: 'JSON invalido' }, 400)

  let targetMarkerId: string
  let name: string
  let reference: string | null | undefined

  try {
    targetMarkerId = cleanRequiredText(body.target_marker_id, 'target_marker_id', 80)
    name = cleanRequiredText(body.name, 'name', 160)
    reference = hasOwn(body, 'reference')
      ? cleanText(body.reference, 'reference', 120)
      : undefined
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }

  if (sourceId === targetMarkerId) {
    return c.json({ success: false, error: 'La ficha fuente y destino deben ser distintas' }, 400)
  }

  const source = await ownedMarker(c.env.DB, sourceId, userId)
  if (!source) return c.json({ success: false, error: 'Ficha fuente no encontrada para este tenant' }, 404)

  const target = await ownedMarker(c.env.DB, targetMarkerId, userId)
  if (!target) return c.json({ success: false, error: 'Ficha destino no encontrada para este tenant' }, 404)

  if (target.status !== 'draft') {
    return c.json({ success: false, error: 'La ficha destino debe estar en borrador para reutilizar datos' }, 409)
  }

  let colorsJson: string
  let materialsJson: string
  let sizesJson: string
  let measurementsJson: string
  let mediaJson: string
  let customFieldsJson: string
  let actionsJson: string

  try {
    colorsJson = cleanColors(source.colors_json)
    materialsJson = cleanMaterials(source.materials_json)
    sizesJson = cleanSizes(source.sizes_json)
    measurementsJson = cleanMeasurements(source.measurements_json)
    mediaJson = cloneMediaWithNewIds(source.media_json)
    customFieldsJson = cloneCustomFieldsWithNewIds(source.custom_fields_json)
    actionsJson = buildReuseActions(source, target)
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }

  const nextReference = reference === undefined ? target.reference : reference

  try {
    const result = await c.env.DB.prepare(
      `UPDATE dynamic_markers
       SET name = ?,
           reference = ?,
           category = ?,
           description = ?,
           price_minor = ?,
           previous_price_minor = ?,
           currency = ?,
           availability = ?,
           promotion_text = ?,
           badge_text = ?,
           promotion_ends_at = ?,
           post_promotion_price_minor = ?,
           accent_color = ?,
           colors_json = ?,
           materials_json = ?,
           sizes_json = ?,
           measurements_json = ?,
           media_json = ?,
           custom_fields_json = ?,
           actions_json = ?,
           cloned_from_marker_id = ?,
           updated_at = datetime('now')
       WHERE id = ?
         AND user_id = ?
         AND status = 'draft'`,
    ).bind(
      name,
      nextReference,
      source.category,
      source.description,
      source.price_minor,
      source.previous_price_minor,
      source.currency,
      source.availability,
      source.promotion_text,
      source.badge_text,
      source.promotion_ends_at,
      source.post_promotion_price_minor,
      source.accent_color,
      colorsJson,
      materialsJson,
      sizesJson,
      measurementsJson,
      mediaJson,
      customFieldsJson,
      actionsJson,
      source.id,
      target.id,
      userId,
    ).run()

    if ((result.meta?.changes ?? 0) === 0) {
      return c.json({ success: false, error: 'La ficha destino dejó de estar en borrador antes de reutilizar datos' }, 409)
    }
  } catch (error) {
    const result = dbError(error)
    return c.json({ success: false, error: result.error }, result.status as any)
  }

  const updated = await c.env.DB.prepare(
    `SELECT ${MARKER_COLUMNS}
     FROM dynamic_markers
     WHERE id = ? AND user_id = ?`,
  ).bind(target.id, userId).first<DynamicMarkerRow>()

  return c.json({ success: true, data: updated })
})

dynamicMarkers.get('/:id', async (c) => {
  const userId = c.get('user').sub
  const marker = await ownedMarker(c.env.DB, c.req.param('id'), userId)
  if (!marker) return c.json({ success: false, error: 'Ficha dinamica no encontrada' }, 404)
  return c.json({ success: true, data: marker })
})

dynamicMarkers.post('/', async (c) => {
  const userId = c.get('user').sub
  const body = await c.req.json<CreateInput>().catch(() => null)
  if (!body) return c.json({ success: false, error: 'JSON invalido' }, 400)

  let publicationId: string
  let pageId: string
  let targetObjectId: string
  let targetKind: string | null
  try {
    publicationId = cleanRequiredText(body.publication_id, 'publication_id')
    pageId = cleanRequiredText(body.page_id, 'page_id')
    targetObjectId = cleanRequiredText(body.target_object_id, 'target_object_id', 160)
    targetKind = cleanText(body.target_kind, 'target_kind', 80)
    await validatePublicationPage(c.env.DB, publicationId, pageId, userId)
  } catch (error: any) {
    const status = error.message === 'Publicacion no encontrada' || error.message === 'Pagina no encontrada para esta publicacion'
      ? 404
      : 400
    return c.json({ success: false, error: error.message }, status as any)
  }

  const existing = await c.env.DB.prepare(
    `SELECT id FROM dynamic_markers
     WHERE publication_id = ? AND page_id = ? AND target_object_id = ?
     LIMIT 1`,
  ).bind(publicationId, pageId, targetObjectId).first<{ id: string }>()
  if (existing) {
    return c.json({ success: false, error: 'Ya existe una ficha para este objeto o area en esta pagina' }, 409)
  }

  const id = crypto.randomUUID()
  try {
    await c.env.DB.prepare(
      `INSERT INTO dynamic_markers (
        id, user_id, publication_id, page_id, target_object_id, target_kind,
        status, custom_fields_json
       ) VALUES (?, ?, ?, ?, ?, ?, 'draft', '[]')`,
    ).bind(id, userId, publicationId, pageId, targetObjectId, targetKind).run()
  } catch (error) {
    const result = dbError(error)
    return c.json({ success: false, error: result.error }, result.status as any)
  }

  const created = await c.env.DB.prepare(`SELECT * FROM dynamic_markers WHERE id = ?`).bind(id).first<DynamicMarkerRow>()
  return c.json({ success: true, data: created }, 201)
})

dynamicMarkers.put('/:id', async (c) => {
  const userId = c.get('user').sub
  const markerId = c.req.param('id')
  const existing = await ownedMarker(c.env.DB, markerId, userId)
  if (!existing) return c.json({ success: false, error: 'Ficha dinamica no encontrada' }, 404)

  const body = await c.req.json<UpdateInput & Record<string, unknown>>().catch(() => null)
  if (!body || typeof body !== 'object') return c.json({ success: false, error: 'JSON invalido' }, 400)

  const updates: string[] = []
  const values: unknown[] = []
  const addUpdate = (column: string, value: unknown) => {
    updates.push(`${column} = ?`)
    values.push(value)
  }

  let nextName = existing.name
  let nextStatus = existing.status
  let nextActionsJson = existing.actions_json

  try {
    if (hasOwn(body, 'name')) {
      nextName = cleanText(body.name, 'name', 160)
      addUpdate('name', nextName)
    }
    if (hasOwn(body, 'reference')) addUpdate('reference', cleanText(body.reference, 'reference', 120))
    if (hasOwn(body, 'category')) addUpdate('category', cleanText(body.category, 'category', 120))
    if (hasOwn(body, 'description')) addUpdate('description', cleanText(body.description, 'description', 2000))
    if (hasOwn(body, 'price_minor')) addUpdate('price_minor', cleanMoneyMinor(body.price_minor, 'price_minor'))
    if (hasOwn(body, 'previous_price_minor')) addUpdate('previous_price_minor', cleanMoneyMinor(body.previous_price_minor, 'previous_price_minor'))
    if (hasOwn(body, 'currency')) addUpdate('currency', cleanCurrency(body.currency))
    if (hasOwn(body, 'availability')) addUpdate('availability', cleanText(body.availability, 'availability', 80))
    if (hasOwn(body, 'promotion_text')) addUpdate('promotion_text', cleanText(body.promotion_text, 'promotion_text', 200))
    if (hasOwn(body, 'accent_color')) addUpdate('accent_color', cleanAccentColor(body.accent_color))
    if (hasOwn(body, 'badge_text')) addUpdate('badge_text', cleanText(body.badge_text, 'badge_text', 80))
    if (hasOwn(body, 'promotion_ends_at')) addUpdate('promotion_ends_at', cleanIsoDateTime(body.promotion_ends_at, 'promotion_ends_at'))
    if (hasOwn(body, 'post_promotion_price_minor')) addUpdate('post_promotion_price_minor', cleanMoneyMinor(body.post_promotion_price_minor, 'post_promotion_price_minor'))
    if (hasOwn(body, 'target_kind')) addUpdate('target_kind', cleanText(body.target_kind, 'target_kind', 80))
    if (hasOwn(body, 'colors_json')) addUpdate('colors_json', cleanColors(body.colors_json))
    if (hasOwn(body, 'materials_json')) addUpdate('materials_json', cleanMaterials(body.materials_json))
    if (hasOwn(body, 'sizes_json')) addUpdate('sizes_json', cleanSizes(body.sizes_json))
    if (hasOwn(body, 'measurements_json')) addUpdate('measurements_json', cleanMeasurements(body.measurements_json))
    if (hasOwn(body, 'media_json')) addUpdate('media_json', cleanMedia(body.media_json))
    if (hasOwn(body, 'actions_json')) {
      nextActionsJson = cleanActions(body.actions_json)
      addUpdate('actions_json', nextActionsJson)
    }
    if (hasOwn(body, 'custom_fields_json')) addUpdate('custom_fields_json', cleanCustomFields(body.custom_fields_json))
    if (hasOwn(body, 'status')) {
      nextStatus = cleanStatus(body.status)
      addUpdate('status', nextStatus)
    }
    if (nextStatus === 'active' && !nextName?.trim()) {
      return c.json({ success: false, error: 'name es requerido para activar la ficha' }, 400)
    }
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }

  updates.push(`updated_at = datetime('now')`)
  try {
    await c.env.DB.prepare(
      `UPDATE dynamic_markers SET ${updates.join(', ')} WHERE id = ?`,
    ).bind(...values, markerId).run()
  } catch (error) {
    const result = dbError(error)
    return c.json({ success: false, error: result.error }, result.status as any)
  }

  const updated = await c.env.DB.prepare(`SELECT * FROM dynamic_markers WHERE id = ?`).bind(markerId).first<DynamicMarkerRow>()
  return c.json({ success: true, data: updated })
})

dynamicMarkers.patch('/:id/status', async (c) => {
  const userId = c.get('user').sub
  const markerId = c.req.param('id')
  const existing = await ownedMarker(c.env.DB, markerId, userId)
  if (!existing) return c.json({ success: false, error: 'Ficha dinamica no encontrada' }, 404)

  const body = await c.req.json<{ status?: unknown }>().catch(() => null)
  if (!body) return c.json({ success: false, error: 'JSON invalido' }, 400)

  let status: DynamicMarkerStatus
  try {
    status = cleanStatus(body.status)
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }

  if (status === 'active' && !existing.name?.trim()) {
    return c.json({ success: false, error: 'name es requerido para activar la ficha' }, 400)
  }

  await c.env.DB.prepare(
    `UPDATE dynamic_markers SET status = ?, updated_at = datetime('now') WHERE id = ?`,
  ).bind(status, markerId).run()

  const updated = await c.env.DB.prepare(`SELECT * FROM dynamic_markers WHERE id = ?`).bind(markerId).first<DynamicMarkerRow>()
  return c.json({ success: true, data: updated })
})

export default dynamicMarkers
