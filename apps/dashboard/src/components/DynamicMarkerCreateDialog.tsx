import { useEffect, useId, useState, type CSSProperties } from 'react'
import { type CreateIndependentDynamicMarkerInput, type MediaAsset } from '../lib/api'
import {
  DYNAMIC_MARKER_CREATE_AVAILABILITY_OPTIONS,
  DYNAMIC_MARKER_CREATE_CURRENCY_OPTIONS,
  DYNAMIC_MARKER_CREATE_GENERIC_ERROR,
  DYNAMIC_MARKER_CREATE_NO_PUBLICATIONS,
  DYNAMIC_MARKER_CREATE_SAVING_LABEL,
  DYNAMIC_MARKER_CREATE_SUBMIT_LABEL,
  buildDynamicMarkerCreateIndependentInput,
  dynamicMarkerCreateInitialForm,
  validateDynamicMarkerCreateForm,
  withDynamicMarkerCreateMediaItems,
  type DynamicMarkerCreateFormState,
  type DynamicMarkerCreatePublication,
} from '../lib/dynamicMarkerCreate'
import {
  dynamicMarkerMediaItemFromAsset,
  mergeDynamicMarkerMediaItems,
  removeDynamicMarkerMediaItem,
  type DynamicMarkerMediaItem,
} from '../lib/dynamicMarkerMedia'
import MediaPicker from './MediaPicker'

type Props = {
  publications: DynamicMarkerCreatePublication[]
  publicationsLoading?: boolean
  publicationsError?: string
  preferredPublicationId?: string
  onClose: () => void
  onCreate: (input: CreateIndependentDynamicMarkerInput) => Promise<void>
}

export default function DynamicMarkerCreateDialog({
  publications,
  publicationsLoading = false,
  publicationsError = '',
  preferredPublicationId = '',
  onClose,
  onCreate,
}: Props) {
  const titleId = useId()
  const [form, setForm] = useState<DynamicMarkerCreateFormState>(() => (
    dynamicMarkerCreateInitialForm(publications, preferredPublicationId)
  ))
  const [errors, setErrors] = useState<ReturnType<typeof validateDynamicMarkerCreateForm>['errors']>({})
  const [media, setMedia] = useState<DynamicMarkerMediaItem[]>([])
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [progressMessage, setProgressMessage] = useState('')

  useEffect(() => {
    setForm((current) => {
      if (current.publicationId) return current
      const next = dynamicMarkerCreateInitialForm(publications, preferredPublicationId)
      return { ...current, publicationId: next.publicationId }
    })
  }, [preferredPublicationId, publications])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, saving])

  function update<K extends keyof DynamicMarkerCreateFormState>(key: K, value: DynamicMarkerCreateFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors({})
    setSubmitError('')
  }

  function removeMedia(id: string) {
    if (saving) return
    setMedia((current) => removeDynamicMarkerMediaItem(current, id))
  }

  async function submit() {
    if (saving) return

    const validation = validateDynamicMarkerCreateForm(form, publications)
    setErrors(validation.errors)
    setSubmitError('')
    if (!validation.valid) return

    setSaving(true)
    setProgressMessage(DYNAMIC_MARKER_CREATE_SAVING_LABEL)
    try {
      const input = withDynamicMarkerCreateMediaItems(
        buildDynamicMarkerCreateIndependentInput(form, publications),
        media,
      )
      await onCreate(input)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : DYNAMIC_MARKER_CREATE_GENERIC_ERROR)
    } finally {
      setSaving(false)
      setProgressMessage('')
    }
  }

  const canCreate = publications.length > 0 && !publicationsLoading
  const publicationMessage = publicationsError || errors.publications
  const selectedPublicationId = form.publicationId.trim()

  function handleMediaPickerSelect(_urls: string[], assets?: MediaAsset[]) {
    const incoming = (assets ?? [])
      .map(dynamicMarkerMediaItemFromAsset)
      .filter((item): item is DynamicMarkerMediaItem => Boolean(item))
    setMedia((current) => mergeDynamicMarkerMediaItems(current, incoming))
    setSubmitError('')
    setMediaPickerOpen(false)
  }

  return (
    <div
      style={s.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose()
      }}
    >
      <section role="dialog" aria-modal="true" aria-labelledby={titleId} style={s.dialog}>
        <header style={s.header}>
          <div>
            <h2 id={titleId} style={s.title}>Nueva ficha</h2>
            <p style={s.subtitle}>Crea una ficha sin vincularla todavía a un objeto del lienzo.</p>
          </div>
          <button type="button" aria-label="Cerrar" style={s.closeBtn} disabled={saving} onClick={onClose}>
            ×
          </button>
        </header>

        <div style={s.body}>
          {publicationMessage && <div style={s.notice}>{publicationMessage}</div>}
          {!publicationMessage && !publicationsLoading && !publications.length && (
            <div style={s.notice}>{DYNAMIC_MARKER_CREATE_NO_PUBLICATIONS}</div>
          )}

          <label style={s.label}>
            Publicación
            <select
              style={s.input}
              value={form.publicationId}
              disabled={saving || publicationsLoading || !publications.length}
              onChange={(event) => update('publicationId', event.target.value)}
            >
              <option value="">{publicationsLoading ? 'Cargando publicaciones...' : 'Selecciona una publicación'}</option>
              {publications.map((publication) => (
                <option key={publication.id} value={publication.id}>{publication.title || 'Publicación sin título'}</option>
              ))}
            </select>
            {errors.publicationId && <span style={s.fieldError}>{errors.publicationId}</span>}
          </label>

          <label style={s.label}>
            Nombre
            <input
              style={s.input}
              value={form.name}
              maxLength={180}
              disabled={saving || !canCreate}
              onChange={(event) => update('name', event.target.value)}
              placeholder="Nombre de la ficha"
            />
            {errors.name && <span style={s.fieldError}>{errors.name}</span>}
          </label>

          <div style={s.grid}>
            <label style={s.label}>
              Referencia
              <input
                style={s.input}
                value={form.reference}
                maxLength={120}
                disabled={saving || !canCreate}
                onChange={(event) => update('reference', event.target.value)}
                placeholder="SKU o referencia"
              />
            </label>

            <label style={s.label}>
              Categoría
              <input
                style={s.input}
                value={form.category}
                maxLength={120}
                disabled={saving || !canCreate}
                onChange={(event) => update('category', event.target.value)}
                placeholder="Categoría"
              />
            </label>
          </div>

          <label style={s.label}>
            Descripción
            <textarea
              style={s.textarea}
              value={form.description}
              maxLength={2000}
              rows={3}
              disabled={saving || !canCreate}
              onChange={(event) => update('description', event.target.value)}
              placeholder="Descripción breve"
            />
          </label>

          <div style={s.grid}>
            <label style={s.label}>
              Precio
              <input
                style={s.input}
                value={form.price}
                inputMode="decimal"
                disabled={saving || !canCreate}
                onChange={(event) => update('price', event.target.value)}
                placeholder="0.00"
              />
              {errors.price && <span style={s.fieldError}>{errors.price}</span>}
            </label>

            <label style={s.label}>
              Moneda
              <select
                style={s.input}
                value={form.currency}
                disabled={saving || !canCreate}
                onChange={(event) => update('currency', event.target.value)}
              >
                {DYNAMIC_MARKER_CREATE_CURRENCY_OPTIONS.map((currency) => (
                  <option key={currency || 'empty'} value={currency}>{currency || 'Sin definir'}</option>
                ))}
              </select>
              {errors.currency && <span style={s.fieldError}>{errors.currency}</span>}
            </label>
          </div>

          <div style={s.grid}>
            <label style={s.label}>
              Disponibilidad
              <select
                style={s.input}
                value={form.availability}
                disabled={saving || !canCreate}
                onChange={(event) => update('availability', event.target.value)}
              >
                {DYNAMIC_MARKER_CREATE_AVAILABILITY_OPTIONS.map((availability) => (
                  <option key={availability || 'empty'} value={availability}>{availability || 'Sin definir'}</option>
                ))}
              </select>
              {errors.availability && <span style={s.fieldError}>{errors.availability}</span>}
            </label>

            <label style={s.label}>
              Color de acento
              <input
                style={s.colorInput}
                type="color"
                value={form.accentColor}
                disabled={saving || !canCreate}
                onChange={(event) => update('accentColor', event.target.value)}
              />
            </label>
          </div>

          <section style={s.mediaSection}>
            <div style={s.mediaHeader}>
              <div>
                <h3 style={s.mediaTitle}>Multimedia</h3>
                <p style={s.mediaHint}>Selecciona recursos existentes o sube nuevos archivos al banco.</p>
              </div>
              <button
                type="button"
                style={s.secondaryBtn}
                disabled={saving || !canCreate || !selectedPublicationId}
                onClick={() => setMediaPickerOpen(true)}
              >
                Seleccionar del banco
              </button>
            </div>

            {media.length > 0 && (
              <div style={s.mediaList}>
                {media.map((item) => (
                  <div key={String(item.id || item.url)} style={s.mediaItem}>
                    <MediaPreview item={item} />
                    <div style={s.mediaInfo}>
                      <strong style={s.mediaName}>{mediaTitle(item)}</strong>
                      <span style={s.mediaMeta}>{mediaTypeLabel(item.type)}</span>
                    </div>
                    <button type="button" style={s.removeBtn} disabled={saving} onClick={() => removeMedia(String(item.id || item.url))}>
                      Quitar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {submitError && <div style={s.error}>{submitError}</div>}
          {progressMessage && <div style={s.notice}>{progressMessage}</div>}
        </div>

        <footer style={s.footer}>
          <button type="button" style={s.secondaryBtn} disabled={saving} onClick={onClose}>Cancelar</button>
          <button
            type="button"
            style={{ ...s.primaryBtn, ...(saving || !canCreate ? s.disabledBtn : {}) }}
            disabled={saving || !canCreate}
            onClick={() => void submit()}
          >
            {saving ? (progressMessage || DYNAMIC_MARKER_CREATE_SAVING_LABEL) : DYNAMIC_MARKER_CREATE_SUBMIT_LABEL}
          </button>
        </footer>
      </section>
      {selectedPublicationId && (
        <MediaPicker
          open={mediaPickerOpen}
          publicationId={selectedPublicationId}
          mode="media"
          multiple
          title="Seleccionar multimedia"
          onClose={() => setMediaPickerOpen(false)}
          onSelect={handleMediaPickerSelect}
        />
      )}
    </div>
  )
}

function MediaPreview({ item }: { item: DynamicMarkerMediaItem }) {
  if (item.type === 'image') {
    return <img src={String(item.thumbnail_url || item.url)} alt="" style={s.mediaPreview} />
  }
  if (item.type === 'video') {
    return <div style={s.audioPreview}>Video</div>
  }
  if (item.type === 'audio') {
    return <div style={s.audioPreview}>Audio</div>
  }
  return null
}

function mediaTypeLabel(type: unknown) {
  if (type === 'video') return 'Video'
  if (type === 'audio') return 'Audio'
  return 'Imagen'
}

function mediaTitle(item: DynamicMarkerMediaItem) {
  if (typeof item.title === 'string' && item.title.trim()) return item.title.trim()
  if (typeof item.url === 'string') return item.url.split('/').pop()?.split('?')[0] || 'Recurso multimedia'
  return 'Recurso multimedia'
}

const s: Record<string, CSSProperties> = {
  backdrop: { position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(17,24,39,.48)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 },
  dialog: { width: 'min(560px, calc(100vw - 28px))', maxHeight: 'calc(100vh - 28px)', overflow: 'auto', borderRadius: 10, background: '#fff', boxShadow: '0 24px 80px rgba(15,23,42,.28)', border: '1px solid #e5e7eb' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '18px 18px 12px', borderBottom: '1px solid #f3f4f6' },
  title: { margin: 0, color: '#111827', fontSize: 18, lineHeight: 1.2 },
  subtitle: { margin: '5px 0 0', color: '#6b7280', fontSize: 13, lineHeight: 1.45 },
  closeBtn: { border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', color: '#374151', width: 34, height: 34, fontSize: 20, lineHeight: 1, cursor: 'pointer' },
  body: { display: 'flex', flexDirection: 'column', gap: 12, padding: 18 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 },
  label: { display: 'flex', flexDirection: 'column', gap: 5, color: '#4b5563', fontSize: 12, fontWeight: 800 },
  input: { width: '100%', minWidth: 0, minHeight: 40, border: '1px solid #d1d5db', borderRadius: 8, padding: '9px 10px', color: '#111827', background: '#fff', font: 'inherit', boxSizing: 'border-box' },
  textarea: { width: '100%', minWidth: 0, border: '1px solid #d1d5db', borderRadius: 8, padding: '9px 10px', color: '#111827', background: '#fff', font: 'inherit', resize: 'vertical', boxSizing: 'border-box' },
  colorInput: { width: '100%', minWidth: 0, minHeight: 40, border: '1px solid #d1d5db', borderRadius: 8, padding: 4, background: '#fff', boxSizing: 'border-box' },
  fieldError: { color: '#b91c1c', fontSize: 11.5, fontWeight: 750 },
  notice: { border: '1px solid #fde68a', borderRadius: 8, background: '#fffbeb', color: '#92400e', padding: 9, fontSize: 12.5, lineHeight: 1.4 },
  error: { border: '1px solid #fecaca', borderRadius: 8, background: '#fef2f2', color: '#991b1b', padding: 9, fontSize: 12.5, lineHeight: 1.4 },
  mediaSection: { border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb', padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 },
  mediaHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' },
  mediaTitle: { margin: 0, color: '#111827', fontSize: 13, lineHeight: 1.25 },
  mediaHint: { margin: '4px 0 0', color: '#6b7280', fontSize: 11.5, lineHeight: 1.35 },
  mediaList: { display: 'flex', flexDirection: 'column', gap: 8 },
  mediaItem: { border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', padding: 8, display: 'grid', gridTemplateColumns: '58px minmax(0, 1fr) auto', gap: 9, alignItems: 'center' },
  mediaPreview: { width: 58, height: 48, borderRadius: 7, objectFit: 'cover', background: '#eef2ff', display: 'block' },
  audioPreview: { width: 58, height: 48, borderRadius: 7, background: '#eef2ff', color: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 850 },
  mediaInfo: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 },
  mediaName: { color: '#111827', fontSize: 12.5, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  mediaMeta: { color: '#6b7280', fontSize: 11.5 },
  mediaStatus: { color: '#6b7280', fontSize: 11.5, fontWeight: 750 },
  mediaSuccess: { color: '#047857', fontSize: 11.5, fontWeight: 800 },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 9, flexWrap: 'wrap', padding: '12px 18px 18px', borderTop: '1px solid #f3f4f6' },
  primaryBtn: { border: 'none', borderRadius: 8, background: '#4f46e5', color: '#fff', padding: '10px 14px', fontSize: 13, fontWeight: 850, cursor: 'pointer' },
  secondaryBtn: { border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', color: '#374151', padding: '9px 13px', fontSize: 13, fontWeight: 800, cursor: 'pointer' },
  removeBtn: { border: '1px solid #fecaca', borderRadius: 8, background: '#fff', color: '#b91c1c', padding: '7px 9px', fontSize: 12, fontWeight: 800, cursor: 'pointer' },
  disabledBtn: { cursor: 'not-allowed', opacity: 0.62 },
}
