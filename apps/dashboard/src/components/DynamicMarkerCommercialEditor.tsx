import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { api } from '../lib/api'
import type { DynamicMarker, UpdateDynamicMarkerInput } from '../lib/api'

const currencies = ['', 'DOP', 'USD', 'EUR', 'CAD', 'MXN', 'COP'] as const
const currencySet = new Set<string>(currencies)
const availabilityOptions = [
  '',
  'Disponible',
  'Agotado',
  'Por encargo',
  'Próximamente',
  'Consultar disponibilidad',
]

type Draft = {
  name: string
  reference: string
  category: string
  description: string
  price: string
  previousPrice: string
  currency: string
  availability: string
  promotionText: string
  badgeText: string
  promotionEndsAt: string
  postPromotionPrice: string
  accentColor: string
}

type Props = {
  marker: DynamicMarker
  onDirtyChange: (dirty: boolean) => void
  onSaved: (marker: DynamicMarker) => void
  onRegisterFlush?: (flush: (() => Promise<boolean>) | null) => void
}

function text(value: string | null | undefined) {
  return value ?? ''
}

function minorToInput(value: number | null) {
  if (value == null) return ''
  const amount = value / 100
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function normalizeColor(value: string | null | undefined) {
  return value ?? ''
}

function isoToLocalInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (item: number) => String(item).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function localInputToIso(value: string) {
  if (!value.trim()) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('La fecha de promoción no es válida.')
  return date.toISOString()
}

function draftFromMarker(marker: DynamicMarker): Draft {
  return {
    name: text(marker.name),
    reference: text(marker.reference),
    category: text(marker.category),
    description: text(marker.description),
    price: minorToInput(marker.price_minor),
    previousPrice: minorToInput(marker.previous_price_minor),
    currency: text(marker.currency).toUpperCase(),
    availability: text(marker.availability),
    promotionText: text(marker.promotion_text),
    badgeText: text(marker.badge_text),
    promotionEndsAt: isoToLocalInput(marker.promotion_ends_at),
    postPromotionPrice: minorToInput(marker.post_promotion_price_minor),
    accentColor: normalizeColor(marker.accent_color),
  }
}

function normalizeDraft(draft: Draft) {
  return {
    name: draft.name.trim(),
    reference: draft.reference.trim(),
    category: draft.category.trim(),
    description: draft.description.trim(),
    price: draft.price.trim(),
    previousPrice: draft.previousPrice.trim(),
    currency: draft.currency.trim().toUpperCase(),
    availability: draft.availability.trim(),
    promotionText: draft.promotionText.trim(),
    badgeText: draft.badgeText.trim(),
    promotionEndsAt: draft.promotionEndsAt.trim(),
    postPromotionPrice: draft.postPromotionPrice.trim(),
    accentColor: draft.accentColor.trim().toUpperCase(),
  }
}

function parseMoney(value: string, label: string) {
  const raw = value.trim()
  if (!raw) return null
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    throw new Error(`${label} debe ser un decimal positivo con máximo dos decimales.`)
  }
  const amount = Number(raw)
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`${label} debe ser un número no negativo.`)
  }
  return Math.round(amount * 100)
}

function nullableText(value: string) {
  const cleaned = value.trim()
  return cleaned || null
}

function assertLength(value: string, label: string, max: number) {
  if (value.trim().length > max) throw new Error(`${label} no puede exceder ${max} caracteres.`)
}

function buildPayload(draft: Draft, marker: DynamicMarker): UpdateDynamicMarkerInput {
  const normalized = normalizeDraft(draft)

  assertLength(normalized.name, 'Nombre', 160)
  assertLength(normalized.reference, 'Referencia', 120)
  assertLength(normalized.category, 'Categoría', 120)
  assertLength(normalized.description, 'Descripción', 2000)
  assertLength(normalized.availability, 'Disponibilidad', 80)
  assertLength(normalized.promotionText, 'Promoción', 200)
  assertLength(normalized.badgeText, 'Badge', 80)

  const priceMinor = parseMoney(normalized.price, 'Precio actual')
  const previousPriceMinor = parseMoney(normalized.previousPrice, 'Precio anterior')
  const postPromotionPriceMinor = parseMoney(normalized.postPromotionPrice, 'Precio posterior')

  if ((priceMinor != null || previousPriceMinor != null || postPromotionPriceMinor != null) && !normalized.currency) {
    throw new Error('Selecciona una moneda cuando informes cualquier precio.')
  }
  if (!currencySet.has(normalized.currency)) {
    throw new Error('La moneda seleccionada no es válida.')
  }
  if (!/^#[0-9A-F]{6}$/.test(normalized.accentColor)) {
    throw new Error('El color de acento debe usar formato #RRGGBB.')
  }
  if (marker.status === 'active' && !normalized.name) {
    throw new Error('Una ficha activa debe conservar un nombre.')
  }

  return {
    name: nullableText(normalized.name),
    reference: nullableText(normalized.reference),
    category: nullableText(normalized.category),
    description: nullableText(normalized.description),
    price_minor: priceMinor,
    previous_price_minor: previousPriceMinor,
    currency: normalized.currency || null,
    availability: nullableText(normalized.availability),
    promotion_text: nullableText(normalized.promotionText),
    badge_text: nullableText(normalized.badgeText),
    promotion_ends_at: localInputToIso(normalized.promotionEndsAt),
    post_promotion_price_minor: postPromotionPriceMinor,
    accent_color: normalized.accentColor,
  }
}

export default function DynamicMarkerCommercialEditor({
  marker,
  onDirtyChange,
  onSaved,
  onRegisterFlush,
}: Props) {
  const [draft, setDraft] = useState<Draft>(() => draftFromMarker(marker))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [failedDraftKey, setFailedDraftKey] = useState('')
  const savePromiseRef = useRef<Promise<boolean> | null>(null)

  const initial = useMemo(() => draftFromMarker(marker), [marker])
  const draftKey = JSON.stringify(normalizeDraft(draft))
  const initialKey = JSON.stringify(normalizeDraft(initial))
  const dirty = draftKey !== initialKey

  useEffect(() => {
    setDraft(draftFromMarker(marker))
    setError('')
    setSaved('')
    setFailedDraftKey('')
  }, [marker])

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  const patch = (updates: Partial<Draft>) => {
    setError('')
    setSaved('')
    setFailedDraftKey('')
    setDraft((current) => ({ ...current, ...updates }))
  }

  useEffect(() => {
    if (!dirty || saving || failedDraftKey === draftKey) return

    const timer = window.setTimeout(() => {
      void save()
    }, 3000)

    return () => window.clearTimeout(timer)
    // save usa el draft vigente de este render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, saving, failedDraftKey, draftKey])

  async function save(): Promise<boolean> {
    if (savePromiseRef.current) return savePromiseRef.current

    const savingDraftKey = draftKey
    const work = (async () => {
      setError('')
      setSaved('')
      setSaving(true)

      try {
        const payload = buildPayload(draft, marker)
        const response = await api.dynamicMarkers.update(marker.id, payload)
        onSaved(response.data)
        setDraft(draftFromMarker(response.data))
        setFailedDraftKey('')
        setSaved('Guardado automáticamente.')
        return true
      } catch (err) {
        setFailedDraftKey(savingDraftKey)
        setError(err instanceof Error ? err.message : 'No se pudieron guardar los cambios.')
        return false
      } finally {
        setSaving(false)
      }
    })()

    savePromiseRef.current = work

    try {
      return await work
    } finally {
      if (savePromiseRef.current === work) savePromiseRef.current = null
    }
  }

  useEffect(() => {
    if (!onRegisterFlush) return

    onRegisterFlush(() => save())
    return () => onRegisterFlush(null)
  }, [onRegisterFlush, draftKey, saving])

  return (
    <div style={styles.wrap}>
      <fieldset style={styles.fieldset} disabled={saving}>
      <section style={styles.section}>
        <h3 style={styles.title}>Información</h3>
        <Field label="Nombre">
          <input style={styles.input} value={draft.name} onChange={(event) => patch({ name: event.target.value })} maxLength={160} />
        </Field>
        <Field label="Referencia">
          <input style={styles.input} value={draft.reference} onChange={(event) => patch({ reference: event.target.value })} maxLength={120} />
        </Field>
        <Field label="Categoría">
          <input style={styles.input} value={draft.category} onChange={(event) => patch({ category: event.target.value })} maxLength={120} />
        </Field>
        <Field label="Descripción">
          <textarea style={{ ...styles.input, minHeight: 86, resize: 'vertical' }} value={draft.description} onChange={(event) => patch({ description: event.target.value })} maxLength={2000} />
        </Field>
      </section>

      <section style={styles.section}>
        <h3 style={styles.title}>Precio y disponibilidad</h3>
        <div style={styles.grid}>
          <Field label="Precio actual">
            <input style={styles.input} inputMode="decimal" value={draft.price} onChange={(event) => patch({ price: event.target.value })} placeholder="850.50" />
          </Field>
          <Field label="Precio anterior">
            <input style={styles.input} inputMode="decimal" value={draft.previousPrice} onChange={(event) => patch({ previousPrice: event.target.value })} />
          </Field>
        </div>
        <Field label="Moneda">
          <select style={styles.input} value={draft.currency} onChange={(event) => patch({ currency: event.target.value })}>
            {currencies.map((currency) => (
              <option key={currency || 'empty'} value={currency}>{currency || 'Sin definir'}</option>
            ))}
          </select>
        </Field>
        <Field label="Disponibilidad">
          <select style={styles.input} value={draft.availability} onChange={(event) => patch({ availability: event.target.value })}>
            {availabilityOptions.map((option) => (
              <option key={option || 'empty'} value={option}>{option || 'Sin definir'}</option>
            ))}
          </select>
        </Field>
      </section>

      <section style={styles.section}>
        <h3 style={styles.title}>Oferta</h3>
        <Field label="Badge">
          <input style={styles.input} value={draft.badgeText} onChange={(event) => patch({ badgeText: event.target.value })} maxLength={80} />
        </Field>
        <Field label="Texto de promoción">
          <input style={styles.input} value={draft.promotionText} onChange={(event) => patch({ promotionText: event.target.value })} maxLength={200} />
        </Field>
        <Field label="Fin de promoción">
          <input style={styles.input} type="datetime-local" value={draft.promotionEndsAt} onChange={(event) => patch({ promotionEndsAt: event.target.value })} />
        </Field>
        <Field label="Precio posterior">
          <input style={styles.input} inputMode="decimal" value={draft.postPromotionPrice} onChange={(event) => patch({ postPromotionPrice: event.target.value })} />
        </Field>
      </section>

      <section style={styles.section}>
        <h3 style={styles.title}>Apariencia</h3>
        <Field label="Color de acento">
          <div style={styles.colorRow}>
            <input style={styles.colorInput} type="color" value={/^#[0-9A-Fa-f]{6}$/.test(draft.accentColor) ? draft.accentColor : '#F59E0B'} onChange={(event) => patch({ accentColor: event.target.value.toUpperCase() })} />
            <input style={styles.input} value={draft.accentColor} onChange={(event) => patch({ accentColor: event.target.value })} placeholder="#F59E0B" maxLength={7} />
          </div>
        </Field>
      </section>
      </fieldset>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.actions} aria-live="polite">
        <span style={styles.autosaveStatus}>
          {saving
            ? 'Guardando…'
            : dirty
              ? 'Cambios pendientes: se guardarán automáticamente.'
              : saved || 'Autoguardado activo.'}
        </span>

        {error && (
          <button type="button" style={styles.retry} disabled={saving} onClick={() => void save()}>
            Reintentar ahora
          </button>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={styles.field}>
      <span style={styles.label}>{label}</span>
      {children}
    </label>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 12 },
  section: { borderTop: '1px solid #f3f4f6', paddingTop: 11, display: 'flex', flexDirection: 'column', gap: 9 },
  fieldset: { margin: 0, padding: 0, border: 'none', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 },
  title: { margin: 0, color: '#111827', fontSize: 13 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { color: '#6b7280', fontSize: 11, fontWeight: 800 },
  input: { width: '100%', minWidth: 0, border: '1px solid #d1d5db', borderRadius: 8, padding: '9px 10px', fontSize: 13, boxSizing: 'border-box', color: '#111827', background: '#fff', fontFamily: 'inherit' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 },
  colorRow: { display: 'grid', gridTemplateColumns: '42px minmax(0, 1fr)', gap: 8, alignItems: 'center' },
  colorInput: { width: 42, height: 38, padding: 2, border: '1px solid #d1d5db', borderRadius: 8, background: '#fff' },
  error: { border: '1px solid #fecaca', borderRadius: 8, background: '#fef2f2', color: '#991b1b', padding: 9, fontSize: 12, lineHeight: 1.4 },
  success: { border: '1px solid #bbf7d0', borderRadius: 8, background: '#f0fdf4', color: '#166534', padding: 9, fontSize: 12, lineHeight: 1.4 },
  actions: { display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' },
  autosaveStatus: { color: '#4b5563', fontSize: 12, fontWeight: 800 },
  retry: { border: 'none', borderRadius: 8, background: '#991b1b', color: '#fff', padding: '8px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer' },
}
