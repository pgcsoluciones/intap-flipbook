import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { api, type DynamicMarkerCatalogItem } from '../lib/api'
import DynamicMarkerUsageDialog from './DynamicMarkerUsageDialog'
import { canOpenDynamicMarkerUsage, dynamicMarkerUsageBadgeLabel } from '../lib/dynamicMarkerUsageDisplay'

export const DYNAMIC_MARKER_SELECTOR_PAGE_SIZE = 5
const PAGE_SIZE = DYNAMIC_MARKER_SELECTOR_PAGE_SIZE

export type DynamicMarkerSelectorCatalogPage = {
  has_more: boolean
  next_cursor: string | null
}

const EMPTY_PAGE: DynamicMarkerSelectorCatalogPage = {
  has_more: false,
  next_cursor: null,
}

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

function markerLabel(item: DynamicMarkerCatalogItem) {
  return item.name?.trim() || 'Ficha sin nombre'
}

export function getDynamicMarkerSelectorCursor(cursorHistory: Array<string | null>, pageIndex: number) {
  return cursorHistory[pageIndex] ?? null
}

export function rememberDynamicMarkerSelectorCursor(
  cursorHistory: Array<string | null>,
  pageIndex: number,
  cursor: string | null,
) {
  const next = cursorHistory.slice(0, pageIndex)
  next[pageIndex] = cursor
  return next.length ? next : [null]
}

export function resetDynamicMarkerSelectorCursorHistory() {
  return [null] as Array<string | null>
}

export function replaceDynamicMarkerSelectorResults<T>(_current: T[], incoming: T[]) {
  return incoming
}

export function isDynamicMarkerSelectorPreviousDisabled(pageIndex: number, loading = false) {
  return pageIndex === 0 || loading
}

export function isDynamicMarkerSelectorNextDisabled(page: DynamicMarkerSelectorCatalogPage, loading = false) {
  return !page.has_more || !page.next_cursor || loading
}

export function shouldOpenDynamicMarkerUsage(event: { preventDefault: () => void; stopPropagation: () => void }) {
  event.preventDefault()
  event.stopPropagation()
  return true
}

export function keepDynamicMarkerSelectorValueOnPageChange(currentValue: string | null | undefined) {
  return currentValue ?? null
}

type Props = {
  value?: string | null
  publicationId?: string
  onChange: (markerId: string | null) => void
}

export default function DynamicMarkerSelector({ value, publicationId, onChange }: Props) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const [query, setQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [items, setItems] = useState<DynamicMarkerCatalogItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [page, setPage] = useState<DynamicMarkerSelectorCatalogPage>(EMPTY_PAGE)
  const [pageIndex, setPageIndex] = useState(0)
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([null])
  const [selectedMarker, setSelectedMarker] = useState<DynamicMarkerCatalogItem | null>(null)
  const [usageDialogItem, setUsageDialogItem] = useState<DynamicMarkerCatalogItem | null>(null)

  async function load({
    cursor = null,
    nextPageIndex = 0,
    term = activeQuery,
  }: {
    cursor?: string | null
    nextPageIndex?: number
    term?: string
  } = {}) {
    setLoading(true)
    setError('')

    try {
      const response = await api.dynamicMarkers.catalog({
        limit: PAGE_SIZE,
        cursor,
        q: term || undefined,
        publication_id: publicationId,
      })
      const incoming = response.data ?? []
      setItems((current) => replaceDynamicMarkerSelectorResults(current, incoming))
      setPage(response.page ?? EMPTY_PAGE)
      setPageIndex(nextPageIndex)
      setCursorHistory((current) => rememberDynamicMarkerSelectorCursor(current, nextPageIndex, cursor))
      setSelectedMarker((current) => incoming.find((item) => item.id === value) ?? current)
      setLoaded(true)
      listRef.current?.scrollTo({ top: 0 })
    } catch (err) {
      setItems([])
      setPage(EMPTY_PAGE)
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las fichas.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setQuery('')
    setActiveQuery('')
    setItems([])
    setPage(EMPTY_PAGE)
    setPageIndex(0)
    setCursorHistory(resetDynamicMarkerSelectorCursorHistory())
    setSelectedMarker(null)
    setLoaded(false)
    void load({ term: '', cursor: null, nextPageIndex: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicationId])

  useEffect(() => {
    if (!value) {
      setSelectedMarker(null)
      return
    }
    const match = items.find((item) => item.id === value)
    if (match) setSelectedMarker(match)
  }, [items, value])

  function runSearch() {
    const term = query.trim()
    setActiveQuery(term)
    setCursorHistory(resetDynamicMarkerSelectorCursorHistory())
    void load({ term, cursor: null, nextPageIndex: 0 })
  }

  function clearSearch(nextValue: string) {
    setQuery(nextValue)
    if (!nextValue.trim() && activeQuery) {
      setActiveQuery('')
      setCursorHistory(resetDynamicMarkerSelectorCursorHistory())
      void load({ term: '', cursor: null, nextPageIndex: 0 })
    }
  }

  function goToPreviousPage() {
    if (isDynamicMarkerSelectorPreviousDisabled(pageIndex, loading)) return
    keepDynamicMarkerSelectorValueOnPageChange(value)
    const nextPageIndex = pageIndex - 1
    void load({
      term: activeQuery,
      cursor: getDynamicMarkerSelectorCursor(cursorHistory, nextPageIndex),
      nextPageIndex,
    })
  }

  function goToNextPage() {
    if (isDynamicMarkerSelectorNextDisabled(page, loading)) return
    keepDynamicMarkerSelectorValueOnPageChange(value)
    const nextPageIndex = pageIndex + 1
    void load({
      term: activeQuery,
      cursor: page.next_cursor,
      nextPageIndex,
    })
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

      {value && selectedMarker && (
        <div style={styles.current}>
          Seleccionada: <strong>{markerLabel(selectedMarker)}</strong>
          {selectedMarker.reference ? ` · Ref. ${selectedMarker.reference}` : ''}
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
        <div ref={listRef} style={styles.list}>
          {items.map((item) => {
            const selectedItem = item.id === value
            return (
              <div
                key={item.id}
                style={{ ...styles.item, ...(selectedItem ? styles.selectedOption : {}) }}
              >
                <button
                  type="button"
                  style={styles.itemSelect}
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
                <span style={styles.usageRow}>
                  <span style={{ ...styles.usageBadge, ...(item.is_in_use ? styles.usageBadgeActive : styles.usageBadgeIdle) }}>
                    {dynamicMarkerUsageBadgeLabel(item.usage_count ?? 0)}
                  </span>
                  {canOpenDynamicMarkerUsage(item.usage_count ?? 0) && (
                    <button
                      type="button"
                      style={styles.usageLink}
                      onClick={(event) => {
                        shouldOpenDynamicMarkerUsage(event)
                        setUsageDialogItem(item)
                      }}
                    >
                      Ver dónde se utiliza
                    </button>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {loaded && items.length > 0 && (
        <div style={styles.pagination} aria-label="Paginación de fichas interactivas">
          <button
            type="button"
            style={{ ...styles.pageBtn, ...(isDynamicMarkerSelectorPreviousDisabled(pageIndex, loading) ? styles.pageBtnDisabled : {}) }}
            disabled={isDynamicMarkerSelectorPreviousDisabled(pageIndex, loading)}
            onClick={goToPreviousPage}
          >
            Anterior
          </button>
          <span style={styles.pageIndicator}>Página {pageIndex + 1}</span>
          <button
            type="button"
            style={{ ...styles.pageBtn, ...(isDynamicMarkerSelectorNextDisabled(page, loading) ? styles.pageBtnDisabled : {}) }}
            disabled={isDynamicMarkerSelectorNextDisabled(page, loading)}
            onClick={goToNextPage}
          >
            Siguiente
          </button>
        </div>
      )}

      {usageDialogItem && (
        <DynamicMarkerUsageDialog
          markerId={usageDialogItem.id}
          markerName={markerLabel(usageDialogItem)}
          initialUsageCount={usageDialogItem.usage_count ?? 0}
          onClose={() => setUsageDialogItem(null)}
        />
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
  item: { width: '100%', display: 'flex', flexDirection: 'column', gap: 7, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', padding: 10, textAlign: 'left' },
  itemSelect: { width: '100%', display: 'flex', flexDirection: 'column', gap: 5, border: 'none', background: 'transparent', padding: 0, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' },
  itemHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, color: '#111827', fontSize: 13 },
  status: { border: '1px solid', borderRadius: 999, padding: '2px 7px', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' },
  meta: { color: '#6b7280', fontSize: 12 },
  usageRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  usageBadge: { display: 'inline-flex', border: '1px solid', borderRadius: 999, padding: '3px 8px', fontSize: 11, fontWeight: 850, lineHeight: 1.2 },
  usageBadgeActive: { color: '#047857', background: '#ecfdf5', borderColor: '#a7f3d0' },
  usageBadgeIdle: { color: '#6b7280', background: '#f9fafb', borderColor: '#e5e7eb' },
  usageLink: { border: 'none', background: 'transparent', color: '#4f46e5', padding: 0, fontSize: 11.5, fontWeight: 850, cursor: 'pointer', textDecoration: 'underline' },
  error: { border: '1px solid #fecaca', borderRadius: 8, background: '#fef2f2', color: '#991b1b', padding: 9, fontSize: 12 },
  state: { border: '1px dashed #d1d5db', borderRadius: 8, color: '#6b7280', padding: 12, fontSize: 12, textAlign: 'center' },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, flexWrap: 'wrap', maxWidth: '100%' },
  pageBtn: { border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', color: '#374151', padding: '8px 9px', fontSize: 12, fontWeight: 800, cursor: 'pointer' },
  pageBtnDisabled: { cursor: 'not-allowed', opacity: 0.58, borderStyle: 'dashed' },
  pageIndicator: { color: '#6b7280', fontSize: 12, fontWeight: 800, minWidth: 64, textAlign: 'center' },
}
