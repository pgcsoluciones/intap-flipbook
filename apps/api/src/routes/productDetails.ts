import { Hono } from 'hono'
import { jwtMiddleware } from '../middleware/jwt'
import type { Env } from '../index'
import type { AuthVariables } from '../middleware/jwt'
import { countOpenProductDetailReferences, parseCanvasJson } from '../lib/productDetailsCanvas'

type Variables = AuthVariables

const productDetails = new Hono<{ Bindings: Env; Variables: Variables }>()

productDetails.use('*', jwtMiddleware)

const STATUSES = ['active', 'inactive'] as const
type ProductDetailStatus = typeof STATUSES[number]

type ProductDetailRow = {
  id: number
  tenant_id: string
  internal_name: string
  title: string
  description: string | null
  price: string | null
  image_url: string | null
  accent_color: string
  cta_type: string | null
  cta_label: string | null
  cta_target: string | null
  status: ProductDetailStatus
  created_at: string
  updated_at: string
}

type ProductDetailResponse = ProductDetailRow & {
  usage_count: number
}

type ProductDetailInput = {
  row?: unknown
  import_decision?: unknown
  existing_id?: unknown
  internal_name?: unknown
  title?: unknown
  description?: unknown
  price?: unknown
  image_url?: unknown
  accent_color?: unknown
  cta_type?: unknown
  cta_label?: unknown
  cta_target?: unknown
  status?: unknown
}

type ProductDetailImportDecision = 'replace' | 'keep' | 'skip'
type CleanProductDetailInput = ReturnType<typeof cleanProductDetailInput>

type ProductDetailImportDuplicate = {
  row: number
  internal_name: string
  title: string
  existing_id: number
  existing_internal_name: string
  existing_title: string
  match_fields: string[]
  changes: Array<{ field: string; current: string | null; incoming: string | null }>
}

const PRODUCT_DETAIL_COLUMNS = `
  id,
  tenant_id,
  internal_name,
  title,
  description,
  price,
  image_url,
  accent_color,
  cta_type,
  cta_label,
  cta_target,
  status,
  created_at,
  updated_at
`

const CTA_TYPES = ['whatsapp', 'enlace_externo', 'llamar', 'correo'] as const
type ProductDetailCtaType = typeof CTA_TYPES[number]

const CTA_ALIASES: Record<string, ProductDetailCtaType | null> = {
  sin_accion: null,
  none: null,
  '': null,
  whatsapp: 'whatsapp',
  enlace_externo: 'enlace_externo',
  external_url: 'enlace_externo',
  url: 'enlace_externo',
  link: 'enlace_externo',
  llamar: 'llamar',
  phone: 'llamar',
  call: 'llamar',
  correo: 'correo',
  email: 'correo',
  mailto: 'correo',
}

const DEFAULT_CTA_LABEL: Record<ProductDetailCtaType, string> = {
  whatsapp: 'Escribir por WhatsApp',
  enlace_externo: 'Ver mas',
  llamar: 'Llamar',
  correo: 'Enviar correo',
}

const IMPORT_TEXT_FIELDS: Array<keyof ProductDetailInput> = [
  'internal_name',
  'title',
  'description',
  'price',
  'image_url',
  'cta_label',
  'cta_target',
]

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

function startsLikeFormula(value: string): boolean {
  return /^[=+\-@]/.test(value.trimStart())
}

function cleanProductDetailPricePrefix(value: string): string {
  return value.replace(/^(?:(?:dop|rd)\$?\s*)+/i, '').replace(/\s+/g, ' ').trim()
}

function rejectImportFormulaText(row: ProductDetailInput) {
  for (const field of IMPORT_TEXT_FIELDS) {
    const value = row[field]
    if (typeof value === 'string' && startsLikeFormula(value)) {
      throw new Error(`${String(field)} no puede iniciar con =, +, - o @`)
    }
  }
}

function importCtaAlias(value: unknown): ProductDetailCtaType | null | undefined {
  if (typeof value !== 'string') return null
  return CTA_ALIASES[value.trim().toLowerCase()]
}

function enforceImportOnlyRules(row: ProductDetailInput) {
  rejectImportFormulaText(row)
  const ctaType = importCtaAlias(row.cta_type)
  if (ctaType === 'enlace_externo' && typeof row.cta_target === 'string') {
    try {
      const parsed = new URL(row.cta_target.trim())
      if (parsed.protocol !== 'https:') throw new Error()
    } catch {
      throw new Error('cta_target debe ser una URL HTTPS valida para importacion')
    }
  }
}

function cleanPriceText(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('price debe ser un numero valido')
    return String(value)
  }
  const price = cleanText(value, 'price', 80)
  if (!price) return null
  if (startsLikeFormula(price)) throw new Error('price no puede iniciar con =, +, - o @')
  if (/[<>]/.test(price)) throw new Error('price no puede contener HTML')
  const cleaned = cleanProductDetailPricePrefix(price)
  if (!cleaned) return null
  if (startsLikeFormula(cleaned)) throw new Error('price no puede iniciar con =, +, - o @')
  return cleaned
}

function cleanRequiredText(value: unknown, field: string, max = 160): string {
  const cleaned = cleanText(value, field, max)
  if (!cleaned) throw new Error(`${field} es requerido`)
  return cleaned
}

function cleanStatus(value: unknown): ProductDetailStatus {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'activo') return 'active'
    if (normalized === 'inactivo') return 'inactive'
    if (STATUSES.includes(normalized as ProductDetailStatus)) return normalized as ProductDetailStatus
  }
  if (typeof value !== 'string' || !STATUSES.includes(value as ProductDetailStatus)) {
    throw new Error('status debe ser active o inactive')
  }
  return value as ProductDetailStatus
}

function cleanPositiveInteger(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${field} debe ser un numero positivo`)
  return parsed
}

function cleanLimit(value: unknown): number {
  if (value === undefined || value === null || value === '') return 20
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return 20
  return Math.min(Math.max(parsed, 1), 50)
}

function cleanOffset(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) return 0
  return parsed
}

function cleanAccentColor(value: unknown): string {
  const color = cleanText(value, 'accent_color', 7)
  if (!color) return '#4F46E5'
  const upper = color.toUpperCase()
  if (!/^#[0-9A-F]{6}$/.test(upper)) throw new Error('accent_color debe usar formato #RRGGBB')
  return upper
}

function cleanUrlText(value: unknown, field: string): string | null {
  const url = cleanText(value, field, 2000)
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
  } catch {
    throw new Error(`${field} debe ser una URL valida`)
  }
  return url
}

function cleanImageUrl(value: unknown): string | null {
  const url = cleanText(value, 'image_url', 2000)
  if (!url) return null
  if (url.startsWith('/api/upload/uploads/')) return url
  try {
    const parsed = new URL(url)
    if (parsed.pathname.startsWith('/api/upload/uploads/') && ['http:', 'https:'].includes(parsed.protocol)) return url
    if (parsed.protocol !== 'https:') throw new Error()
  } catch {
    throw new Error('image_url debe ser una URL HTTPS valida')
  }
  return url
}

function normalizePhone(value: string): string {
  const trimmed = value.trim()
  const plus = trimmed.startsWith('+') ? '+' : ''
  return `${plus}${trimmed.replace(/\D/g, '')}`
}

function cleanEmail(value: string): string {
  const trimmed = value.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) throw new Error('cta_target debe ser un correo valido')
  return trimmed
}

function cleanCta(typeValue: unknown, labelValue: unknown, targetValue: unknown): {
  cta_type: string | null
  cta_label: string | null
  cta_target: string | null
} {
  const rawType = cleanText(typeValue, 'cta_type', 80)
  const normalizedType = rawType ? CTA_ALIASES[rawType.toLowerCase()] : null
  if (rawType && normalizedType === undefined) throw new Error('cta_type no es valido')
  if (!normalizedType) return { cta_type: null, cta_label: null, cta_target: null }

  const label = cleanText(labelValue, 'cta_label', 120) ?? DEFAULT_CTA_LABEL[normalizedType]
  const target = cleanText(targetValue, 'cta_target', 2000)
  if (!target) throw new Error('cta_target es requerido para la accion seleccionada')

  if (normalizedType === 'enlace_externo') {
    try {
      const parsed = new URL(target)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
      return { cta_type: normalizedType, cta_label: label, cta_target: parsed.toString() }
    } catch {
      throw new Error('cta_target debe ser una URL http o https valida')
    }
  }

  if (normalizedType === 'whatsapp') {
    const phone = normalizePhone(target)
    if (phone.replace(/\D/g, '').length < 7) throw new Error('cta_target debe ser un WhatsApp valido')
    return { cta_type: normalizedType, cta_label: label, cta_target: phone }
  }

  if (normalizedType === 'llamar') {
    const phone = normalizePhone(target)
    if (phone.replace(/\D/g, '').length < 7) throw new Error('cta_target debe ser un telefono valido')
    return { cta_type: normalizedType, cta_label: label, cta_target: phone }
  }

  return { cta_type: normalizedType, cta_label: label, cta_target: cleanEmail(target) }
}

function cleanProductDetailInput(body: ProductDetailInput, defaultStatus: ProductDetailStatus = 'inactive') {
  const cta = cleanCta(body.cta_type, body.cta_label, body.cta_target)
  return {
    internal_name: cleanRequiredText(body.internal_name, 'internal_name', 160),
    title: cleanRequiredText(body.title, 'title', 160),
    description: cleanText(body.description, 'description', 2000),
    price: cleanPriceText(body.price),
    image_url: cleanImageUrl(body.image_url),
    accent_color: cleanAccentColor(body.accent_color),
    ...cta,
    status: body.status ? cleanStatus(body.status) : defaultStatus,
  }
}

function cleanImportDecision(value: unknown): ProductDetailImportDecision {
  if (value === 'replace' || value === 'keep' || value === 'skip') return value
  return 'skip'
}

function comparable(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  return text ? text : null
}

function importChanges(existing: ProductDetailRow, incoming: CleanProductDetailInput) {
  const fields: Array<keyof CleanProductDetailInput> = [
    'internal_name',
    'title',
    'description',
    'price',
    'image_url',
    'accent_color',
    'cta_type',
    'cta_label',
    'cta_target',
    'status',
  ]
  return fields.flatMap((field) => {
    const current = comparable(existing[field])
    const next = comparable(incoming[field])
    return current === next ? [] : [{ field, current, incoming: next }]
  })
}

function withUsageCount(row: ProductDetailRow, usageCount = 0): ProductDetailResponse {
  return {
    ...row,
    usage_count: usageCount,
  }
}

async function ownedProductDetail(db: D1Database, id: number, tenantId: string) {
  return db.prepare(
    `SELECT ${PRODUCT_DETAIL_COLUMNS}
     FROM product_details
     WHERE id = ? AND tenant_id = ?`,
  ).bind(id, tenantId).first<ProductDetailRow>()
}

async function getProductDetailUsageCounts(db: D1Database, tenantId: string, ids?: number[]): Promise<Map<number, number>> {
  const allowedIds = ids && ids.length ? new Set(ids) : undefined
  const counts = new Map<number, number>()
  if (ids && ids.length === 0) return counts

  const { results } = await db.prepare(
    `SELECT pg.canvas_json
     FROM pages pg
     JOIN publications p ON p.id = pg.publication_id
     WHERE p.user_id = ?
       AND pg.canvas_json LIKE '%open_product_detail%'`,
  ).bind(tenantId).all<{ canvas_json: string | null }>()

  for (const row of results ?? []) {
    const pageCounts = countOpenProductDetailReferences(parseCanvasJson(row.canvas_json), allowedIds)
    pageCounts.forEach((count, detailId) => {
      counts.set(detailId, (counts.get(detailId) ?? 0) + count)
    })
  }

  return counts
}

async function getProductDetailUsageCount(db: D1Database, id: number, tenantId: string): Promise<number> {
  const counts = await getProductDetailUsageCounts(db, tenantId, [id])
  return counts.get(id) ?? 0
}

async function nextDuplicateInternalName(db: D1Database, tenantId: string, sourceName: string): Promise<string> {
  const base = `${sourceName} copia`.trim().slice(0, 160)
  const { results } = await db.prepare(
    `SELECT internal_name
     FROM product_details
     WHERE tenant_id = ?`,
  ).bind(tenantId).all<{ internal_name: string }>()

  const existing = new Set((results ?? []).map((row) => row.internal_name))
  if (!existing.has(base)) return base

  for (let index = 2; index < 1000; index += 1) {
    const suffix = ` ${index}`
    const candidate = `${base.slice(0, 160 - suffix.length)}${suffix}`
    if (!existing.has(candidate)) return candidate
  }

  return `${base.slice(0, 151)} ${crypto.randomUUID().slice(0, 8)}`
}

function dbError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (message.toLowerCase().includes('unique')) {
    return { status: 409, error: 'Ya existe un detalle de producto con ese nombre interno' }
  }
  if (message.toLowerCase().includes('check')) {
    return { status: 400, error: 'Los datos del detalle no cumplen las reglas de validacion' }
  }
  return { status: 500, error: 'Error al guardar detalle de producto' }
}

function importErrorField(message: string): string {
  if (/accent_color|color/i.test(message)) return 'color_acento'
  if (/status/i.test(message)) return 'estado'
  if (/cta_type/i.test(message)) return 'tipo_accion'
  if (/cta_target|WhatsApp|telefono|correo|URL/i.test(message)) return 'destino_accion'
  if (/title/i.test(message)) return 'titulo'
  if (/internal_name/i.test(message)) return 'nombre_interno'
  if (/image_url/i.test(message)) return 'imagen_url'
  return 'fila'
}

productDetails.get('/', async (c) => {
  const tenantId = c.get('user').sub
  const rawStatus = c.req.query('status')
  const limit = cleanLimit(c.req.query('limit'))
  const offset = cleanOffset(c.req.query('offset'))
  let status: ProductDetailStatus | null = null
  let query: string | null = null

  try {
    status = rawStatus ? cleanStatus(rawStatus) : null
    query = cleanText(c.req.query('q'), 'q', 120)
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }

  const filters = ['tenant_id = ?']
  const binds: unknown[] = [tenantId]

  if (status) {
    filters.push('status = ?')
    binds.push(status)
  }

  if (query) {
    const like = `%${query}%`
    filters.push(`(
      LOWER(internal_name) LIKE LOWER(?)
      OR LOWER(title) LIKE LOWER(?)
      OR LOWER(COALESCE(description, '')) LIKE LOWER(?)
      OR LOWER(COALESCE(cta_label, '')) LIKE LOWER(?)
    )`)
    binds.push(like, like, like, like)
  }

  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as total
     FROM product_details
     WHERE ${filters.join(' AND ')}`,
  ).bind(...binds).first<{ total: number }>()
  const total = Number(countRow?.total ?? 0)

  const { results } = await c.env.DB.prepare(
    `SELECT ${PRODUCT_DETAIL_COLUMNS}
     FROM product_details
     WHERE ${filters.join(' AND ')}
     ORDER BY updated_at DESC, id DESC
     LIMIT ? OFFSET ?`,
  ).bind(...binds, limit, offset).all<ProductDetailRow>()

  const rows = results ?? []
  const usageCounts = await getProductDetailUsageCounts(c.env.DB, tenantId, rows.map((row) => row.id))
  return c.json({
    success: true,
    data: rows.map((row) => withUsageCount(row, usageCounts.get(row.id) ?? 0)),
    page: {
      limit,
      offset,
      total,
      total_pages: Math.max(1, Math.ceil(total / limit)),
    },
  })
})

productDetails.post('/import', async (c) => {
  const tenantId = c.get('user').sub
  const body = await c.req.json<{ rows?: ProductDetailInput[]; dry_run?: boolean }>().catch(() => null)
  if (!body || !Array.isArray(body.rows)) {
    return c.json({ success: false, error: 'rows es requerido' }, 400)
  }
  if (body.rows.length > 500) {
    return c.json({ success: false, error: 'El archivo no puede exceder 500 filas' }, 400)
  }

  const invalid: Array<{ row: number; field: string; message: string }> = []
  const duplicates: ProductDetailImportDuplicate[] = []
  const normalized: Array<CleanProductDetailInput & { row: number; import_decision: ProductDetailImportDecision; existing_id?: number }> = []
  const seenNames = new Map<string, number>()
  const seenTitles = new Map<string, number>()

  body.rows.forEach((raw, index) => {
    const rowNumber = Number(raw?.row) || index + 2
    try {
      enforceImportOnlyRules(raw)
      const input = cleanProductDetailInput(raw, 'inactive')
      const nameKey = input.internal_name.toLowerCase()
      const titleKey = input.title.toLowerCase()
      if (seenNames.has(nameKey) || seenTitles.has(titleKey)) {
        duplicates.push({
          row: rowNumber,
          internal_name: input.internal_name,
          title: input.title,
          existing_id: 0,
          existing_internal_name: input.internal_name,
          existing_title: input.title,
          match_fields: seenNames.has(nameKey) ? ['internal_name'] : ['title'],
          changes: [],
        })
        return
      }
      seenNames.set(nameKey, rowNumber)
      seenTitles.set(titleKey, rowNumber)
      normalized.push({
        ...input,
        row: rowNumber,
        import_decision: cleanImportDecision(raw.import_decision),
        existing_id: raw.existing_id === undefined || raw.existing_id === null || raw.existing_id === ''
          ? undefined
          : cleanPositiveInteger(raw.existing_id, 'existing_id'),
      })
    } catch (error: any) {
      const message = error?.message ?? 'Fila invalida'
      invalid.push({ row: rowNumber, field: importErrorField(message), message })
    }
  })

  const names = normalized.map((row) => row.internal_name)
  const titles = normalized.map((row) => row.title)
  const existingByName = new Map<string, ProductDetailRow>()
  const existingByTitle = new Map<string, ProductDetailRow>()
  for (let start = 0; start < names.length; start += 90) {
    const chunk = names.slice(start, start + 90)
    if (!chunk.length) continue
    const placeholders = chunk.map(() => '?').join(',')
    const { results } = await c.env.DB.prepare(
      `SELECT ${PRODUCT_DETAIL_COLUMNS}
       FROM product_details
       WHERE tenant_id = ?
         AND LOWER(internal_name) IN (${placeholders})`,
    ).bind(tenantId, ...chunk.map((name) => name.toLowerCase())).all<ProductDetailRow>()
    ;(results ?? []).forEach((row) => existingByName.set(row.internal_name.toLowerCase(), row))
  }
  for (let start = 0; start < titles.length; start += 90) {
    const chunk = titles.slice(start, start + 90)
    if (!chunk.length) continue
    const placeholders = chunk.map(() => '?').join(',')
    const { results } = await c.env.DB.prepare(
      `SELECT ${PRODUCT_DETAIL_COLUMNS}
       FROM product_details
       WHERE tenant_id = ?
         AND LOWER(title) IN (${placeholders})
       ORDER BY id ASC`,
    ).bind(tenantId, ...chunk.map((title) => title.toLowerCase())).all<ProductDetailRow>()
    ;(results ?? []).forEach((row) => {
      const key = row.title.toLowerCase()
      if (!existingByTitle.has(key)) existingByTitle.set(key, row)
    })
  }

  const rowsWithExisting = normalized.map((row) => {
    const byName = existingByName.get(row.internal_name.toLowerCase())
    const byTitle = existingByTitle.get(row.title.toLowerCase())
    const existing = byName ?? byTitle ?? null
    if (!existing) return { row, existing: null }
    const matchFields = [
      ...(byName ? ['internal_name'] : []),
      ...(byTitle && byTitle.id === existing.id ? ['title'] : []),
    ]
    duplicates.push({
      row: row.row,
      internal_name: row.internal_name,
      title: row.title,
      existing_id: existing.id,
      existing_internal_name: existing.internal_name,
      existing_title: existing.title,
      match_fields: matchFields,
      changes: importChanges(existing, row),
    })
    return { row: { ...row, existing_id: row.existing_id ?? existing.id }, existing }
  })
  const rowsToCreate = rowsWithExisting.filter((entry) => !entry.existing).map((entry) => entry.row)
  const rowsToReplace = rowsWithExisting
    .filter((entry) => entry.existing && entry.row.import_decision === 'replace')
    .map((entry) => entry.row)
  const kept = rowsWithExisting.filter((entry) => entry.existing && entry.row.import_decision === 'keep').length
  const skipped = rowsWithExisting.filter((entry) => entry.existing && entry.row.import_decision !== 'replace' && entry.row.import_decision !== 'keep').length

  if (body.dry_run || (!rowsToCreate.length && !rowsToReplace.length)) {
    return c.json({ success: true, created: 0, updated: 0, kept: body.dry_run ? 0 : kept, skipped: body.dry_run ? 0 : skipped, invalid, duplicates })
  }

  try {
    const insertStatements = rowsToCreate.map((input) => c.env.DB.prepare(
      `INSERT INTO product_details (
        tenant_id,
        internal_name,
        title,
        description,
        price,
        image_url,
        accent_color,
        cta_type,
        cta_label,
        cta_target,
        status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      tenantId,
      input.internal_name,
      input.title,
      input.description,
      input.price,
      input.image_url,
      input.accent_color,
      input.cta_type,
      input.cta_label,
      input.cta_target,
      input.status,
    ))
    const updateStatements = rowsToReplace.map((input) => c.env.DB.prepare(
      `UPDATE product_details
       SET internal_name = ?,
           title = ?,
           description = ?,
           price = ?,
           image_url = ?,
           accent_color = ?,
           cta_type = ?,
           cta_label = ?,
           cta_target = ?,
           status = ?,
           updated_at = datetime('now')
       WHERE id = ? AND tenant_id = ?`,
    ).bind(
      input.internal_name,
      input.title,
      input.description,
      input.price,
      input.image_url,
      input.accent_color,
      input.cta_type,
      input.cta_label,
      input.cta_target,
      input.status,
      input.existing_id,
      tenantId,
    ))
    const statements = [...insertStatements, ...updateStatements]
    await c.env.DB.batch(statements)
    return c.json({ success: true, created: rowsToCreate.length, updated: rowsToReplace.length, kept, skipped, invalid, duplicates }, 201)
  } catch (error) {
    const result = dbError(error)
    return c.json({ success: false, error: result.error, created: 0, updated: 0, kept, skipped, invalid, duplicates }, result.status as any)
  }
})

productDetails.get('/:id/linkable', async (c) => {
  const tenantId = c.get('user').sub
  let id: number
  try {
    id = cleanPositiveInteger(c.req.param('id'), 'detail_id')
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }
  const detail = await ownedProductDetail(c.env.DB, id, tenantId)
  if (!detail) return c.json({ success: false, error: 'Detalle de producto no encontrado' }, 404)
  if (detail.status !== 'active') {
    return c.json({ success: false, error: 'Solo se pueden vincular detalles activos' }, 409)
  }
  const usageCount = await getProductDetailUsageCount(c.env.DB, detail.id, tenantId)
  return c.json({ success: true, data: withUsageCount(detail, usageCount) })
})

productDetails.get('/:id', async (c) => {
  const tenantId = c.get('user').sub
  let id: number
  try {
    id = cleanPositiveInteger(c.req.param('id'), 'detail_id')
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }

  const detail = await ownedProductDetail(c.env.DB, id, tenantId)
  if (!detail) return c.json({ success: false, error: 'Detalle de producto no encontrado' }, 404)
  const usageCount = await getProductDetailUsageCount(c.env.DB, detail.id, tenantId)
  return c.json({ success: true, data: withUsageCount(detail, usageCount) })
})

productDetails.post('/', async (c) => {
  const tenantId = c.get('user').sub
  const body = await c.req.json<ProductDetailInput>().catch(() => null)
  if (!body || typeof body !== 'object') return c.json({ success: false, error: 'JSON invalido' }, 400)

  let input: {
    internal_name: string
    title: string
    description: string | null
    price: string | null
    image_url: string | null
    accent_color: string
    cta_type: string | null
    cta_label: string | null
    cta_target: string | null
    status: ProductDetailStatus
  }

  try {
    input = cleanProductDetailInput(body, 'inactive')
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }

  try {
    const result = await c.env.DB.prepare(
      `INSERT INTO product_details (
        tenant_id,
        internal_name,
        title,
        description,
        price,
        image_url,
        accent_color,
        cta_type,
        cta_label,
        cta_target,
        status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      tenantId,
      input.internal_name,
      input.title,
      input.description,
      input.price,
      input.image_url,
      input.accent_color,
      input.cta_type,
      input.cta_label,
      input.cta_target,
      input.status,
    ).run()
    const id = Number(result.meta.last_row_id)
    if (!Number.isInteger(id) || id <= 0) throw new Error('No se pudo obtener el id creado')
    const created = await ownedProductDetail(c.env.DB, id, tenantId)
    return c.json({ success: true, data: created ? withUsageCount(created) : null }, 201)
  } catch (error) {
    const result = dbError(error)
    return c.json({ success: false, error: result.error }, result.status as any)
  }
})

productDetails.put('/:id', async (c) => {
  const tenantId = c.get('user').sub
  let id: number
  try {
    id = cleanPositiveInteger(c.req.param('id'), 'detail_id')
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }
  const existing = await ownedProductDetail(c.env.DB, id, tenantId)
  if (!existing) return c.json({ success: false, error: 'Detalle de producto no encontrado' }, 404)

  const body = await c.req.json<ProductDetailInput & Record<string, unknown>>().catch(() => null)
  if (!body || typeof body !== 'object') return c.json({ success: false, error: 'JSON invalido' }, 400)

  const updates: string[] = []
  const values: unknown[] = []
  const addUpdate = (column: string, value: unknown) => {
    updates.push(`${column} = ?`)
    values.push(value)
  }

  try {
    if (hasOwn(body, 'internal_name')) addUpdate('internal_name', cleanRequiredText(body.internal_name, 'internal_name', 160))
    if (hasOwn(body, 'title')) addUpdate('title', cleanRequiredText(body.title, 'title', 160))
    if (hasOwn(body, 'description')) addUpdate('description', cleanText(body.description, 'description', 2000))
    if (hasOwn(body, 'price')) addUpdate('price', cleanPriceText(body.price))
    if (hasOwn(body, 'image_url')) addUpdate('image_url', cleanImageUrl(body.image_url))
    if (hasOwn(body, 'accent_color')) addUpdate('accent_color', cleanAccentColor(body.accent_color))
    if (hasOwn(body, 'cta_type') || hasOwn(body, 'cta_label') || hasOwn(body, 'cta_target')) {
      const cta = cleanCta(
        hasOwn(body, 'cta_type') ? body.cta_type : existing.cta_type,
        hasOwn(body, 'cta_label') ? body.cta_label : existing.cta_label,
        hasOwn(body, 'cta_target') ? body.cta_target : existing.cta_target,
      )
      addUpdate('cta_type', cta.cta_type)
      addUpdate('cta_label', cta.cta_label)
      addUpdate('cta_target', cta.cta_target)
    }
    if (hasOwn(body, 'status')) addUpdate('status', cleanStatus(body.status))
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }

  if (!updates.length) {
    const usageCount = await getProductDetailUsageCount(c.env.DB, existing.id, tenantId)
    return c.json({ success: true, data: withUsageCount(existing, usageCount) })
  }

  updates.push(`updated_at = datetime('now')`)
  try {
    await c.env.DB.prepare(
      `UPDATE product_details
       SET ${updates.join(', ')}
       WHERE id = ? AND tenant_id = ?`,
    ).bind(...values, id, tenantId).run()
  } catch (error) {
    const result = dbError(error)
    return c.json({ success: false, error: result.error }, result.status as any)
  }

  const updated = await ownedProductDetail(c.env.DB, id, tenantId)
  const usageCount = updated ? await getProductDetailUsageCount(c.env.DB, updated.id, tenantId) : 0
  return c.json({ success: true, data: updated ? withUsageCount(updated, usageCount) : null })
})

productDetails.patch('/:id/status', async (c) => {
  const tenantId = c.get('user').sub
  let id: number
  try {
    id = cleanPositiveInteger(c.req.param('id'), 'detail_id')
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }
  const existing = await ownedProductDetail(c.env.DB, id, tenantId)
  if (!existing) return c.json({ success: false, error: 'Detalle de producto no encontrado' }, 404)

  const body = await c.req.json<{ status?: unknown }>().catch(() => null)
  if (!body) return c.json({ success: false, error: 'JSON invalido' }, 400)

  let status: ProductDetailStatus
  try {
    status = cleanStatus(body.status)
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }

  await c.env.DB.prepare(
    `UPDATE product_details
     SET status = ?, updated_at = datetime('now')
     WHERE id = ? AND tenant_id = ?`,
  ).bind(status, id, tenantId).run()

  const updated = await ownedProductDetail(c.env.DB, id, tenantId)
  const usageCount = updated ? await getProductDetailUsageCount(c.env.DB, updated.id, tenantId) : 0
  return c.json({ success: true, data: updated ? withUsageCount(updated, usageCount) : null })
})

productDetails.post('/:id/duplicate', async (c) => {
  const tenantId = c.get('user').sub
  let sourceId: number
  try {
    sourceId = cleanPositiveInteger(c.req.param('id'), 'detail_id')
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }
  const source = await ownedProductDetail(c.env.DB, sourceId, tenantId)
  if (!source) return c.json({ success: false, error: 'Detalle de producto no encontrado' }, 404)

  const internalName = await nextDuplicateInternalName(c.env.DB, tenantId, source.internal_name)
  try {
    const result = await c.env.DB.prepare(
      `INSERT INTO product_details (
        tenant_id,
        internal_name,
        title,
        description,
        price,
        image_url,
        accent_color,
        cta_type,
        cta_label,
        cta_target,
        status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'inactive')`,
    ).bind(
      tenantId,
      internalName,
      `${source.title} copia`.slice(0, 160),
      source.description,
      source.price,
      source.image_url,
      source.accent_color,
      source.cta_type,
      source.cta_label,
      source.cta_target,
    ).run()
    const id = Number(result.meta.last_row_id)
    if (!Number.isInteger(id) || id <= 0) throw new Error('No se pudo obtener el id duplicado')
    const created = await ownedProductDetail(c.env.DB, id, tenantId)
    return c.json({ success: true, data: created ? withUsageCount(created) : null }, 201)
  } catch (error) {
    const result = dbError(error)
    return c.json({ success: false, error: result.error }, result.status as any)
  }
})

productDetails.get('/:id/usage', async (c) => {
  const tenantId = c.get('user').sub
  let id: number
  try {
    id = cleanPositiveInteger(c.req.param('id'), 'detail_id')
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }
  const detail = await ownedProductDetail(c.env.DB, id, tenantId)
  if (!detail) return c.json({ success: false, error: 'Detalle de producto no encontrado' }, 404)
  const usageCount = await getProductDetailUsageCount(c.env.DB, detail.id, tenantId)
  return c.json({ success: true, data: { id: detail.id, usage_count: usageCount } })
})

productDetails.delete('/:id', async (c) => {
  const tenantId = c.get('user').sub
  let id: number
  try {
    id = cleanPositiveInteger(c.req.param('id'), 'detail_id')
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }
  const existing = await ownedProductDetail(c.env.DB, id, tenantId)
  if (!existing) return c.json({ success: false, error: 'Detalle de producto no encontrado' }, 404)

  const usageCount = await getProductDetailUsageCount(c.env.DB, id, tenantId)
  if (usageCount > 0) {
    return c.json({
      success: false,
      error: 'No se puede eliminar un detalle de producto en uso. Retira primero sus vinculos desde el Editor.',
    }, 409)
  }

  await c.env.DB.prepare(
    `DELETE FROM product_details WHERE id = ? AND tenant_id = ?`,
  ).bind(id, tenantId).run()

  return c.json({ success: true, data: { id } })
})

export default productDetails
