import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { api, type ProductDetail, type ProductDetailImportRow, type ProductDetailStatus } from '../lib/api'
import { useIsMobile } from '../hooks/useIsMobile'
import ImageBankModal from '../components/ImageBankModal'
import { cleanProductDetailPriceValue, formatProductDetailPrice } from '../lib/productDetailsFormat'

type CtaType = 'sin_accion' | 'whatsapp' | 'enlace_externo' | 'llamar' | 'correo'

type Draft = {
  internal_name: string
  title: string
  description: string
  price: string
  image_url: string
  accent_color: string
  cta_type: CtaType
  cta_label: string
  cta_target: string
  status: ProductDetailStatus
}

type ImportPreviewRow = ProductDetailImportRow & {
  state: 'valid' | 'invalid' | 'duplicate'
  errors: string[]
  duplicate?: {
    existing_id?: number
    existing_internal_name?: string
    existing_title?: string
    match_fields: string[]
    changes: Array<{ field: string; current: string | null; incoming: string | null }>
  }
  import_decision?: 'replace' | 'keep' | 'skip'
}

type ImportPreview = {
  rows: ImportPreviewRow[]
  validCount: number
  invalidCount: number
  duplicateCount: number
}

const ACCENT_DEFAULT = '#5E6F59'
const LAST_WHATSAPP_KEY = 'product_details_last_whatsapp'
const PAGE_SIZE = 20

const EMPTY_DRAFT: Draft = {
  internal_name: '',
  title: '',
  description: '',
  price: '',
  image_url: '',
  accent_color: ACCENT_DEFAULT,
  cta_type: 'sin_accion',
  cta_label: '',
  cta_target: '',
  status: 'inactive',
}

const CTA_OPTIONS: Array<{ value: CtaType; label: string }> = [
  { value: 'sin_accion', label: 'Sin accion' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'enlace_externo', label: 'Enlace externo' },
  { value: 'llamar', label: 'Llamar' },
  { value: 'correo', label: 'Correo' },
]

const DEFAULT_CTA_LABEL: Record<Exclude<CtaType, 'sin_accion'>, string> = {
  whatsapp: 'Escribir por WhatsApp',
  enlace_externo: 'Ver mas',
  llamar: 'Llamar',
  correo: 'Enviar correo',
}

const IMPORT_HEADERS = [
  'nombre_interno',
  'titulo',
  'descripcion',
  'precio',
  'color_acento',
  'tipo_accion',
  'etiqueta_boton',
  'destino_accion',
  'estado',
  'imagen_url',
]

function statusLabel(status: ProductDetailStatus) {
  return status === 'active' ? 'Activo' : 'Inactivo'
}

function statusStyle(status: ProductDetailStatus): CSSProperties {
  return status === 'active'
    ? { color: '#047857', background: '#ecfdf5', borderColor: '#a7f3d0' }
    : { color: '#6b7280', background: '#f3f4f6', borderColor: '#e5e7eb' }
}

function draftFromProduct(detail: ProductDetail): Draft {
  return {
    internal_name: detail.internal_name ?? '',
    title: detail.title ?? '',
    description: detail.description ?? '',
    price: cleanProductDetailPriceValue(detail.price),
    image_url: detail.image_url ?? '',
    accent_color: detail.accent_color || ACCENT_DEFAULT,
    cta_type: normalizeCtaType(detail.cta_type),
    cta_label: detail.cta_label ?? '',
    cta_target: detail.cta_target ?? '',
    status: detail.status,
  }
}

function normalizeCtaType(value: unknown): CtaType {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw || raw === 'none' || raw === 'sin_accion') return 'sin_accion'
  if (raw === 'external_url' || raw === 'url' || raw === 'link') return 'enlace_externo'
  if (raw === 'phone' || raw === 'call') return 'llamar'
  if (raw === 'email' || raw === 'mailto') return 'correo'
  return CTA_OPTIONS.some((item) => item.value === raw) ? raw as CtaType : 'sin_accion'
}

function parseImportCtaType(value: unknown): CtaType {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw || raw === 'sin_accion') return 'sin_accion'
  if (raw === 'external_url') return 'enlace_externo'
  if (raw === 'phone') return 'llamar'
  if (raw === 'email') return 'correo'
  if (CTA_OPTIONS.some((item) => item.value === raw)) return raw as CtaType
  throw new Error('Tipo de accion invalido')
}

function defaultCtaLabel(value: CtaType) {
  return value === 'sin_accion' ? '' : DEFAULT_CTA_LABEL[value]
}

function parseImportStatus(value: unknown): ProductDetailStatus {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw || raw === 'inactivo' || raw === 'inactive') return 'inactive'
  if (raw === 'activo' || raw === 'active') return 'active'
  throw new Error('Estado invalido')
}

function normalizeImportPrice(value: unknown) {
  const raw = cellText(value).trim()
  if (!raw) return null
  if (startsLikeFormula(raw)) throw new Error('Precio no puede iniciar con =, +, - o @')
  if (/[<>]/.test(raw)) throw new Error('Precio no puede contener HTML')
  if (raw.length > 80) throw new Error('Precio demasiado largo')
  const cleaned = cleanProductDetailPriceValue(raw)
  if (startsLikeFormula(cleaned)) throw new Error('Precio no puede iniciar con =, +, - o @')
  return cleaned || null
}

function cellText(value: unknown) {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  throw new Error('La celda contiene un valor no soportado')
}

function startsLikeFormula(value: string) {
  return /^[=+\-@]/.test(value.trimStart())
}

function importText(value: unknown, field: string, max: number) {
  const text = cellText(value).trim()
  if (!text) return ''
  if (startsLikeFormula(text)) throw new Error(`${field} no puede iniciar con =, +, - o @`)
  if (/[<>]/.test(text)) throw new Error(`${field} no puede contener HTML`)
  if (text.length > max) throw new Error(`${field} demasiado largo`)
  return text
}

function addLocalError(errors: Map<number, string[]>, row: number, message: string) {
  const current = errors.get(row) ?? []
  current.push(message)
  errors.set(row, current)
}

function safeExcelCell(value: unknown) {
  const text = String(value ?? '')
  return startsLikeFormula(text) ? `'${text}` : text
}

function productToInput(draft: Draft) {
  const ctaType = draft.cta_type === 'sin_accion' ? null : draft.cta_type
  return {
    internal_name: draft.internal_name.trim(),
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    price: cleanProductDetailPriceValue(draft.price) || null,
    image_url: draft.image_url.trim() || null,
    accent_color: draft.accent_color || ACCENT_DEFAULT,
    cta_type: ctaType,
    cta_label: ctaType ? draft.cta_label.trim() || defaultCtaLabel(draft.cta_type) : null,
    cta_target: ctaType ? draft.cta_target.trim() || null : null,
    status: draft.status,
  }
}

function formatDate(value: string) {
  if (!value) return ''
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' })
}

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function rowErrorField(message: string) {
  if (/color/i.test(message)) return 'color_acento'
  if (/status|estado/i.test(message)) return 'estado'
  if (/cta_type|accion/i.test(message)) return 'tipo_accion'
  if (/cta_target|URL|WhatsApp|telefono|correo/i.test(message)) return 'destino_accion'
  if (/title|titulo/i.test(message)) return 'titulo'
  if (/internal_name|nombre/i.test(message)) return 'nombre_interno'
  return 'fila'
}

function importFieldLabel(field: string) {
  const labels: Record<string, string> = {
    internal_name: 'Nombre interno',
    title: 'Titulo',
    description: 'Descripcion',
    price: 'Precio',
    image_url: 'Imagen',
    accent_color: 'Color de acento',
    cta_type: 'Tipo de accion',
    cta_label: 'Etiqueta del boton',
    cta_target: 'Destino de accion',
    status: 'Estado',
  }
  return labels[field] ?? field
}

function importDecisionLabel(value?: 'replace' | 'keep' | 'skip') {
  if (value === 'replace') return 'Sustituir existente'
  if (value === 'keep') return 'Mantener existente'
  return 'No importar'
}

export default function TenantProductDetails() {
  const isMobile = useIsMobile()
  const excelInputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<ProductDetail[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [query, setQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [status, setStatus] = useState<ProductDetailStatus | ''>('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [tenantKey, setTenantKey] = useState('default')
  const [tenantWhatsapp, setTenantWhatsapp] = useState('')
  const [lastWhatsapp, setLastWhatsapp] = useState('')
  const [showBank, setShowBank] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [message, setMessage] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMessage, setImportMessage] = useState('')
  const [importError, setImportError] = useState('')
  const [importRows, setImportRows] = useState<ProductDetailImportRow[]>([])
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)

  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId])
  const isEditing = Boolean(selected)
  const localWhatsapp = lastWhatsapp || tenantWhatsapp
  const whatsappSource = lastWhatsapp ? 'Ultimo utilizado' : tenantWhatsapp ? 'Predeterminado' : ''
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEnd = total === 0 ? 0 : Math.min(page * PAGE_SIZE, total)

  function lastWhatsappKeyForTenant(key = tenantKey) {
    return `${LAST_WHATSAPP_KEY}_${key}`
  }

  async function loadItems(next: { q?: string; status?: ProductDetailStatus | ''; page?: number } = {}) {
    setLoading(true)
    setError('')
    try {
      const q = next.q ?? activeQuery
      const nextStatus = next.status ?? status
      let nextPage = Math.max(1, next.page ?? page)
      let response = await api.productDetails.list({ q, status: nextStatus, limit: PAGE_SIZE, offset: (nextPage - 1) * PAGE_SIZE })
      let rows = response.data ?? []
      let nextTotal = Number(response.page?.total ?? rows.length)
      let nextTotalPages = Math.max(1, Math.ceil(nextTotal / PAGE_SIZE))

      if (nextPage > nextTotalPages && nextTotal > 0) {
        nextPage = nextTotalPages
        response = await api.productDetails.list({ q, status: nextStatus, limit: PAGE_SIZE, offset: (nextPage - 1) * PAGE_SIZE })
        rows = response.data ?? []
        nextTotal = Number(response.page?.total ?? rows.length)
        nextTotalPages = Math.max(1, Math.ceil(nextTotal / PAGE_SIZE))
      }

      setItems(rows)
      setTotal(nextTotal)
      setPage(Math.min(nextPage, nextTotalPages))
      setLoaded(true)
    } catch (err) {
      setItems([])
      setTotal(0)
      setLoaded(true)
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los detalles de producto.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    api.auth.me().then((res) => {
      const key = res.data.id || res.data.slug || 'default'
      setTenantKey(key)
      setTenantWhatsapp(res.data.contact_whatsapp ?? '')
      setLastWhatsapp(localStorage.getItem(`${LAST_WHATSAPP_KEY}_${key}`) ?? '')
    }).catch(() => {})
    void loadItems({ q: '', status: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function resetForm() {
    setSelectedId(null)
    setDraft(EMPTY_DRAFT)
    setShowBank(false)
    setFormError('')
    setMessage('')
  }

  function selectItem(item: ProductDetail) {
    setSelectedId(item.id)
    setDraft(draftFromProduct(item))
    setShowBank(false)
    setFormError('')
    setMessage('')
  }

  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    setFormError('')
    setMessage('')
  }

  function changeCtaType(value: CtaType) {
    setDraft((current) => {
      if (value === 'sin_accion') return { ...current, cta_type: value, cta_label: '', cta_target: '' }
      return {
        ...current,
        cta_type: value,
        cta_label: current.cta_label || DEFAULT_CTA_LABEL[value],
        cta_target: value === 'whatsapp' && !current.cta_target ? localWhatsapp : current.cta_target,
      }
    })
    setFormError('')
    setMessage('')
  }

  async function runSearch() {
    const term = query.trim()
    setActiveQuery(term)
    setPage(1)
    await loadItems({ q: term, page: 1 })
  }

  async function updateStatusFilter(value: ProductDetailStatus | '') {
    setStatus(value)
    setPage(1)
    await loadItems({ status: value, page: 1 })
  }

  async function goToPage(nextPage: number) {
    await loadItems({ page: nextPage })
  }

  async function saveDetail(event: FormEvent) {
    event.preventDefault()
    setFormError('')
    setMessage('')
    const input = productToInput(draft)
    if (!input.internal_name) return setFormError('El nombre interno es requerido.')
    if (!input.title) return setFormError('El titulo es requerido.')
    setSaving(true)
    try {
      const response = isEditing && selected
        ? await api.productDetails.update(selected.id, input)
        : await api.productDetails.create(input)
      const detail = response.data
      setItems((current) => current.some((item) => item.id === detail.id)
        ? current.map((item) => (item.id === detail.id ? detail : item))
        : [detail, ...current])
      if (draft.cta_type === 'whatsapp' && draft.cta_target.trim()) {
        localStorage.setItem(lastWhatsappKeyForTenant(), draft.cta_target.trim())
        setLastWhatsapp(draft.cta_target.trim())
      }
      setSelectedId(detail.id)
      setDraft(draftFromProduct(detail))
      setMessage(isEditing ? 'Detalle actualizado.' : 'Detalle creado.')
      await loadItems({ page: isEditing ? page : 1 })
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo guardar el detalle.')
    } finally {
      setSaving(false)
    }
  }

  async function setDetailStatus(item: ProductDetail, nextStatus: ProductDetailStatus) {
    if (item.status === nextStatus) return
    setFormError('')
    setMessage('')
    try {
      const response = await api.productDetails.setStatus(item.id, nextStatus)
      const detail = response.data
      if (selectedId === detail.id) setDraft(draftFromProduct(detail))
      setMessage('Estado actualizado.')
      await loadItems({ page })
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo cambiar el estado.')
    }
  }

  async function duplicateDetail(item: ProductDetail) {
    setFormError('')
    setMessage('')
    try {
      const response = await api.productDetails.duplicate(item.id)
      const detail = response.data
      setSelectedId(detail.id)
      setDraft(draftFromProduct(detail))
      setMessage('Detalle duplicado como inactivo.')
      await loadItems({ page: 1 })
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo duplicar el detalle.')
    }
  }

  async function removeDetail(item: ProductDetail) {
    if (!window.confirm(`Eliminar "${item.internal_name}"? Esta accion no se puede deshacer.`)) return
    setFormError('')
    setMessage('')
    try {
      await api.productDetails.remove(item.id)
      if (selectedId === item.id) resetForm()
      setMessage('Detalle eliminado.')
      await loadItems({ page })
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo eliminar el detalle.')
    }
  }

  async function readExcelFile(file: File) {
    setImporting(true)
    setImportError('')
    setImportMessage('')
    setImportPreview(null)
    try {
      const XLSX = await import('xlsx')
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array' })
      const sheetName = workbook.SheetNames.includes('Importar detalles') ? 'Importar detalles' : workbook.SheetNames[0]
      if (!sheetName) throw new Error('El archivo no contiene hojas.')
      const sheet = workbook.Sheets[sheetName]
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
      const headers = (matrix[0] ?? []).map((cell) => String(cell).trim())
      const sameHeaders = IMPORT_HEADERS.length === headers.length && IMPORT_HEADERS.every((header, index) => headers[index] === header)
      if (!sameHeaders) throw new Error('Encabezado incorrecto. Descarga la plantilla y conserva los nombres de columnas.')
      const dataRows = matrix.slice(1).filter((row) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim() !== ''))
      if (dataRows.length > 500) throw new Error('El archivo no puede exceder 500 filas.')
      const localErrors = new Map<number, string[]>()
      const rows = dataRows.map((row, index) => {
        const rowNumber = index + 2
        const get = (name: string) => row[IMPORT_HEADERS.indexOf(name)]
        const read = (name: string, max: number) => {
          try {
            return importText(get(name), name, max)
          } catch (err) {
            addLocalError(localErrors, rowNumber, err instanceof Error ? err.message : `${name} invalido`)
            return ''
          }
        }
        let ctaType: CtaType = 'sin_accion'
        let statusValue: ProductDetailStatus = 'inactive'
        let price: string | null = null
        try {
          ctaType = parseImportCtaType(get('tipo_accion'))
        } catch (err) {
          addLocalError(localErrors, rowNumber, err instanceof Error ? err.message : 'Tipo de accion invalido')
        }
        try {
          statusValue = parseImportStatus(get('estado'))
        } catch (err) {
          addLocalError(localErrors, rowNumber, err instanceof Error ? err.message : 'Estado invalido')
        }
        try {
          price = normalizeImportPrice(get('precio'))
        } catch (err) {
          addLocalError(localErrors, rowNumber, err instanceof Error ? err.message : 'Moneda invalida')
        }
        const input: ProductDetailImportRow = {
          row: rowNumber,
          internal_name: read('nombre_interno', 160),
          title: read('titulo', 160),
          description: read('descripcion', 2000) || null,
          price,
          image_url: read('imagen_url', 2000) || null,
          accent_color: read('color_acento', 7) || ACCENT_DEFAULT,
          cta_type: ctaType === 'sin_accion' ? null : ctaType,
          cta_label: ctaType === 'sin_accion' ? null : read('etiqueta_boton', 120) || defaultCtaLabel(ctaType),
          cta_target: ctaType === 'sin_accion' ? null : read('destino_accion', 2000) || null,
          status: statusValue,
        }
        if (ctaType === 'enlace_externo' && input.cta_target) {
          try {
            const parsed = new URL(input.cta_target)
            if (parsed.protocol !== 'https:') throw new Error()
          } catch {
            addLocalError(localErrors, rowNumber, 'Destino de enlace externo debe ser HTTPS')
          }
        }
        return input
      })
      const validation = await api.productDetails.import(rows, true)
      const invalidByRow = new Map<number, string[]>()
      validation.invalid.forEach((entry) => addLocalError(invalidByRow, entry.row, entry.message))
      localErrors.forEach((messages, row) => messages.forEach((message) => addLocalError(invalidByRow, row, message)))
      const duplicatesByRow = new Map(validation.duplicates.map((entry) => [entry.row, entry]))
      const previewRows: ImportPreviewRow[] = rows.map((row) => {
        const errors = invalidByRow.get(row.row)
        if (errors?.length) return { ...row, state: 'invalid', errors }
        const duplicate = duplicatesByRow.get(row.row)
        if (duplicate) {
          return {
            ...row,
            existing_id: duplicate.existing_id,
            import_decision: 'skip',
            state: 'duplicate',
            errors: duplicate.existing_id ? [] : ['Duplicado dentro del archivo'],
            duplicate: {
              existing_id: duplicate.existing_id,
              existing_internal_name: duplicate.existing_internal_name,
              existing_title: duplicate.existing_title,
              match_fields: duplicate.match_fields ?? [],
              changes: duplicate.changes ?? [],
            },
          }
        }
        return { ...row, state: 'valid', errors: [] }
      })
      setImportRows(rows)
      setImportPreview({
        rows: previewRows,
        validCount: previewRows.filter((row) => row.state === 'valid').length,
        invalidCount: previewRows.filter((row) => row.state === 'invalid').length,
        duplicateCount: previewRows.filter((row) => row.state === 'duplicate').length,
      })
      setImportMessage('Archivo validado. Revisa la vista previa antes de importar.')
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'No se pudo leer el Excel.')
    } finally {
      setImporting(false)
    }
  }

  async function confirmImport() {
    const importableRows = importPreview?.rows
      .filter((row) => row.state === 'valid' || (row.state === 'duplicate' && row.duplicate?.existing_id))
      .map(({ state, errors, duplicate, ...row }) => row) ?? []
    if (!importableRows.length) return
    setImporting(true)
    setImportError('')
    setImportMessage('')
    try {
      const response = await api.productDetails.import(importableRows)
      setImportMessage(`Importacion completada. Creados: ${response.created}. Sustituidos: ${response.updated ?? 0}. Mantenidos: ${response.kept ?? 0}. Omitidos: ${response.skipped ?? 0}. Invalidos: ${response.invalid.length}.`)
      setImportPreview(null)
      setImportRows([])
      await loadItems({ q: activeQuery, status, page: 1 })
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'No se pudo importar el archivo.')
    } finally {
      setImporting(false)
    }
  }

  function setDuplicateDecision(rowNumber: number, decision: 'replace' | 'keep' | 'skip') {
    setImportPreview((current) => current ? {
      ...current,
      rows: current.rows.map((row) => row.row === rowNumber ? { ...row, import_decision: decision } : row),
    } : current)
  }

  function setAllDuplicateDecisions(decision: 'replace' | 'keep' | 'skip') {
    setImportPreview((current) => current ? {
      ...current,
      rows: current.rows.map((row) => row.state === 'duplicate' && row.duplicate?.existing_id ? { ...row, import_decision: decision } : row),
    } : current)
  }

  async function downloadTemplate() {
    const XLSX = await import('xlsx')
    const example = [{
      nombre_interno: 'qa_pd_desayuno_deluxe',
      titulo: 'Desayuno Deluxe',
      descripcion: 'Descripcion breve del detalle.',
      precio: '2500',
      color_acento: ACCENT_DEFAULT,
      tipo_accion: 'enlace_externo',
      etiqueta_boton: 'Ver mas',
      destino_accion: 'https://example.com',
      estado: 'inactivo',
      imagen_url: '',
    }]
    const instructions = [
      ['Campo', 'Descripcion'],
      ['nombre_interno', 'Obligatorio y unico por tenant. No se sobrescriben fichas existentes.'],
      ['titulo', 'Obligatorio. Puede repetirse.'],
      ['descripcion', 'Opcional. Texto plano.'],
      ['precio', 'Opcional. Numero o texto numerico. Puedes dejarlo vacio. No agregues columna Moneda.'],
      ['color_acento', `Hexadecimal #RRGGBB. Por defecto ${ACCENT_DEFAULT}.`],
      ['tipo_accion', 'sin_accion, whatsapp, enlace_externo, llamar, correo. Aliases: external_url, phone, email.'],
      ['etiqueta_boton', 'Opcional. Si queda vacia se usa una etiqueta predeterminada segun la accion.'],
      ['destino_accion', 'Requerido cuando hay accion. URL http/https, numero de telefono o correo.'],
      ['estado', 'activo/inactivo. Aliases: active/inactive.'],
      ['imagen_url', 'Opcional. Puede dejarse vacia. Las imagenes pueden agregarse despues desde Banco o equipo.'],
      ['Nota', 'No cambies los encabezados de la hoja Importar detalles. Maximo 500 filas.'],
    ]
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(example, { header: IMPORT_HEADERS }), 'Importar detalles')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(instructions), 'Instrucciones')
    const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    downloadBlob('Plantilla_importacion_Detalles_Producto_INTAP.xlsx', new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  }

  async function downloadImportErrors() {
    if (!importPreview) return
    const XLSX = await import('xlsx')
    const rows = importPreview.rows.filter((row) => row.state !== 'valid').map((row) => ({
      fila: row.row,
      nombre_interno: safeExcelCell(row.internal_name),
      titulo: safeExcelCell(row.title),
      estado: row.state === 'duplicate' ? 'Duplicada' : 'Invalida',
      error: safeExcelCell(row.errors.join('; ')),
      campo: safeExcelCell(row.errors.map(rowErrorField).join('; ')),
    }))
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Errores')
    const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    downloadBlob('Errores_importacion_Detalles_Producto.xlsx', new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  }

  const ctaType = draft.cta_type
  const emptyCopy = activeQuery || status
    ? 'Prueba con otra busqueda o limpia el filtro.'
    : 'Crea fichas ligeras para ampliar informacion puntual desde el flipbook.'

  return (
    <div style={s.wrap}>
      <header style={s.header}>
        <div>
          <h1 style={s.title}>Detalles de producto</h1>
          <p style={s.subtitle}>Fichas puntuales para ampliar informacion al hacer clic sobre un objeto del flipbook.</p>
        </div>
        <div style={s.headerActions}>
          <button type="button" style={s.secondaryBtn} onClick={() => void downloadTemplate()}>Descargar plantilla</button>
          <button type="button" style={s.secondaryBtn} onClick={() => excelInputRef.current?.click()} disabled={importing}>Importar Excel</button>
          <button type="button" style={s.primaryBtn} onClick={resetForm}>Nuevo detalle</button>
        </div>
        <input
          ref={excelInputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void readExcelFile(file)
          }}
        />
      </header>

      <section style={s.toolbar}>
        <div style={s.searchRow}>
          <input
            style={s.input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void runSearch() }}
            placeholder="Buscar por nombre interno o titulo"
          />
          <button type="button" style={s.secondaryBtn} disabled={loading} onClick={() => void runSearch()}>Buscar</button>
        </div>
        <label style={s.filterLabel}>
          Estado
          <select style={s.select} value={status} onChange={(event) => void updateStatusFilter(event.target.value as ProductDetailStatus | '')}>
            <option value="">Todos</option>
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
          </select>
        </label>
      </section>

      <div style={s.summary}>
        <span>{loading && !loaded ? 'Cargando...' : `Mostrando ${rangeStart}-${rangeEnd} de ${total} detalle${total === 1 ? '' : 's'}`}</span>
        <span>Pagina {page} de {totalPages}</span>
        {activeQuery && <span>Busqueda: {activeQuery}</span>}
      </div>

      {error && <div style={s.error}>{error}</div>}
      {formError && <div style={s.error}>{formError}</div>}
      {message && <div style={s.success}>{message}</div>}
      {importError && <div style={s.error}>{importError}</div>}
      {importMessage && <div style={s.success}>{importMessage}</div>}

      {importPreview && (
        <section style={s.importPanel}>
          <div style={s.importHeader}>
            <div>
              <h2 style={s.formTitle}>Vista previa de importacion</h2>
              <p style={s.importMeta}>
                Total: {importPreview.rows.length} · Validas: {importPreview.validCount} · Invalidas: {importPreview.invalidCount} · Duplicadas: {importPreview.duplicateCount}
              </p>
              {importPreview.duplicateCount > 0 && (
                <p style={s.importWarning}>Esta accion actualizara la ficha existente y conservara sus vinculos actuales en el Editor.</p>
              )}
            </div>
            <div style={s.headerActions}>
              {importPreview.duplicateCount > 0 && (
                <>
                  <button type="button" style={s.secondaryBtn} onClick={() => setAllDuplicateDecisions('replace')}>Sustituir todos los duplicados</button>
                  <button type="button" style={s.secondaryBtn} onClick={() => setAllDuplicateDecisions('keep')}>Mantener todos los existentes</button>
                  <button type="button" style={s.secondaryBtn} onClick={() => setAllDuplicateDecisions('skip')}>No importar ningun duplicado</button>
                </>
              )}
              {(importPreview.invalidCount > 0 || importPreview.duplicateCount > 0) && (
                <button type="button" style={s.secondaryBtn} onClick={() => void downloadImportErrors()}>Descargar errores</button>
              )}
              <button type="button" style={s.secondaryBtn} onClick={() => { setImportPreview(null); setImportRows([]) }}>Cancelar</button>
              <button type="button" style={s.primaryBtn} disabled={importing || (importPreview.validCount === 0 && importPreview.rows.every((row) => row.state !== 'duplicate' || !row.duplicate?.existing_id))} onClick={() => void confirmImport()}>
                {importing ? 'Importando...' : 'Confirmar importacion'}
              </button>
            </div>
          </div>
          <div style={s.importTableWrap}>
            <table style={s.importTable}>
              <thead>
                <tr><th>Fila</th><th>Estado</th><th>Nombre interno</th><th>Titulo</th><th>Ficha existente</th><th>Cambios</th><th>Decision</th></tr>
              </thead>
              <tbody>
                {importPreview.rows.slice(0, 12).map((row) => (
                  <tr key={`${row.row}-${row.internal_name}`}>
                    <td>{row.row}</td>
                    <td>{row.state === 'valid' ? 'Valida' : row.state === 'duplicate' ? 'Duplicada' : 'Invalida'}</td>
                    <td>{row.internal_name}</td>
                    <td>{row.title}</td>
                    <td>
                      {row.duplicate?.existing_id
                        ? `${row.duplicate.existing_internal_name} · ${row.duplicate.existing_title}`
                        : row.errors.join('; ')}
                    </td>
                    <td>
                      {row.duplicate?.changes?.length ? (
                        <div style={s.changeList}>
                          {row.duplicate.changes.map((change) => (
                            <span key={`${row.row}-${change.field}`} style={s.changeItem}>
                              <strong>{importFieldLabel(change.field)}:</strong> {change.current ?? 'Vacio'} -&gt; {change.incoming ?? 'Vacio'}
                            </span>
                          ))}
                        </div>
                      ) : row.state === 'duplicate' ? 'Sin cambios detectados' : row.errors.join('; ')}
                    </td>
                    <td>
                      {row.state === 'duplicate' && row.duplicate?.existing_id ? (
                        <select
                          style={s.select}
                          value={row.import_decision ?? 'skip'}
                          onChange={(event) => setDuplicateDecision(row.row, event.target.value as 'replace' | 'keep' | 'skip')}
                        >
                          <option value="replace">Sustituir existente</option>
                          <option value="keep">Mantener existente</option>
                          <option value="skip">No importar</option>
                        </select>
                      ) : row.state === 'duplicate' ? 'No importar' : importDecisionLabel(row.import_decision)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div style={{ ...s.grid, gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1.05fr) minmax(390px, .95fr)' }}>
        <section style={s.listPanel}>
          {!loaded || (loading && !items.length) ? (
            <div style={s.empty}>Cargando detalles de producto...</div>
          ) : !items.length ? (
            <div style={s.empty}><strong>No hay detalles de producto.</strong><span>{emptyCopy}</span></div>
          ) : (
            <div style={s.list}>
              {items.map((item) => (
                <article key={item.id} style={{ ...s.card, ...(selectedId === item.id ? s.cardSelected : {}) }}>
                  <button type="button" style={s.cardMain} onClick={() => selectItem(item)}>
                    <div style={{ ...s.thumb, background: item.image_url ? '#f3f4f6' : item.accent_color }}>
                      {item.image_url ? <img src={item.image_url} alt="" style={s.thumbImg} loading="lazy" /> : <span>{item.title.slice(0, 1).toUpperCase()}</span>}
                    </div>
                    <div style={s.cardText}>
                      <div style={s.cardTopline}>
                        <h2 style={s.cardTitle}>{item.title}</h2>
                        <span style={{ ...s.statusPill, ...statusStyle(item.status) }}>{statusLabel(item.status)}</span>
                      </div>
                      <span style={s.cardMeta}>{item.internal_name}</span>
                      <span style={s.cardMeta}>{formatProductDetailPrice(item.price) || 'Sin precio'} · Uso: {item.usage_count}</span>
                    </div>
                  </button>
                  <div style={s.cardActions}>
                    <button type="button" style={s.textBtn} onClick={() => void setDetailStatus(item, item.status === 'active' ? 'inactive' : 'active')}>
                      {item.status === 'active' ? 'Inactivar' : 'Activar'}
                    </button>
                    <button type="button" style={s.textBtn} onClick={() => void duplicateDetail(item)}>Duplicar</button>
                    <button type="button" style={s.dangerBtn} disabled={item.usage_count > 0} title={item.usage_count > 0 ? 'Retira primero los vinculos desde el Editor.' : 'Eliminar'} onClick={() => void removeDetail(item)}>Eliminar</button>
                  </div>
                </article>
              ))}
              <div style={s.pagination}>
                <button
                  type="button"
                  style={{ ...s.secondaryBtn, ...(page <= 1 || loading ? s.disabledBtn : {}) }}
                  disabled={page <= 1 || loading}
                  onClick={() => void goToPage(page - 1)}
                >
                  Anterior
                </button>
                <span style={s.pageText}>Pagina {page} de {totalPages}</span>
                <button
                  type="button"
                  style={{ ...s.secondaryBtn, ...(page >= totalPages || loading ? s.disabledBtn : {}) }}
                  disabled={page >= totalPages || loading}
                  onClick={() => void goToPage(page + 1)}
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </section>

        <aside style={s.formPanel}>
          <form onSubmit={(event) => void saveDetail(event)} style={s.form}>
            <div style={s.formHeader}>
              <div>
                <h2 style={s.formTitle}>{isEditing ? 'Editar detalle' : 'Crear detalle'}</h2>
                {selected && <span style={s.formMeta}>Actualizado {formatDate(selected.updated_at)}</span>}
              </div>
              {isEditing && <button type="button" style={s.secondaryBtn} onClick={resetForm}>Cancelar</button>}
            </div>

            <div style={s.sectionTitle}>Informacion</div>
            <label style={s.label}>Nombre interno<input style={s.input} value={draft.internal_name} maxLength={160} onChange={(event) => updateDraft('internal_name', event.target.value)} required /></label>
            <label style={s.label}>Titulo<input style={s.input} value={draft.title} maxLength={160} onChange={(event) => updateDraft('title', event.target.value)} required /></label>
            <label style={s.label}>Descripcion<textarea style={s.textarea} value={draft.description} maxLength={2000} onChange={(event) => updateDraft('description', event.target.value)} rows={4} /></label>
            <div style={s.twoCols}>
              <label style={s.label}>Precio<input style={s.input} value={draft.price} maxLength={80} onChange={(event) => updateDraft('price', event.target.value)} placeholder="Opcional" /></label>
              <label style={s.label}>Color de acento<input style={s.colorInput} type="color" value={draft.accent_color} onChange={(event) => updateDraft('accent_color', event.target.value.toUpperCase())} /></label>
            </div>

            <div style={s.sectionTitle}>Imagen</div>
            <div style={s.imageBox}>
              {draft.image_url ? (
                <img src={draft.image_url} alt="" style={s.imagePreview} onError={(event) => { event.currentTarget.style.display = 'none' }} />
              ) : (
                <div style={s.imageEmpty}>Imagen opcional</div>
              )}
              <div style={s.imageActions}>
                <button type="button" style={s.secondaryBtn} onClick={() => setShowBank(true)}>
                  {draft.image_url ? 'Cambiar imagen' : 'Seleccionar imagen'}
                </button>
                <button type="button" style={s.secondaryBtn} onClick={() => setShowBank(true)}>
                  Explorar equipo
                </button>
                {draft.image_url && <button type="button" style={s.textBtn} onClick={() => updateDraft('image_url', '')}>Quitar</button>}
              </div>
            </div>
            <ImageBankModal
              open={showBank}
              selectedUrl={draft.image_url}
              onClose={() => setShowBank(false)}
              onSelect={(url) => {
                updateDraft('image_url', url)
                setShowBank(false)
              }}
            />

            <div style={s.sectionTitle}>Accion principal</div>
            <label style={s.label}>Tipo de accion<select style={s.select} value={ctaType} onChange={(event) => changeCtaType(event.target.value as CtaType)}>{CTA_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            {ctaType !== 'sin_accion' && (
              <>
                {ctaType === 'whatsapp' && localWhatsapp && <div style={s.hint}>{whatsappSource}: {localWhatsapp}</div>}
                <label style={s.label}>Etiqueta del boton<input style={s.input} value={draft.cta_label} maxLength={120} onChange={(event) => updateDraft('cta_label', event.target.value)} placeholder={defaultCtaLabel(ctaType)} /></label>
                <label style={s.label}>{ctaType === 'whatsapp' ? 'Numero de WhatsApp' : ctaType === 'enlace_externo' ? 'URL completa' : ctaType === 'llamar' ? 'Numero telefonico' : 'Correo electronico'}<input style={s.input} value={draft.cta_target} maxLength={2000} onChange={(event) => updateDraft('cta_target', event.target.value)} placeholder={ctaType === 'enlace_externo' ? 'https://...' : ctaType === 'correo' ? 'correo@dominio.com' : '+1 809 000 0000'} /></label>
              </>
            )}

            <div style={s.sectionTitle}>Estado</div>
            <label style={s.switchRow}>
              <input type="checkbox" checked={draft.status === 'active'} onChange={(event) => updateDraft('status', event.target.checked ? 'active' : 'inactive')} />
              <span>{draft.status === 'active' ? 'Activo' : 'Inactivo'}</span>
            </label>

            <button type="submit" style={s.primaryBtn} disabled={saving}>{saving ? 'Guardando...' : isEditing ? 'Guardar cambios' : 'Crear detalle'}</button>
          </form>

          <section style={s.previewPanel}>
            <h3 style={s.previewTitle}>Vista previa publica</h3>
            <div style={{ ...s.previewCard, '--accent': draft.accent_color } as CSSProperties}>
              <div style={s.previewHeader} />
              {draft.image_url && <img src={draft.image_url} alt="" style={s.previewImg} />}
              <div style={s.previewBody}>
                <h3 style={s.previewName}>{draft.title || 'Titulo del producto'}</h3>
                {draft.description && <p style={s.previewDescription}>{draft.description}</p>}
                {formatProductDetailPrice(draft.price) && <strong style={s.previewPrice}>{formatProductDetailPrice(draft.price)}</strong>}
                {ctaType !== 'sin_accion' && draft.cta_label && <span style={s.previewCta}>{draft.cta_label}</span>}
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  wrap: { padding: '28px clamp(16px, 3vw, 34px)', color: '#111827' },
  header: { display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap' },
  headerActions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  title: { margin: 0, fontSize: 26, lineHeight: 1.15 },
  subtitle: { margin: '7px 0 0', color: '#6b7280', fontSize: 14, maxWidth: 620 },
  toolbar: { display: 'flex', alignItems: 'end', gap: 12, flexWrap: 'wrap', marginBottom: 12 },
  searchRow: { display: 'flex', gap: 8, minWidth: 280, flex: 1 },
  filterLabel: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#6b7280', fontWeight: 700 },
  input: { width: '100%', minHeight: 40, border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 10px', font: 'inherit', boxSizing: 'border-box', background: '#fff' },
  textarea: { width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '9px 10px', font: 'inherit', resize: 'vertical', boxSizing: 'border-box', background: '#fff' },
  select: { width: '100%', minHeight: 40, border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 10px', font: 'inherit', background: '#fff' },
  colorInput: { width: '100%', minHeight: 40, border: '1px solid #d1d5db', borderRadius: 8, padding: 4, background: '#fff', boxSizing: 'border-box' },
  primaryBtn: { minHeight: 40, border: 'none', borderRadius: 8, padding: '9px 14px', background: '#4F46E5', color: '#fff', fontWeight: 800, cursor: 'pointer', font: 'inherit' },
  secondaryBtn: { minHeight: 40, border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', background: '#fff', color: '#374151', fontWeight: 750, cursor: 'pointer', font: 'inherit' },
  disabledBtn: { opacity: 0.5, cursor: 'not-allowed' },
  summary: { display: 'flex', gap: 12, flexWrap: 'wrap', color: '#6b7280', fontSize: 13, marginBottom: 14 },
  error: { border: '1px solid #fecaca', background: '#fef2f2', color: '#991b1b', borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 13 },
  success: { border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#166534', borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 13 },
  grid: { display: 'grid', gap: 18, alignItems: 'start' },
  listPanel: { minWidth: 0 },
  list: { display: 'grid', gap: 10 },
  empty: { minHeight: 220, border: '1px dashed #d1d5db', borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#6b7280', background: '#fff', textAlign: 'center', padding: 20 },
  card: { border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', overflow: 'hidden' },
  cardSelected: { borderColor: '#4F46E5', boxShadow: '0 0 0 1px #4F46E5' },
  cardMain: { display: 'flex', width: '100%', gap: 12, padding: 12, border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', font: 'inherit' },
  thumb: { width: 68, height: 68, borderRadius: 8, overflow: 'hidden', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 24, flex: '0 0 auto' },
  thumbImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  cardText: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 4 },
  cardTopline: { display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { margin: 0, fontSize: 15, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cardMeta: { color: '#6b7280', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  statusPill: { border: '1px solid', borderRadius: 999, padding: '3px 8px', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' },
  cardActions: { display: 'flex', gap: 8, padding: '0 12px 12px', flexWrap: 'wrap' },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', paddingTop: 4 },
  pageText: { color: '#6b7280', fontSize: 13, fontWeight: 800 },
  textBtn: { border: 'none', background: 'transparent', color: '#4F46E5', fontWeight: 800, cursor: 'pointer', padding: '5px 2px', font: 'inherit', fontSize: 12 },
  dangerBtn: { border: 'none', background: 'transparent', color: '#b91c1c', fontWeight: 800, cursor: 'pointer', padding: '5px 2px', font: 'inherit', fontSize: 12 },
  formPanel: { display: 'grid', gap: 14 },
  form: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 18, display: 'grid', gap: 13 },
  formHeader: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' },
  formTitle: { margin: 0, fontSize: 17, lineHeight: 1.2 },
  formMeta: { display: 'block', color: '#6b7280', fontSize: 12, marginTop: 4 },
  sectionTitle: { marginTop: 4, color: '#374151', fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.04em' },
  label: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#6b7280', fontWeight: 800 },
  twoCols: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 },
  hint: { color: '#6b7280', fontSize: 12, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px' },
  switchRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800, color: '#374151' },
  imageBox: { border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, display: 'grid', gap: 10, background: '#fafafa' },
  imagePreview: { width: '100%', height: 170, borderRadius: 8, objectFit: 'cover', background: '#f3f4f6', display: 'block' },
  imageEmpty: { height: 140, borderRadius: 8, border: '1px dashed #cbd5e1', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontWeight: 800 },
  imageActions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  previewPanel: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 },
  previewTitle: { margin: '0 0 12px', fontSize: 14 },
  previewCard: { overflow: 'hidden', borderRadius: 20, border: '1px solid #e5e7eb', boxShadow: '0 18px 45px rgba(15,23,42,.13)', background: '#fff' },
  previewHeader: { height: 34, background: 'var(--accent)' },
  previewImg: { width: '100%', height: 190, objectFit: 'cover', display: 'block' },
  previewBody: { padding: 22, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' },
  previewName: { margin: 0, fontSize: 22, lineHeight: 1.15 },
  previewDescription: { margin: 0, color: '#111827', fontSize: 16, lineHeight: 1.68, whiteSpace: 'pre-wrap' },
  previewPrice: { border: '1px solid #e5e7eb', borderRadius: 999, padding: '9px 14px', color: 'var(--accent)', fontSize: 16 },
  previewCta: { width: '100%', minHeight: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', background: 'var(--accent)', fontWeight: 900 },
  importPanel: { background: '#fff', border: '1px solid #dbeafe', borderRadius: 8, padding: 16, marginBottom: 16 },
  importHeader: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' },
  importMeta: { margin: '5px 0 0', color: '#6b7280', fontSize: 13 },
  importWarning: { margin: '8px 0 0', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px', fontSize: 12, fontWeight: 800 },
  importTableWrap: { overflowX: 'auto', marginTop: 12 },
  importTable: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  changeList: { display: 'grid', gap: 4, minWidth: 220 },
  changeItem: { display: 'block', color: '#374151', lineHeight: 1.35 },
}
