import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { api, type DynamicMarkerCatalogItem } from '../lib/api'

const PAGE_SIZE = 12

function statusLabel(status: DynamicMarkerCatalogItem['status']) {
  if (status === 'active') return 'Activa'
  if (status === 'inactive') return 'Inactiva'
  return 'Borrador'
}

function statusStyle(status: DynamicMarkerCatalogItem['status']): CSSProperties {
  if (status === 'active') return { color: '#047857', background: '#ecfdf5', borderColor: '#a7f3d0' }
  if (status === 'inactive') return { color: '#6b7280', background: '#f3f4f6', borderColor: '#e5e7eb' }
  return { color: '#92400e', background: '#fffbeb', borderColor: '#fde68a' }
}

function mergeUnique(current: DynamicMarkerCatalogItem[], incoming: DynamicMarkerCatalogItem[]) {
  const known = new Set(current.map((item) => item.id))
  return [...current, ...incoming.filter((item) => !known.has(item.id))]
}

function markerLabel(item: DynamicMarkerCatalogItem) {
  return item.name?.trim() || 'Ficha sin nombre'
}

type Props = {
  value?: string | null
  publicationId?: string
  onChange: (markerId: string | null) => void
}

export default function DynamicMarkerSelector({ value, publicationId, onChange }: Props) {
  const [query, setQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [items, setItems] = useState<DynamicMarkerCatalogItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const selected = useMemo(() => items.find((item) => item.id === value) ?? null, [items, value])

  async function load({ append = false, cursor = '', term = activeQuery }: { append?: boolean; cursor?: string; term?: string } = {}) {
    if (append && !cursor) return
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError('')

    try {
      const response = await api.dynamicMarkers.catalog({
        limit: PAGE_SIZE,
        cursor: append ? cursor : null,
        q: term || undefined,
        publication_id: publicationId,
      })
      const incoming = response.data ?? []
      setItems((current) => (append ? mergeUnique(current, incoming) : incoming))
      setNextCursor(response.page?.next_cursor ?? null)
      setLoaded(true)
    } catch (err) {
      if (!append) setItems([])
      setNextCursor(null)
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las fichas.')
    } finally {
      if (append) setLoadingMore(false)
      else setLoading(false)
    }
  }

  useEffect(() => {
    setQuery('')
    setActiveQuery('')
    setItems([])
    setNextCursor(null)
    setLoaded(false)
    void load({ term: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicationId])

  function runSearch() {
    const term = query.trim()
    setActiveQuery(term)
    void load({ term })
  }

  function clearSearch(nextValue: string) {
    setQuery(nextValue)
    if (!nextValue.trim() && activeQuery) {
      setActiveQuery('')
      void load({ term: '' })
    }
  }

  return (
    <div style={styles.wrap}>
      <button
        type="button"
        style={{ ...styles.noneOption, ...(!value ? styles.selectedOption : {}) }}
        onClick={() => onChange(null)}
      >
        <span>
          <strong>Sin ficha</strong>
          <small>Este objeto no abrirá una ficha interactiva.</small>
        </span>
      </button>

      {value && selected && (
        <div style={styles.current}>
          Seleccionada: <strong>{markerLabel(selected)}</strong>
          {selected.reference ? ` · Ref. ${selected.reference}` : ''}
        </div>
      )}

      <div style={styles.searchRow}>
        <input
          style={styles.input}
          value={query}
          onChange={(event) => clearSearch(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') runSearch() }}
          placeholder="Buscar ficha"
        />
        <button type="button" style={styles.searchBtn} disabled={loading} onClick={runSearch}>
          {loading ? 'Buscando...' : 'Buscar'}
        </button>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {!loaded && loading ? (
        <div style={styles.state}>Cargando fichas...</div>
      ) : !items.length ? (
        <div style={styles.state}>No hay fichas para mostrar.</div>
      ) : (
        <div style={styles.list}>
          {items.map((item) => {
            const selectedItem = item.id === value
            return (
              <button
                key={item.id}
                type="button"
                style={{ ...styles.item, ...(selectedItem ? styles.selectedOption : {}) }}
                onClick={() => onChange(item.id)}
              >
                <span style={styles.itemHead}>
                  <strong>{markerLabel(item)}</strong>
                  <span style={{ ...styles.status, ...statusStyle(item.status) }}>{statusLabel(item.status)}</span>
                </span>
                <span style={styles.meta}>
                  {item.reference ? `Ref. ${item.reference}` : 'Sin referencia'}
                </span>
                <span style={styles.meta}>
                  {item.publication_title || 'Publicación'} · {item.page_number ? `Página ${item.page_number}` : 'Página sin identificar'}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {nextCursor && (
        <button
          type="button"
          style={styles.moreBtn}
          disabled={loadingMore}
          onClick={() => void load({ append: true, cursor: nextCursor })}
        >
          {loadingMore ? 'Cargando...' : 'Cargar más fichas'}
        </button>
      )}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 10 },
  searchRow: { display: 'flex', gap: 8 },
  input: { flex: 1, minWidth: 0, border: '1px solid #d1d5db', borderRadius: 8, padding: '9px 10px', fontSize: 13 },
  searchBtn: { border: '1px solid #4f46e5', borderRadius: 8, background: '#4f46e5', color: '#fff', padding: '0 12px', fontWeight: 800, cursor: 'pointer' },
  noneOption: { width: '100%', border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', padding: 10, textAlign: 'left', cursor: 'pointer' },
  selectedOption: { borderColor: '#4f46e5', boxShadow: '0 0 0 2px rgba(79,70,229,.12)' },
  current: { border: '1px solid #e0e7ff', borderRadius: 8, background: '#eef2ff', color: '#3730a3', padding: 9, fontSize: 12 },
  list: { display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto', paddingRight: 2 },
  item: { width: '100%', display: 'flex', flexDirection: 'column', gap: 5, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', padding: 10, textAlign: 'left', cursor: 'pointer' },
  itemHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, color: '#111827', fontSize: 13 },
  status: { border: '1px solid', borderRadius: 999, padding: '2px 7px', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' },
  meta: { color: '#6b7280', fontSize: 12 },
  error: { border: '1px solid #fecaca', borderRadius: 8, background: '#fef2f2', color: '#991b1b', padding: 9, fontSize: 12 },
  state: { border: '1px dashed #d1d5db', borderRadius: 8, color: '#6b7280', padding: 12, fontSize: 12, textAlign: 'center' },
  moreBtn: { border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', padding: '9px 12px', color: '#374151', fontWeight: 800, cursor: 'pointer' },
}
