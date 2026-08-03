import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { api, type DynamicMarker, type MediaAsset } from '../lib/api'
import {
  dynamicMarkerMediaItemFromAsset,
  getDynamicMarkerThumbnail,
  mergeDynamicMarkerMediaItems,
  moveDynamicMarkerMediaItem,
  normalizeDynamicMarkerMediaItems,
  parseDynamicMarkerMediaItems,
  removeDynamicMarkerMediaItem,
  type DynamicMarkerMediaItem,
} from '../lib/dynamicMarkerMedia'
import MediaPicker from './MediaPicker'

type Props = {
  marker: DynamicMarker
  onDirtyChange: (dirty: boolean) => void
  onSaved: (marker: DynamicMarker) => void
  onRegisterFlush?: (flush: (() => Promise<boolean>) | null) => void
}

export const DYNAMIC_MARKER_MEDIA_SAVE_ERROR = 'No pudimos guardar los cambios de multimedia.'
export const DYNAMIC_MARKER_MEDIA_BANK_LABEL = 'Seleccionar del banco'

function mediaKey(item: DynamicMarkerMediaItem) {
  return String(item.id || item.url || '')
}

function mediaTitle(item: DynamicMarkerMediaItem) {
  if (typeof item.title === 'string' && item.title.trim()) return item.title.trim()
  if (typeof item.url === 'string') return item.url.split('/').pop()?.split('?')[0] || 'Recurso multimedia'
  return 'Recurso multimedia'
}

function mediaTypeLabel(type: unknown) {
  if (type === 'video') return 'Video'
  if (type === 'audio') return 'Audio'
  return 'Imagen'
}

function mediaFromMarker(marker: DynamicMarker) {
  return normalizeDynamicMarkerMediaItems(parseDynamicMarkerMediaItems(marker.media_json))
}

export default function DynamicMarkerMediaEditor({
  marker,
  onDirtyChange,
  onSaved,
  onRegisterFlush,
}: Props) {
  const [draft, setDraft] = useState<DynamicMarkerMediaItem[]>(() => mediaFromMarker(marker))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [failedDraftKey, setFailedDraftKey] = useState('')
  const savePromiseRef = useRef<Promise<boolean> | null>(null)
  const initial = useMemo(() => mediaFromMarker(marker), [marker])
  const draftKey = JSON.stringify(normalizeDynamicMarkerMediaItems(draft))
  const initialKey = JSON.stringify(normalizeDynamicMarkerMediaItems(initial))
  const dirty = draftKey !== initialKey
  const thumbnail = getDynamicMarkerThumbnail(draft)

  useEffect(() => {
    setDraft(mediaFromMarker(marker))
    setError('')
    setSaved('')
    setFailedDraftKey('')
  }, [marker])

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

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
    const payload = normalizeDynamicMarkerMediaItems(draft)

    const work = (async () => {
      setError('')
      setSaved('')
      setSaving(true)
      try {
        const response = await api.dynamicMarkers.update(marker.id, { media_json: payload })
        onSaved(response.data)
        setDraft(mediaFromMarker(response.data))
        setFailedDraftKey('')
        setSaved('Multimedia guardada automáticamente.')
        return true
      } catch {
        setFailedDraftKey(savingDraftKey)
        setError(DYNAMIC_MARKER_MEDIA_SAVE_ERROR)
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

  function handleSelect(_urls: string[], assets?: MediaAsset[]) {
    const incoming = (assets ?? [])
      .map(dynamicMarkerMediaItemFromAsset)
      .filter((item): item is DynamicMarkerMediaItem => Boolean(item))
    setDraft((current) => mergeDynamicMarkerMediaItems(current, incoming))
    setError('')
    setSaved('')
    setPickerOpen(false)
  }

  function removeItem(key: string) {
    setDraft((current) => removeDynamicMarkerMediaItem(current, key))
    setError('')
    setSaved('')
  }

  function moveItem(key: string, direction: -1 | 1) {
    setDraft((current) => moveDynamicMarkerMediaItem(current, key, direction))
    setError('')
    setSaved('')
  }

  return (
    <section style={styles.wrap}>
      <div style={styles.header}>
        <div>
          <h3 style={styles.title}>Multimedia · {draft.length}</h3>
          <p style={styles.hint}>Selecciona recursos existentes o sube nuevos archivos al banco.</p>
        </div>
        <button type="button" style={styles.secondaryBtn} disabled={saving} onClick={() => setPickerOpen(true)}>
          {DYNAMIC_MARKER_MEDIA_BANK_LABEL}
        </button>
      </div>

      {thumbnail && (
        <div style={styles.coverNote}>
          Portada actual: primera imagen pública por orden.
        </div>
      )}

      {draft.length === 0 ? (
        <div style={styles.empty}>Sin multimedia.</div>
      ) : (
        <div style={styles.list}>
          {draft.map((item, index) => {
            const key = mediaKey(item)
            const isCover = Boolean(thumbnail && item.type === 'image' && (item.thumbnail_url === thumbnail || item.url === thumbnail))
            return (
              <div key={key || index} style={styles.item}>
                <MediaThumb item={item} />
                <div style={styles.info}>
                  <strong style={styles.name}>{mediaTitle(item)}</strong>
                  <span style={styles.meta}>{mediaTypeLabel(item.type)} · Orden {index + 1}</span>
                  {isCover && <span style={styles.coverBadge}>Portada</span>}
                </div>
                <div style={styles.itemActions}>
                  <button type="button" style={styles.iconBtn} disabled={saving || index === 0} onClick={() => moveItem(key, -1)}>Subir</button>
                  <button type="button" style={styles.iconBtn} disabled={saving || index === draft.length - 1} onClick={() => moveItem(key, 1)}>Bajar</button>
                  <button type="button" style={styles.removeBtn} disabled={saving} onClick={() => removeItem(key)}>Quitar de esta ficha</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.status} aria-live="polite">
        {saving
          ? 'Guardando multimedia...'
          : dirty
            ? 'Cambios de multimedia pendientes: se guardarán automáticamente.'
            : saved || 'Multimedia sincronizada.'}
      </div>

      <MediaPicker
        open={pickerOpen}
        publicationId={marker.publication_id}
        mode="media"
        multiple
        title="Seleccionar multimedia"
        onClose={() => setPickerOpen(false)}
        onSelect={handleSelect}
      />
    </section>
  )
}

function MediaThumb({ item }: { item: DynamicMarkerMediaItem }) {
  if (item.type === 'image') return <img src={String(item.thumbnail_url || item.url)} alt="" style={styles.thumb} />
  if (item.type === 'video') return <div style={styles.typeThumb}>Video</div>
  return <div style={styles.typeThumb}>Audio</div>
}

const styles: Record<string, CSSProperties> = {
  wrap: { borderTop: '1px solid #f3f4f6', paddingTop: 11, display: 'flex', flexDirection: 'column', gap: 10 },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  title: { margin: 0, color: '#111827', fontSize: 13 },
  hint: { margin: '4px 0 0', color: '#6b7280', fontSize: 11.5, lineHeight: 1.35 },
  secondaryBtn: { border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', color: '#374151', padding: '8px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer' },
  coverNote: { border: '1px solid #dbeafe', borderRadius: 8, background: '#eff6ff', color: '#1d4ed8', padding: 8, fontSize: 11.5, fontWeight: 750 },
  empty: { border: '1px dashed #d1d5db', borderRadius: 8, color: '#6b7280', padding: 12, fontSize: 12, textAlign: 'center' },
  list: { display: 'flex', flexDirection: 'column', gap: 8 },
  item: { border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', padding: 8, display: 'grid', gridTemplateColumns: '58px minmax(0, 1fr)', gap: 9, alignItems: 'center' },
  thumb: { width: 58, height: 48, objectFit: 'cover', borderRadius: 7, background: '#eef2ff', display: 'block' },
  typeThumb: { width: 58, height: 48, borderRadius: 7, background: '#eef2ff', color: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 850 },
  info: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 },
  name: { color: '#111827', fontSize: 12.5, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  meta: { color: '#6b7280', fontSize: 11.5 },
  coverBadge: { width: 'fit-content', borderRadius: 999, background: '#dcfce7', color: '#166534', padding: '2px 7px', fontSize: 10.5, fontWeight: 850 },
  itemActions: { gridColumn: '1 / -1', display: 'flex', gap: 7, flexWrap: 'wrap' },
  iconBtn: { border: '1px solid #d1d5db', borderRadius: 7, background: '#fff', color: '#374151', padding: '6px 8px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' },
  removeBtn: { border: '1px solid #fecaca', borderRadius: 7, background: '#fff', color: '#b91c1c', padding: '6px 8px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' },
  error: { border: '1px solid #fecaca', borderRadius: 8, background: '#fef2f2', color: '#991b1b', padding: 9, fontSize: 12, lineHeight: 1.4 },
  status: { color: '#4b5563', fontSize: 12, fontWeight: 800 },
}
