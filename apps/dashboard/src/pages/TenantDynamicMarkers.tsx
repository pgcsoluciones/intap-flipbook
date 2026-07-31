import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { api, type DynamicMarker, type DynamicMarkerCatalogItem, type DynamicMarkerStatus } from '../lib/api'
import DynamicMarkerCommercialEditor from '../components/DynamicMarkerCommercialEditor'

const PAGE_SIZE = 24


type CatalogPage = {
  limit: number
  has_more: boolean
  next_cursor: string | null
}

type CachedDetail = {
  marker: DynamicMarker
  updated_at: string
}

const EMPTY_PAGE: CatalogPage = {
  limit: PAGE_SIZE,
  has_more: false,
  next_cursor: null,
}

function mergeUnique(current: DynamicMarkerCatalogItem[], incoming: DynamicMarkerCatalogItem[]) {
  const known = new Set(current.map((item) => item.id))
  return [...current, ...incoming.filter((item) => !known.has(item.id))]
}

function statusLabel(status: DynamicMarkerStatus) {
  if (status === 'active') return 'Activa'
  if (status === 'inactive') return 'Inactiva'
  return 'Borrador'
}

function statusStyle(status: DynamicMarkerStatus): CSSProperties {
  if (status === 'active') return { color: '#047857', background: '#ecfdf5', borderColor: '#a7f3d0' }
  if (status === 'inactive') return { color: '#6b7280', background: '#f3f4f6', borderColor: '#e5e7eb' }
  return { color: '#92400e', background: '#fffbeb', borderColor: '#fde68a' }
}

function formatMoney(value: number | null, currency: string | null) {
  if (value == null) return ''
  const amount = value / 100
  return new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: currency || 'DOP',
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount)
}

function formatDate(value: string) {
  if (!value) return ''
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })
}

function editorUrl(item: DynamicMarkerCatalogItem) {
  return `/publications/${encodeURIComponent(item.publication_id)}/editor`
}

function locateEditorUrl(item: DynamicMarkerCatalogItem) {
  const params = new URLSearchParams({
    page: item.page_id,
    marker: item.id,
    object: item.target_object_id,
  })
  return `${editorUrl(item)}?${params.toString()}`
}

function plainText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
}

function objectKindLabel(value: string | null) {
  if (value === 'linkzone') return 'Zona'
  if (value === 'button') return 'Botón'
  if (value === 'image') return 'Imagen'
  if (value === 'textbox' || value === 'i-text' || value === 'text') return 'Texto'
  if (value === 'group' || value === 'activeSelection') return 'Grupo'
  return value || 'Elemento'
}

export default function TenantDynamicMarkers() {
  const detailRequestRef = useRef(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const flushDetailRef = useRef<(() => Promise<boolean>) | null>(null)
  const [items, setItems] = useState<DynamicMarkerCatalogItem[]>([])
  const [page, setPage] = useState<CatalogPage>(EMPTY_PAGE)
  const [query, setQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [status, setStatus] = useState<DynamicMarkerStatus | ''>('')
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [detailCache, setDetailCache] = useState<Record<string, CachedDetail>>({})
  const [detail, setDetail] = useState<DynamicMarker | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [detailDirty, setDetailDirty] = useState(false)
  const [statusSaving, setStatusSaving] = useState(false)
  const [statusError, setStatusError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [reuseSuccess, setReuseSuccess] = useState('')

  function clearStatusFeedback() {
    setStatusError('')
    setStatusMessage('')
  }

  function destroyDetailDraft() {
    detailRequestRef.current += 1
    setSelectedId('')
    setDetail(null)
    setDetailError('')
    setDetailLoading(false)
    setDetailDirty(false)
    clearStatusFeedback()
    setReuseSuccess('')
  }

  async function loadCatalog({
    append = false,
    cursor = '',
    term = activeQuery,
    statusFilter = status,
  }: {
    append?: boolean
    cursor?: string
    term?: string
    statusFilter?: DynamicMarkerStatus | ''
  } = {}) {
    if (append && !cursor) return

    if (append) setLoadingMore(true)
    else setLoading(true)
    setError('')

    try {
      const response = await api.dynamicMarkers.catalog({
        limit: PAGE_SIZE,
        cursor: append ? cursor : null,
        q: term || undefined,
        status: statusFilter || undefined,
      })

      const incoming = response.data ?? []
      setPage(response.page ?? EMPTY_PAGE)

      if (append) {
        setItems((current) => mergeUnique(current, incoming))
      } else {
        detailRequestRef.current += 1
        setItems(incoming)
        setSelectedId('')
        setDetail(null)
        setDetailError('')
        setDetailLoading(false)
        setDetailDirty(false)
        clearStatusFeedback()
        setReuseSuccess('')
      }

      setLoaded(true)
    } catch (err) {
      if (!append) {
        setItems([])
        setSelectedId('')
        setDetail(null)
      }
      setPage(EMPTY_PAGE)
      setLoaded(true)
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las fichas interactivas.')
    } finally {
      if (append) setLoadingMore(false)
      else setLoading(false)
    }
  }

  useEffect(() => {
    void loadCatalog({ term: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedId) return

    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (listRef.current?.contains(target)) return
      void closeDetail()
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') void closeDetail()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [selectedId, detailDirty])

  async function runSearch() {
    if (!await closeDetail()) return
    const term = query.trim()
    setActiveQuery(term)
    await loadCatalog({ term })
  }

  function handleQueryChange(value: string) {
    setQuery(value)

    if (!value.trim() && activeQuery) {
      void (async () => {
        if (!await closeDetail()) return
        setActiveQuery('')
        await loadCatalog({ term: '' })
      })()
    }
  }

  function updateStatus(value: DynamicMarkerStatus | '') {
    void (async () => {
      if (!await closeDetail()) return
      setStatus(value)
      await loadCatalog({ term: activeQuery, statusFilter: value })
    })()
  }

  function refreshCatalog() {
    void (async () => {
      if (!await closeDetail()) return
      await loadCatalog({ term: activeQuery })
    })()
  }

  async function loadDetail(item: DynamicMarkerCatalogItem, force = false) {
    if (!force && item.id === selectedId) {
      await closeDetail()
      return
    }
    if (!force && selectedId && item.id !== selectedId) {
      const closed = await closeDetail()
      if (!closed) return
    }

    clearStatusFeedback()
    setReuseSuccess('')
    setSelectedId(item.id)
    setDetailError('')

    const cached = detailCache[item.id]
    if (!force && cached && cached.updated_at === item.updated_at) {
      setDetail(cached.marker)
      return
    }

    setDetailLoading(true)
    const requestId = detailRequestRef.current + 1
    detailRequestRef.current = requestId

    try {
      const response = await api.dynamicMarkers.get(item.id)
      if (detailRequestRef.current !== requestId) return
      setDetail(response.data)
      setDetailCache((current) => ({
        ...current,
        [item.id]: {
          marker: response.data,
          updated_at: item.updated_at,
        },
      }))
    } catch (err) {
      if (detailRequestRef.current !== requestId) return
      setDetail(null)
      setDetailError(err instanceof Error ? err.message : 'No se pudo cargar el detalle de la ficha.')
    } finally {
      if (detailRequestRef.current === requestId) setDetailLoading(false)
    }
  }

  async function closeDetail() {
    if (!selectedId) return true

    if (detailDirty) {
      const flush = flushDetailRef.current
      if (!flush) {
        setDetailError('No se pudo completar el autoguardado. Revisa los campos antes de cerrar.')
        return false
      }

      const saved = await flush()
      if (!saved) return false
    }

    destroyDetailDraft()
    return true
  }

  function handleDetailSaved(marker: DynamicMarker) {
    setDetail(marker)
    setDetailDirty(false)
    setDetailCache((current) => ({
      ...current,
      [marker.id]: {
        marker,
        updated_at: marker.updated_at,
      },
    }))
    setItems((current) => current.map((item) => (
      item.id === marker.id
        ? {
          ...item,
          name: marker.name,
          reference: marker.reference,
          category: marker.category,
          price_minor: marker.price_minor,
          currency: marker.currency,
          availability: marker.availability,
          status: marker.status,
          updated_at: marker.updated_at,
        }
        : item
    )))
  }

  function handleReuseSuccess(marker: DynamicMarker) {
    setReuseSuccess('Datos reutilizados correctamente en la ficha destino.')
    setDetailCache((current) => ({
      ...current,
      [marker.id]: {
        marker,
        updated_at: marker.updated_at,
      },
    }))
    setItems((current) => current.map((item) => (
      item.id === marker.id
        ? {
          ...item,
          name: marker.name,
          reference: marker.reference,
          category: marker.category,
          price_minor: marker.price_minor,
          currency: marker.currency,
          availability: marker.availability,
          status: marker.status,
          updated_at: marker.updated_at,
        }
        : item
    )))
  }

  async function updateMarkerStatus(nextStatus: DynamicMarkerStatus) {
    if (!detail || statusSaving || detail.status === nextStatus) return
    if (detailDirty) return

    setStatusError('')
    setStatusMessage('')

    if (nextStatus === 'active' && !detail.name?.trim()) {
      setStatusError('Agrega un nombre antes de activar la ficha.')
      return
    }

    const confirmation = nextStatus === 'active'
      ? 'Esta ficha podrá aparecer en el Viewer si la publicación está publicada. ¿Deseas activarla?'
      : nextStatus === 'inactive'
        ? 'Esta ficha dejará de aparecer en el Viewer público. ¿Deseas inactivarla?'
        : 'La ficha quedará fuera del Viewer público. ¿Deseas pasarla a borrador?'

    if (!window.confirm(confirmation)) return

    setStatusSaving(true)
    setStatusMessage('Cambiando estado...')

    try {
      const response = await api.dynamicMarkers.setStatus(detail.id, nextStatus)
      const marker = response.data
      setDetail(marker)
      setDetailCache((current) => ({
        ...current,
        [marker.id]: {
          marker,
          updated_at: marker.updated_at,
        },
      }))
      setItems((current) => current.map((item) => (
        item.id === marker.id
          ? {
            ...item,
            status: marker.status,
            updated_at: marker.updated_at,
            name: marker.name,
            reference: marker.reference,
            category: marker.category,
            price_minor: marker.price_minor,
            currency: marker.currency,
            availability: marker.availability,
          }
          : item
      )))
      setStatusMessage('Estado actualizado.')
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'No se pudo cambiar el estado.')
      setStatusMessage('')
    } finally {
      setStatusSaving(false)
    }
  }

  const emptyTitle = activeQuery || status
    ? 'No hay fichas con esos filtros.'
    : 'Aún no hay fichas interactivas.'

  const emptyCopy = activeQuery || status
    ? 'Prueba con otra búsqueda o limpia los filtros para volver a las recientes.'
    : 'Cuando actives fichas desde el editor, aparecerán aquí para consulta central.'

  return (
    <div style={s.wrap}>
      <header style={s.header}>
        <div>
          <h1 style={s.title}>Fichas interactivas</h1>
          <p style={s.subtitle}>Consulta central de fichas interactivas existentes del tenant.</p>
        </div>

        <button
          type="button"
          style={s.refresh}
          disabled={loading || loadingMore}
          onClick={refreshCatalog}
        >
          {loading ? 'Actualizando...' : 'Actualizar'}
        </button>
      </header>

      <section style={s.toolbar}>
        <div style={s.searchRow}>
          <input
            style={s.input}
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void runSearch()
            }}
            placeholder="Nombre, referencia, categoría o publicación"
          />

          <button type="button" style={s.searchBtn} disabled={loading} onClick={() => void runSearch()}>
            Buscar
          </button>
        </div>

        <div style={s.filters}>
          <label style={s.filterLabel}>
            Estado
            <select style={s.select} value={status} onChange={(event) => updateStatus(event.target.value as DynamicMarkerStatus | '')}>
              <option value="">Todos</option>
              <option value="draft">Borrador</option>
              <option value="active">Activa</option>
              <option value="inactive">Inactiva</option>
            </select>
          </label>

        </div>
      </section>

      <div style={s.summary}>
        <span>{loading && !loaded ? 'Cargando fichas...' : `${items.length} ficha${items.length === 1 ? '' : 's'} mostrada${items.length === 1 ? '' : 's'}`}</span>
        {activeQuery && <span>Búsqueda: {activeQuery}</span>}
      </div>

      {error && <p style={s.error}>{error}</p>}

      {!loaded || (loading && !items.length) ? (
        <div style={s.empty}>Cargando fichas interactivas...</div>
      ) : !items.length ? (
        <div style={s.empty}>
          <strong>{emptyTitle}</strong>
          <span>{emptyCopy}</span>
        </div>
      ) : (
        <>
          <div ref={listRef} style={s.accordionList}>
            {items.map((item) => {
              const selected = selectedId === item.id

              return (
                <article
                  key={item.id}
                  style={{ ...s.card, ...(selected ? s.cardSelected : {}) }}
                >
                  <button
                    type="button"
                    style={s.cardToggle}
                    aria-expanded={selected}
                    onClick={() => void loadDetail(item)}
                  >
                    <div style={s.cover}>
                      {item.cover_url ? (
                        <img src={item.cover_url} alt="" style={s.coverImg} />
                      ) : (
                        <div style={s.coverPlaceholder}>Sin portada</div>
                      )}
                    </div>

                    <div style={s.cardBody}>
                      <div style={s.cardIdentity}>
                        <h2 style={s.cardTitle}>{item.name || 'Ficha sin nombre'}</h2>
                        <span style={{ ...s.statusPill, ...statusStyle(item.status) }}>
                          {statusLabel(item.status)}
                        </span>
                      </div>

                      <span style={s.cardMetaLine}>
                        {item.reference ? `Ref. ${item.reference}` : 'Sin referencia'}
                      </span>

                      <span style={s.cardMetaLine}>
                        {item.publication_title || 'Publicación'} · {item.page_number ? `Página ${item.page_number}` : 'Página sin identificar'}
                      </span>
                    </div>

                    <span style={s.cardChevron} aria-hidden="true">
                      {selected ? '⌃' : '⌄'}
                    </span>
                  </button>

                  {selected && (
                    <div style={s.cardDetail}>
                      <DetailPanel
                        item={item}
                        detail={detail}
                        loading={detailLoading}
                        error={detailError}
                        onClose={closeDetail}
                        onRetry={() => void loadDetail(item, true)}
                        onDirtyChange={setDetailDirty}
                        onSaved={handleDetailSaved}
                        detailDirty={detailDirty}
                        statusSaving={statusSaving}
                        statusError={statusError}
                        statusMessage={statusMessage}
                        onStatusChange={updateMarkerStatus}
                        initialItems={items}
                        reuseSuccess={reuseSuccess}
                        onReuseSuccess={handleReuseSuccess}
                        onRegisterFlush={(flush) => {
                          flushDetailRef.current = flush
                        }}
                      />
                    </div>
                  )}
                </article>
              )
            })}
          </div>

          {page.has_more && page.next_cursor && (
            <div style={s.loadMoreWrap}>
              <button
                type="button"
                style={s.refresh}
                disabled={loadingMore}
                onClick={() => void loadCatalog({
                  append: true,
                  cursor: page.next_cursor ?? '',
                  term: activeQuery,
                })}
              >
                {loadingMore ? 'Cargando...' : 'Cargar más'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function DetailPanel({
  item,
  detail,
  loading,
  error,
  onClose,
  onRetry,
  onDirtyChange,
  onSaved,
  detailDirty,
  statusSaving,
  statusError,
  statusMessage,
  onStatusChange,
  initialItems,
  reuseSuccess,
  onReuseSuccess,
  onRegisterFlush,
}: {
  item: DynamicMarkerCatalogItem
  detail: DynamicMarker | null
  loading: boolean
  error: string
  onClose: () => Promise<boolean>
  onRetry: () => void
  onDirtyChange: (dirty: boolean) => void
  onSaved: (marker: DynamicMarker) => void
  detailDirty: boolean
  statusSaving: boolean
  statusError: string
  statusMessage: string
  onStatusChange: (status: DynamicMarkerStatus) => void
  initialItems: DynamicMarkerCatalogItem[]
  reuseSuccess: string
  onReuseSuccess: (marker: DynamicMarker) => void
  onRegisterFlush: (flush: (() => Promise<boolean>) | null) => void
}) {
  const marker = detail
  const [reuseOpen, setReuseOpen] = useState(false)
  const [reuseBlocked, setReuseBlocked] = useState('')
  const currentPrice = marker ? formatMoney(marker.price_minor, marker.currency) : ''
  const canLocate = Boolean(item.page_id && item.target_object_id)
  const hasCommercialData = Boolean(
    marker && (
      plainText(marker.name)
      || plainText(marker.reference)
      || plainText(marker.category)
      || plainText(marker.description)
      || currentPrice
      || plainText(marker.availability)
      || plainText(marker.promotion_text)
      || plainText(marker.badge_text)
    ),
  )

  useEffect(() => {
    if (!detailDirty) {
      setReuseBlocked('')
      return
    }
    if (reuseOpen) setReuseOpen(false)
    setReuseBlocked('Guarda o descarta los cambios comerciales antes de reutilizar datos.')
  }, [detailDirty, reuseOpen])

  return (
    <aside style={s.detailPanel}>
      <div style={s.detailHeader}>
        <div>
          <h2 style={s.detailTitle}>{marker?.name || item.name || 'Ficha sin nombre'}</h2>
          <span style={{ ...s.detailStatus, ...statusStyle(marker?.status ?? item.status) }}>
            {statusLabel(marker?.status ?? item.status)}
          </span>
        </div>

        <button type="button" style={s.closeBtn} onClick={() => void onClose()}>
          Cerrar detalle
        </button>
      </div>

      {loading ? (
        <div style={s.detailState}>Cargando detalle...</div>
      ) : error ? (
        <div style={s.detailState}>
          <strong>No se pudo cargar el detalle.</strong>
          <span>{error}</span>
          <button type="button" style={s.retryBtn} onClick={onRetry}>Reintentar</button>
        </div>
      ) : !marker ? (
        <div style={s.detailState}>Selecciona una ficha para ver el detalle.</div>
      ) : (
        <div style={s.detailContent}>
          {!hasCommercialData && (
            <div style={s.detailNotice}>Esta ficha aún no tiene datos comerciales completos.</div>
          )}

          <section style={s.detailSection}>
            <h3 style={s.detailSectionTitle}>Identificación</h3>
            <DetailRow label="Publicación" value={item.publication_title || 'Publicación'} />
            <DetailRow label="Página" value={item.page_number ? `Página ${item.page_number}` : item.page_id} />
            <DetailRow label="Tipo de objeto" value={objectKindLabel(item.target_kind)} />
            <DetailRow label="Marker ID" value={marker.id} secondary />
            <DetailRow label="Actualizada" value={formatDate(marker.updated_at)} />
          </section>

          <section style={s.detailSection}>
            <h3 style={s.detailSectionTitle}>Estado de ficha</h3>
            <p style={s.statusHelp}>Este estado solo controla la ficha interactiva, no el estado de la publicación.</p>
            {detailDirty && (
              <div style={s.statusWarning}>Guarda o descarta los cambios comerciales antes de cambiar estado.</div>
            )}
            <div style={s.statusButtons}>
              <StatusButton
                label="Borrador"
                description="No aparece en el Viewer público."
                active={marker.status === 'draft'}
                disabled={detailDirty || statusSaving || marker.status === 'draft'}
                onClick={() => onStatusChange('draft')}
              />
              <StatusButton
                label="Activa"
                description="Puede aparecer en el Viewer si la publicación está publicada."
                active={marker.status === 'active'}
                disabled={detailDirty || statusSaving || marker.status === 'active'}
                onClick={() => onStatusChange('active')}
              />
              <StatusButton
                label="Inactiva"
                description="Oculta del Viewer sin borrar la ficha."
                active={marker.status === 'inactive'}
                disabled={detailDirty || statusSaving || marker.status === 'inactive'}
                onClick={() => onStatusChange('inactive')}
              />
            </div>
            {statusMessage && <div style={statusSaving ? s.statusInfo : s.statusSuccess}>{statusMessage}</div>}
            {statusError && <div style={s.statusError}>{statusError}</div>}
          </section>

          <section style={s.detailSection}>
            <h3 style={s.detailSectionTitle}>Información comercial</h3>
            <DynamicMarkerCommercialEditor
              key={marker.id}
              marker={marker}
              onDirtyChange={onDirtyChange}
              onSaved={onSaved}
              onRegisterFlush={onRegisterFlush}
            />
          </section>

          <div style={s.detailActions}>
            <Link to={editorUrl(item)} style={s.detailOpenLink}>
              Abrir en Editor
            </Link>
            {canLocate && (
              <div style={s.locateAction}>
                <Link to={locateEditorUrl(item)} style={s.locateLink}>
                  Localizar ficha
                </Link>
                <span style={s.locateHint}>Abrirá la página y el objeto asociado en el Editor.</span>
              </div>
            )}
          </div>
          <button
            type="button"
            style={{ ...s.reuseBtn, ...(detailDirty ? s.reuseBtnBlocked : {}) }}
            onClick={() => {
              if (detailDirty) {
                setReuseBlocked('Guarda o descarta los cambios comerciales antes de reutilizar datos.')
                return
              }
              setReuseBlocked('')
              setReuseOpen(true)
            }}
          >
            Reutilizar datos
          </button>
          {reuseBlocked && <div style={s.statusWarning}>{reuseBlocked}</div>}
          {reuseSuccess && <div style={s.statusSuccess}>{reuseSuccess}</div>}
          {reuseOpen && (
            <ReuseDestinationPanel
              source={item}
              initialItems={initialItems}
              detailDirty={detailDirty}
              onClose={() => setReuseOpen(false)}
              onReuseSuccess={(marker) => {
                setReuseOpen(false)
                onReuseSuccess(marker)
              }}
            />
          )}
        </div>
      )}
    </aside>
  )
}

function ReuseDestinationPanel({
  source,
  initialItems,
  detailDirty,
  onClose,
  onReuseSuccess,
}: {
  source: DynamicMarkerCatalogItem
  initialItems: DynamicMarkerCatalogItem[]
  detailDirty: boolean
  onClose: () => void
  onReuseSuccess: (marker: DynamicMarker) => void
}) {
  const [query, setQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [results, setResults] = useState<DynamicMarkerCatalogItem[]>(() => initialItems.filter((item) => item.id !== source.id))
  const [page, setPage] = useState<CatalogPage>(EMPTY_PAGE)
  const [selectedTargetId, setSelectedTargetId] = useState('')
  const [newName, setNewName] = useState('')
  const [reference, setReference] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const selectedTarget = results.find((item) => item.id === selectedTargetId) ?? null
  const trimmedName = newName.trim()
  const trimmedReference = reference.trim()
  const nameValid = trimmedName.length > 0 && trimmedName.length <= 160
  const referenceValid = trimmedReference.length <= 120
  const canConfirm = Boolean(selectedTarget && selectedTarget.status === 'draft' && selectedTarget.id !== source.id && nameValid && referenceValid && !detailDirty && !saving)

  useEffect(() => {
    setResults(initialItems.filter((item) => item.id !== source.id))
    setSelectedTargetId((current) => (
      current && initialItems.some((item) => item.id === current && item.id !== source.id)
        ? current
        : ''
    ))
  }, [initialItems, source.id])

  async function searchDestinations({ append = false, cursor = '', term = activeQuery }: { append?: boolean; cursor?: string; term?: string } = {}) {
    if (saving || detailDirty) return
    if (append && !cursor) return
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError('')

    try {
      const response = await api.dynamicMarkers.catalog({
        limit: PAGE_SIZE,
        cursor: append ? cursor : null,
        q: term || undefined,
      })
      const incoming = (response.data ?? []).filter((candidate) => candidate.id !== source.id)
      setPage(response.page ?? EMPTY_PAGE)
      setResults((current) => (append ? mergeUnique(current, incoming) : incoming))
      if (!append) setSelectedTargetId('')
    } catch (err) {
      if (!append) setResults([])
      setPage(EMPTY_PAGE)
      setError(err instanceof Error ? err.message : 'No se pudieron buscar fichas destino.')
    } finally {
      if (append) setLoadingMore(false)
      else setLoading(false)
    }
  }

  function runDestinationSearch() {
    if (saving || detailDirty) return
    const term = query.trim()
    setActiveQuery(term)
    void searchDestinations({ term })
  }

  function restoreInitialResults(value: string) {
    if (saving || detailDirty) return
    setQuery(value)
    if (!value.trim() && activeQuery) {
      setActiveQuery('')
      setPage(EMPTY_PAGE)
      setResults(initialItems.filter((item) => item.id !== source.id))
      setSelectedTargetId('')
      setError('')
    }
  }

  async function confirmReuse() {
    setError('')

    if (detailDirty) {
      setError('Guarda o descarta los cambios comerciales antes de reutilizar datos.')
      return
    }
    if (!selectedTarget) {
      setError('Selecciona una ficha destino.')
      return
    }
    if (selectedTarget.id === source.id) {
      setError('La ficha destino debe ser distinta de la fuente.')
      return
    }
    if (selectedTarget.status !== 'draft') {
      setError('Solo se puede reutilizar hacia una ficha en borrador.')
      return
    }
    if (!trimmedName) {
      setError('Indica el nuevo nombre de la ficha destino.')
      return
    }
    if (trimmedName.length > 160) {
      setError('El nombre nuevo no puede exceder 160 caracteres.')
      return
    }
    if (trimmedReference.length > 120) {
      setError('La referencia no puede exceder 120 caracteres.')
      return
    }

    const ok = window.confirm(
      'Se copiarán datos comerciales hacia la ficha destino. No se copiarán\n'
      + 'Marker ID, publicación, página, objeto visual ni estado.\n'
      + 'La ficha destino permanecerá en borrador. ¿Deseas continuar?',
    )
    if (!ok) return

    setSaving(true)
    try {
      const response = await api.dynamicMarkers.reuse(source.id, {
        target_marker_id: selectedTarget.id,
        name: trimmedName,
        ...(trimmedReference ? { reference: trimmedReference } : {}),
      })
      onReuseSuccess(response.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron reutilizar los datos.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section style={s.reusePanel}>
      <div style={s.reuseHeader}>
        <div>
          <h3 style={s.reuseTitle}>Reutilizar datos hacia otra ficha</h3>
          <p style={s.reuseCopy}>El destino debe existir previamente desde el Editor.</p>
        </div>
        <button type="button" style={s.closeBtn} disabled={saving} onClick={onClose}>Cerrar</button>
      </div>

      {detailDirty && (
        <div style={s.statusWarning}>Reutilizar datos está bloqueado mientras existan cambios comerciales pendientes.</div>
      )}

      <div style={s.reuseNotes}>
        <span>Marker ID, publicación, página, objeto visual y estado no se copian.</span>
        <span>Medios y campos reutilizarán contenido, pero recibirán nuevos IDs internos.</span>
      </div>

      <div style={s.reuseForm}>
        <label style={s.filterLabel}>
          Nombre nuevo
          <input style={s.input} value={newName} disabled={saving || detailDirty} onChange={(event) => setNewName(event.target.value)} maxLength={160} />
        </label>
        <label style={s.filterLabel}>
          Referencia opcional
          <input style={s.input} value={reference} disabled={saving || detailDirty} onChange={(event) => setReference(event.target.value)} maxLength={120} />
        </label>
      </div>

      <div style={s.searchRow}>
        <input
          style={s.input}
          value={query}
          disabled={saving || detailDirty}
          onChange={(event) => restoreInitialResults(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') runDestinationSearch()
          }}
          placeholder="Buscar ficha destino"
        />
        <button type="button" style={s.searchBtn} disabled={loading || saving || detailDirty} onClick={runDestinationSearch}>
          {loading ? 'Buscando...' : 'Buscar'}
        </button>
      </div>

      {error && <div style={s.statusError}>{error}</div>}

      <div style={s.destinationList}>
        {loading && !results.length ? (
          <div style={s.destinationEmpty}>Buscando fichas destino...</div>
        ) : !results.length ? (
          <div style={s.destinationEmpty}>No hay fichas destino disponibles en esta vista.</div>
        ) : results.map((candidate) => {
          const eligible = candidate.status === 'draft'
          const selected = selectedTargetId === candidate.id
          return (
            <button
              key={candidate.id}
              type="button"
              style={{
                ...s.destinationItem,
                ...(selected ? s.destinationItemSelected : {}),
                ...(!eligible ? s.destinationItemDisabled : {}),
              }}
              disabled={!eligible || saving || detailDirty}
              onClick={() => setSelectedTargetId(candidate.id)}
            >
              <span style={s.destinationTop}>
                <strong>{candidate.name || 'Ficha sin nombre'}</strong>
                <span style={{ ...s.detailStatus, ...statusStyle(candidate.status) }}>{statusLabel(candidate.status)}</span>
              </span>
              <span style={s.destinationMeta}>{candidate.publication_title || 'Publicación'} · {candidate.page_number ? `Página ${candidate.page_number}` : candidate.page_id}</span>
              {candidate.reference && <span style={s.destinationMeta}>Ref.: {candidate.reference}</span>}
              {!eligible && <span style={s.destinationBlocked}>Solo se puede reutilizar hacia una ficha en borrador.</span>}
            </button>
          )
        })}
      </div>

      {page.has_more && page.next_cursor && (
        <button
          type="button"
          style={s.refresh}
          disabled={loadingMore || saving || detailDirty}
          onClick={() => void searchDestinations({ append: true, cursor: page.next_cursor ?? '', term: activeQuery })}
        >
          {loadingMore ? 'Cargando...' : 'Cargar más destinos'}
        </button>
      )}

      <div style={s.reuseFooter}>
        <button
          type="button"
          style={canConfirm ? s.confirmReuseBtn : s.disabledPrimary}
          disabled={!canConfirm}
          onClick={() => void confirmReuse()}
        >
          {saving ? 'Reutilizando datos...' : 'Confirmar reutilización'}
        </button>
        <span style={s.locateHint}>Selecciona una ficha destino e indica el nuevo nombre.</span>
      </div>
    </section>
  )
}

function StatusButton({
  label,
  description,
  active,
  disabled,
  onClick,
}: {
  label: string
  description: string
  active: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      style={{ ...s.statusButton, ...(active ? s.statusButtonActive : {}), ...(disabled ? s.statusButtonDisabled : {}) }}
      disabled={disabled}
      onClick={onClick}
    >
      <span style={s.statusButtonLabel}>{label}</span>
      <span style={s.statusButtonCopy}>{description}</span>
    </button>
  )
}

function DetailRow({
  label,
  value,
  multiline = false,
  secondary = false,
}: {
  label: string
  value: string | null | undefined
  multiline?: boolean
  secondary?: boolean
}) {
  const text = plainText(value)
  if (!text) return null

  return (
    <div style={s.detailRow}>
      <span style={s.detailLabel}>{label}</span>
      <span style={{ ...s.detailValue, ...(multiline ? s.detailMultiline : {}), ...(secondary ? s.detailSecondary : {}) }}>
        {text}
      </span>
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  wrap: { maxWidth: 1280, margin: '0 auto', padding: 24 },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 },
  title: { margin: 0, color: '#111827', fontSize: 25 },
  subtitle: { margin: '5px 0 0', color: '#6b7280', fontSize: 13, lineHeight: 1.5 },
  refresh: { border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', color: '#374151', padding: '9px 12px', fontSize: 13, fontWeight: 800, cursor: 'pointer' },
  toolbar: { border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', padding: 14, display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 },
  searchRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8 },
  input: { width: '100%', minWidth: 0, border: '1px solid #d1d5db', borderRadius: 8, padding: '10px 11px', fontSize: 13, boxSizing: 'border-box' },
  searchBtn: { border: 'none', borderRadius: 8, background: '#4f46e5', color: '#fff', padding: '10px 15px', fontSize: 13, fontWeight: 800, cursor: 'pointer' },
  filters: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 },
  filterLabel: { display: 'flex', flexDirection: 'column', gap: 5, color: '#4b5563', fontSize: 12, fontWeight: 700 },
  select: { border: '1px solid #d1d5db', borderRadius: 8, padding: '9px 10px', background: '#fff', color: '#111827', fontSize: 13 },
  summary: { display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', color: '#6b7280', fontSize: 12, margin: '0 0 12px' },
  error: { border: '1px solid #fecaca', borderRadius: 8, background: '#fef2f2', color: '#991b1b', padding: 10, fontSize: 13 },
  empty: { border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', minHeight: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 7, color: '#6b7280', textAlign: 'center', padding: 18, fontSize: 13 },
  accordionList: { display: 'flex', flexDirection: 'column', gap: 10 },
  card: { border: '1px solid #e5e7eb', borderRadius: 14, background: '#fff', overflow: 'hidden', boxShadow: '0 1px 2px rgba(15,23,42,.05)' },
  cardSelected: { borderColor: '#4f46e5', boxShadow: '0 0 0 2px rgba(79,70,229,.14)' },
  cardToggle: { width: '100%', border: 'none', background: '#fff', color: '#111827', padding: 10, display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' },
  cover: { width: 72, height: 72, borderRadius: 10, background: '#f3f4f6', overflow: 'hidden', flexShrink: 0 },
  coverImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  coverPlaceholder: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 10, fontWeight: 800, textAlign: 'center', padding: 5, background: 'linear-gradient(135deg, #f9fafb, #e5e7eb)', boxSizing: 'border-box' },
  statusPill: { display: 'inline-flex', border: '1px solid', borderRadius: 999, padding: '4px 8px', fontSize: 11, fontWeight: 800, flexShrink: 0 },
  cardBody: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 5 },
  cardIdentity: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 9 },
  cardTitle: { margin: 0, color: '#111827', fontSize: 15, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cardMetaLine: { color: '#6b7280', fontSize: 12, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cardChevron: { color: '#6b7280', fontSize: 18, fontWeight: 800, padding: '0 3px', flexShrink: 0 },
  cardDetail: { borderTop: '1px solid #e5e7eb', background: '#fbfdff', padding: 14 },
  metaGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 9 },
  metaItem: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  metaLabel: { color: '#9ca3af', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' },
  metaValue: { color: '#374151', fontSize: 12, lineHeight: 1.35, overflowWrap: 'anywhere' },
  cardActions: { display: 'flex', justifyContent: 'flex-start', paddingTop: 2 },
  openLink: { border: '1px solid #c7d2fe', borderRadius: 8, background: '#eef2ff', color: '#3730a3', padding: '8px 10px', fontSize: 12, fontWeight: 800, textDecoration: 'none' },
  loadMoreWrap: { display: 'flex', justifyContent: 'center', marginTop: 18 },
  detailPanel: { border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff', padding: 14 },
  detailHeader: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 14 },
  detailTitle: { margin: '0 0 7px', color: '#111827', fontSize: 17, lineHeight: 1.25 },
  detailStatus: { display: 'inline-flex', border: '1px solid', borderRadius: 999, padding: '4px 8px', fontSize: 11, fontWeight: 800 },
  closeBtn: { border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', color: '#374151', padding: '7px 9px', fontSize: 12, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' },
  detailState: { border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb', minHeight: 120, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#6b7280', textAlign: 'center', padding: 14, fontSize: 13 },
  retryBtn: { border: 'none', borderRadius: 8, background: '#4f46e5', color: '#fff', padding: '8px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer' },
  detailContent: { display: 'flex', flexDirection: 'column', gap: 12 },
  detailNotice: { border: '1px solid #fde68a', borderRadius: 8, background: '#fffbeb', color: '#92400e', padding: 9, fontSize: 12, lineHeight: 1.4 },
  detailSection: { borderTop: '1px solid #f3f4f6', paddingTop: 11, display: 'flex', flexDirection: 'column', gap: 7 },
  detailSectionTitle: { margin: 0, color: '#111827', fontSize: 13 },
  statusHelp: { margin: 0, color: '#6b7280', fontSize: 12, lineHeight: 1.4 },
  statusWarning: { border: '1px solid #fde68a', borderRadius: 8, background: '#fffbeb', color: '#92400e', padding: 8, fontSize: 12, lineHeight: 1.4 },
  statusButtons: { display: 'grid', gridTemplateColumns: '1fr', gap: 7 },
  statusButton: { border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', color: '#374151', padding: 9, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 3, cursor: 'pointer', fontFamily: 'inherit' },
  statusButtonActive: { borderColor: '#4f46e5', background: '#eef2ff', color: '#312e81' },
  statusButtonDisabled: { cursor: 'not-allowed', opacity: 0.68 },
  statusButtonLabel: { fontSize: 12, fontWeight: 900 },
  statusButtonCopy: { fontSize: 11.5, lineHeight: 1.35 },
  statusInfo: { border: '1px solid #bfdbfe', borderRadius: 8, background: '#eff6ff', color: '#1d4ed8', padding: 8, fontSize: 12 },
  statusSuccess: { border: '1px solid #bbf7d0', borderRadius: 8, background: '#f0fdf4', color: '#166534', padding: 8, fontSize: 12 },
  statusError: { border: '1px solid #fecaca', borderRadius: 8, background: '#fef2f2', color: '#991b1b', padding: 8, fontSize: 12, lineHeight: 1.4 },
  detailRow: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  detailLabel: { color: '#9ca3af', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' },
  detailValue: { color: '#374151', fontSize: 12.5, lineHeight: 1.4, overflowWrap: 'anywhere' },
  detailMultiline: { whiteSpace: 'pre-wrap' },
  detailSecondary: { color: '#6b7280', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 11 },
  detailMuted: { color: '#6b7280', fontSize: 12.5 },
  accentRow: { display: 'flex', alignItems: 'center', gap: 8 },
  accentSwatch: { width: 18, height: 18, borderRadius: 999, border: '1px solid #d1d5db', flexShrink: 0 },
  detailOpenLink: { border: '1px solid #c7d2fe', borderRadius: 8, background: '#eef2ff', color: '#3730a3', padding: '9px 10px', fontSize: 12, fontWeight: 800, textDecoration: 'none', textAlign: 'center' },
  detailActions: { display: 'flex', flexDirection: 'column', gap: 8 },
  locateAction: { display: 'flex', flexDirection: 'column', gap: 4 },
  locateLink: { border: '1px solid #a7f3d0', borderRadius: 8, background: '#ecfdf5', color: '#047857', padding: '9px 10px', fontSize: 12, fontWeight: 800, textDecoration: 'none', textAlign: 'center' },
  locateHint: { color: '#6b7280', fontSize: 11.5, lineHeight: 1.35 },
  reuseBtn: { border: '1px solid #fed7aa', borderRadius: 8, background: '#fff7ed', color: '#9a3412', padding: '9px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer', textAlign: 'center' },
  reuseBtnBlocked: { cursor: 'not-allowed', opacity: 0.72 },
  reusePanel: { border: '1px solid #fed7aa', borderRadius: 8, background: '#fffaf5', padding: 11, display: 'flex', flexDirection: 'column', gap: 11 },
  reuseHeader: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' },
  reuseTitle: { margin: 0, color: '#111827', fontSize: 14 },
  reuseCopy: { margin: '4px 0 0', color: '#6b7280', fontSize: 12, lineHeight: 1.4 },
  reuseNotes: { border: '1px solid #fde68a', borderRadius: 8, background: '#fffbeb', color: '#92400e', padding: 9, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5, lineHeight: 1.35 },
  reuseForm: { display: 'grid', gridTemplateColumns: '1fr', gap: 8 },
  destinationList: { display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 320, overflow: 'auto' },
  destinationItem: { border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', color: '#111827', padding: 9, display: 'flex', flexDirection: 'column', gap: 5, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' },
  destinationItemSelected: { borderColor: '#4f46e5', boxShadow: '0 0 0 2px rgba(79,70,229,.16)' },
  destinationItemDisabled: { background: '#f9fafb', color: '#6b7280', cursor: 'not-allowed', opacity: 0.82 },
  destinationTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  destinationMeta: { color: '#6b7280', fontSize: 11.5, lineHeight: 1.35, overflowWrap: 'anywhere' },
  destinationBlocked: { color: '#92400e', fontSize: 11.5, fontWeight: 800 },
  destinationEmpty: { border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', color: '#6b7280', padding: 12, textAlign: 'center', fontSize: 12 },
  reuseFooter: { display: 'flex', flexDirection: 'column', gap: 5 },
  confirmReuseBtn: { border: 'none', borderRadius: 8, background: '#9a3412', color: '#fff', padding: '10px 12px', fontSize: 13, fontWeight: 800, cursor: 'pointer' },
  disabledPrimary: { border: 'none', borderRadius: 8, background: '#9ca3af', color: '#fff', padding: '10px 12px', fontSize: 13, fontWeight: 800, cursor: 'not-allowed' },
  workspaceMobile: { gridTemplateColumns: '1fr' },
}
