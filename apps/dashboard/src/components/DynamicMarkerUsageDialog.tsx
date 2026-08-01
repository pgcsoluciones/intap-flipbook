import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { api, type DynamicMarkerUsage } from '../lib/api'
import {
  dynamicMarkerUsageObjectLabel,
  dynamicMarkerUsageSourceLabel,
  dynamicMarkerUsageSummary,
} from '../lib/dynamicMarkerUsageDisplay'

type Props = {
  markerId: string
  markerName: string
  initialUsageCount?: number
  onClose: () => void
}

type State = {
  loading: boolean
  error: string
  usages: DynamicMarkerUsage[]
  usageCount: number
}

export default function DynamicMarkerUsageDialog({ markerId, markerName, initialUsageCount = 0, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const [state, setState] = useState<State>({
    loading: true,
    error: '',
    usages: [],
    usageCount: initialUsageCount,
  })

  async function load() {
    setState((current) => ({ ...current, loading: true, error: '' }))
    try {
      const response = await api.dynamicMarkers.usages(markerId)
      setState({
        loading: false,
        error: '',
        usages: response.data.usages ?? [],
        usageCount: response.data.usage_count ?? 0,
      })
    } catch {
      setState((current) => ({
        ...current,
        loading: false,
        error: 'No pudimos consultar los usos de esta ficha.',
      }))
    }
  }

  useEffect(() => {
    closeRef.current?.focus()
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markerId])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  return (
    <div style={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="dynamic-marker-usage-title"
        style={styles.modal}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header style={styles.header}>
          <div style={styles.titleBlock}>
            <h2 id="dynamic-marker-usage-title" style={styles.title}>Dónde se utiliza</h2>
            <span style={styles.subtitle}>{markerName || 'Ficha sin nombre'} · {dynamicMarkerUsageSummary(state.usageCount)}</span>
          </div>
          <button ref={closeRef} type="button" style={styles.closeBtn} onClick={onClose}>
            Cerrar
          </button>
        </header>

        <div style={styles.body}>
          {state.loading ? (
            <div style={styles.state}>Consultando dónde se utiliza esta ficha...</div>
          ) : state.error ? (
            <div style={styles.state}>
              <strong>No pudimos consultar los usos de esta ficha.</strong>
              <button type="button" style={styles.retryBtn} onClick={() => void load()}>Reintentar</button>
            </div>
          ) : !state.usages.length ? (
            <div style={styles.state}>Esta ficha todavía no está vinculada a ningún elemento.</div>
          ) : (
            <div style={styles.list}>
              {state.usages.map((usage, index) => (
                <article key={`${usage.publication_id}:${usage.page_id}:${usage.element_id ?? index}:${usage.sources.join('-')}`} style={styles.item}>
                  <div style={styles.itemMain}>
                    <strong style={styles.publication}>{usage.publication_name || 'Publicación'}</strong>
                    <span style={styles.page}>Página {usage.page_number || 'sin identificar'}</span>
                  </div>
                  <span style={styles.object}>{dynamicMarkerUsageObjectLabel(usage)}</span>
                  <div style={styles.metaRow}>
                    <span style={styles.source}>{dynamicMarkerUsageSourceLabel(usage.sources)}</span>
                    {usage.public_slug && <span style={styles.slug}>/{usage.public_slug}</span>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 5400, background: 'rgba(17, 24, 39, 0.58)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 },
  modal: { width: 640, maxWidth: '100%', maxHeight: '86vh', background: '#fff', borderRadius: 8, boxShadow: '0 22px 70px rgba(15, 23, 42, 0.32)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '16px 18px', borderBottom: '1px solid #e5e7eb' },
  titleBlock: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  title: { margin: 0, color: '#111827', fontSize: 18, lineHeight: 1.25 },
  subtitle: { color: '#6b7280', fontSize: 13, lineHeight: 1.35, overflowWrap: 'anywhere' },
  closeBtn: { border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', color: '#374151', padding: '8px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' },
  body: { padding: 16, overflowY: 'auto' },
  state: { border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb', minHeight: 140, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#6b7280', textAlign: 'center', padding: 16, fontSize: 13, lineHeight: 1.45 },
  retryBtn: { border: 'none', borderRadius: 8, background: '#4f46e5', color: '#fff', padding: '8px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer' },
  list: { display: 'flex', flexDirection: 'column', gap: 9 },
  item: { border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', padding: 12, display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 },
  itemMain: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' },
  publication: { color: '#111827', fontSize: 14, lineHeight: 1.3, overflowWrap: 'anywhere' },
  page: { color: '#374151', fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap' },
  object: { color: '#4b5563', fontSize: 13, lineHeight: 1.35, overflowWrap: 'anywhere' },
  metaRow: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  source: { border: '1px solid #bfdbfe', borderRadius: 999, background: '#eff6ff', color: '#1d4ed8', padding: '3px 8px', fontSize: 11.5, fontWeight: 800 },
  slug: { color: '#6b7280', fontSize: 11.5, overflowWrap: 'anywhere' },
}
