import { useEffect, useState, type CSSProperties } from 'react'
import { useSearchParams } from 'react-router-dom'
import AppointmentAgendaPanel from '../components/AppointmentAgendaPanel'
import { api, type AppointmentCalendar } from '../lib/api'

const PAGE_SIZE = 12

type AgendaPage = {
  has_more: boolean
  next_cursor: string | null
}

function agendaState(calendar: AppointmentCalendar) {
  const hasWindows = Boolean(calendar.has_active_windows)
  const hasTypes = Boolean(calendar.has_active_types)
  const linked = Number(calendar.marker_count ?? 0)

  if (!hasWindows) return { label: 'Falta horario activo', tone: '#b45309', background: '#fffbeb' }
  if (!hasTypes) return { label: 'Falta tipo de cita activo', tone: '#b45309', background: '#fffbeb' }
  if (!linked) return { label: 'Lista para vincular', tone: '#1d4ed8', background: '#eff6ff' }

  return { label: 'Lista para reservar', tone: '#047857', background: '#ecfdf5' }
}

export default function TenantAgenda() {
  const [searchParams] = useSearchParams()
  const requestedCalendarId = searchParams.get('calendar')?.trim() || ''
  const requestedTab = searchParams.get('tab') === 'bookings' ? 'bookings' : undefined
  const requestedBookingId = searchParams.get('booking')?.trim() || ''
  const rawRequestedDate = searchParams.get('date') || ''
  const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(rawRequestedDate) ? rawRequestedDate : undefined

  const [query, setQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [results, setResults] = useState<AppointmentCalendar[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage] = useState<AgendaPage>({ has_more: false, next_cursor: null })
  const [creating, setCreating] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newAgendaName, setNewAgendaName] = useState('')
  const [newAgendaTimezone, setNewAgendaTimezone] = useState('America/Santo_Domingo')
  const [message, setMessage] = useState('')

  async function loadAgendas({
    cursor = '',
    append = false,
    term = activeQuery,
  }: {
    cursor?: string
    append?: boolean
    term?: string
  } = {}) {
    if (append) setLoadingMore(true)
    else setLoading(true)

    setMessage('')

    try {
      const response = await api.appointmentCalendars.list({
        scope: 'tenant',
        q: term || undefined,
        limit: PAGE_SIZE,
        cursor: cursor || undefined,
      })

      const next = response.data ?? []

      setResults((current) => {
        if (!append) return next

        const known = new Set(current.map((calendar) => calendar.id))
        return [...current, ...next.filter((calendar) => !known.has(calendar.id))]
      })

      if (!append) {
        setSelectedId((current) => {
          if (requestedCalendarId) return requestedCalendarId
          return current && next.some((calendar) => calendar.id === current) ? current : ''
        })
      }

      setPage({
        has_more: Boolean(response.page?.has_more),
        next_cursor: response.page?.next_cursor ?? null,
      })

      setLoaded(true)

      if (!append && !next.length) {
        setMessage(
          term
            ? 'No encontramos Agendas con esa búsqueda.'
            : 'Aún no hay Agendas creadas. Crea la primera para comenzar.',
        )
      }
    } catch (error) {
      if (!append) {
        setResults([])
        setSelectedId('')
      }

      setPage({ has_more: false, next_cursor: null })
      setLoaded(true)
      setMessage(error instanceof Error ? error.message : 'No se pudieron cargar las Agendas.')
    } finally {
      if (append) setLoadingMore(false)
      else setLoading(false)
    }
  }

  useEffect(() => {
    if (requestedCalendarId) setSelectedId(requestedCalendarId)
  }, [requestedCalendarId])

  useEffect(() => {
    void loadAgendas({ term: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function searchAgendas() {
    const term = query.trim()
    setActiveQuery(term)
    await loadAgendas({ term })
  }

  function handleQueryChange(value: string) {
    setQuery(value)

    if (!value.trim() && activeQuery) {
      setActiveQuery('')
      void loadAgendas({ term: '' })
    }
  }

  async function refreshAgendas() {
    await loadAgendas({ term: activeQuery })
  }

  async function createAgenda() {
    const name = newAgendaName.trim()

    if (!name) {
      setMessage('Escribe un nombre interno para la nueva Agenda.')
      return
    }

    setCreating(true)
    setMessage('')

    try {
      const response = await api.appointmentCalendars.create({
        name,
        timezone: newAgendaTimezone.trim() || 'America/Santo_Domingo',
        slot_interval_minutes: 30,
        default_duration_minutes: 60,
        default_buffer_minutes: 0,
        max_per_slot: 1,
        max_per_day: 8,
        min_notice_minutes: 120,
        booking_horizon_days: 30,
        hold_expires_after_minutes: 30,
        weekly_windows: [],
        exceptions: [],
        appointment_types: [],
      })

      setResults((current) => [
        response.data,
        ...current.filter((calendar) => calendar.id !== response.data.id),
      ])
      setSelectedId(response.data.id)
      setLoaded(true)
      setNewAgendaName('')
      setShowCreate(false)
      setMessage('Agenda creada. Completa horarios y tipos de cita antes de vincularla a una ficha.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo crear la Agenda.')
    } finally {
      setCreating(false)
    }
  }

  const listTitle = activeQuery ? 'Resultados de búsqueda' : 'Mis Agendas recientes'

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Agenda</h1>
          <p style={s.subtitle}>
            Crea y configura Agendas para proyectos, servicios o equipos comerciales.
          </p>
        </div>

        <div style={s.headerActions}>
          <button
            type="button"
            style={s.createBtn}
            onClick={() => {
              setMessage('')
              setShowCreate((current) => !current)
            }}
          >
            + Nueva Agenda
          </button>

          <button
            type="button"
            style={s.refresh}
            disabled={loading}
            onClick={() => void refreshAgendas()}
          >
            {loading ? 'Actualizando...' : '↻ Actualizar'}
          </button>
        </div>
      </div>

      {showCreate && (
        <div style={s.createBox}>
          <div style={s.createTitle}>Nueva Agenda</div>

          <label style={s.label}>
            Nombre interno
            <input
              style={s.input}
              value={newAgendaName}
              disabled={creating}
              onChange={(event) => setNewAgendaName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void createAgenda()
              }}
              placeholder="Ej.: Agenda · Proyecto Torres del Este"
            />
          </label>

          <label style={s.label}>
            Zona horaria
            <input
              style={s.input}
              value={newAgendaTimezone}
              disabled={creating}
              onChange={(event) => setNewAgendaTimezone(event.target.value)}
              placeholder="America/Santo_Domingo"
            />
          </label>

          <div style={s.createActions}>
            <button
              type="button"
              style={s.searchBtn}
              disabled={creating}
              onClick={() => void createAgenda()}
            >
              {creating ? 'Creando...' : 'Crear y configurar'}
            </button>

            <button
              type="button"
              style={s.refresh}
              disabled={creating}
              onClick={() => setShowCreate(false)}
            >
              Cancelar
            </button>
          </div>

          <p style={s.help}>
            La Agenda inicia sin horarios ni tipos de cita. No será reservable hasta configurarla.
          </p>
        </div>
      )}

      <div style={s.searchBox}>
        <label style={s.label}>Buscar o filtrar Agenda</label>

        <div style={s.searchRow}>
          <input
            style={s.input}
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void searchAgendas()
            }}
            placeholder="Nombre, ficha, referencia o publicación"
          />

          <button
            type="button"
            style={s.searchBtn}
            disabled={loading}
            onClick={() => void searchAgendas()}
          >
            Buscar
          </button>
        </div>

        <p style={s.help}>
          Al abrir se muestran las {PAGE_SIZE} Agendas más recientes. La búsqueda es opcional y el detalle completo se carga al seleccionar una tarjeta.
        </p>
      </div>

      {message && <p style={s.message}>{message}</p>}

      <div style={s.workspace}>
        <section style={s.list}>
          <div style={s.listHeader}>
            <span>{listTitle}</span>
            <span style={s.listHint}>
              {loading ? 'Cargando...' : loaded ? `${results.length} mostrada(s)` : 'Cargando...'}
            </span>
          </div>

          {!loaded || loading ? (
            <div style={s.empty}>Cargando Agendas...</div>
          ) : !results.length ? (
            <div style={s.empty}>
              <strong>{activeQuery ? 'No hay resultados.' : 'Crea tu primera Agenda.'}</strong>
              <span>
                {activeQuery
                  ? 'Prueba con el nombre de la Agenda, ficha, referencia o publicación.'
                  : 'La Agenda central reunirá aquí horarios, tipos de cita, cupos, bloqueos y reservas.'}
              </span>
            </div>
          ) : (
            <>
              <div style={s.results}>
                {results.map((calendar) => {
                  const selected = selectedId === calendar.id
                  const state = agendaState(calendar)
                  const links = Number(calendar.marker_count ?? 0)

                  return (
                    <button
                      key={calendar.id}
                      type="button"
                      style={{ ...s.result, ...(selected ? s.resultSelected : {}) }}
                      onClick={() => setSelectedId(calendar.id)}
                    >
                      <div style={s.cardTop}>
                        <strong>{calendar.name}</strong>
                        <span style={{ ...s.statusPill, color: state.tone, background: state.background }}>
                          {state.label}
                        </span>
                      </div>

                      <span>
                        {links
                          ? `${links} ficha(s) vinculada(s)`
                          : 'Sin fichas vinculadas'}
                      </span>

                      <span style={s.configureHint}>Configurar disponibilidad, tipos y reservas →</span>
                    </button>
                  )
                })}
              </div>

              {page.has_more && page.next_cursor && (
                <div style={s.loadMoreWrap}>
                  <button
                    type="button"
                    style={s.refresh}
                    disabled={loadingMore}
                    onClick={() => void loadAgendas({
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
        </section>

        <section style={s.detail}>
          {selectedId ? (
            <AppointmentAgendaPanel
              selectedCalendarId={selectedId}
              initialTab={requestedTab}
              initialDate={requestedDate}
              focusBookingId={requestedBookingId}
              onCalendarUpdated={() => {
                void refreshAgendas()
              }}
            />
          ) : (
            <>
              <h2 style={s.detailTitle}>Disponibilidad y horarios</h2>
              <p style={s.detailCopy}>
                Selecciona una Agenda para cargar todos sus datos y configurar horarios, bloqueos, tipos de cita, cupos y reservas.
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  wrap: { padding: 24, maxWidth: 1280, margin: '0 auto' },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    flexWrap: 'wrap',
    marginBottom: 18,
  },
  title: { margin: 0, fontSize: 25, color: '#111827' },
  subtitle: { margin: '5px 0 0', color: '#6b7280', fontSize: 13, lineHeight: 1.5 },
  headerActions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  createBtn: {
    border: 'none',
    borderRadius: 8,
    background: '#4f46e5',
    color: '#fff',
    padding: '9px 12px',
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
  },
  refresh: {
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    background: '#fff',
    color: '#374151',
    padding: '9px 12px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  createBox: {
    border: '1px solid #c7d2fe',
    borderRadius: 12,
    background: '#f8faff',
    padding: 14,
    marginBottom: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  createTitle: { color: '#111827', fontSize: 14, fontWeight: 900 },
  createActions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  searchBox: {
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    background: '#fff',
    padding: 14,
    marginBottom: 16,
  },
  label: {
    display: 'block',
    marginBottom: 7,
    color: '#374151',
    fontSize: 12,
    fontWeight: 800,
  },
  searchRow: { display: 'flex', gap: 10 },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: '10px 11px',
    marginTop: 6,
    background: '#fff',
    color: '#374151',
    fontSize: 13,
    fontFamily: 'inherit',
  },
  searchBtn: {
    border: 'none',
    borderRadius: 8,
    background: '#4f46e5',
    color: '#fff',
    padding: '10px 15px',
    fontWeight: 800,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  help: { margin: '2px 0 0', color: '#6b7280', fontSize: 12, lineHeight: 1.5 },
  message: { margin: '0 0 12px', color: '#b45309', fontSize: 13 },
  workspace: {
    display: 'grid',
    gridTemplateColumns: 'minmax(280px, .82fr) minmax(0, 1.18fr)',
    gap: 14,
    alignItems: 'start',
  },
  list: {
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    background: '#fff',
    overflow: 'hidden',
  },
  listHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    padding: '14px 16px',
    borderBottom: '1px solid #f3f4f6',
    color: '#111827',
    fontSize: 13,
    fontWeight: 800,
  },
  listHint: { color: '#9ca3af', fontSize: 11, fontWeight: 500 },
  empty: {
    minHeight: 210,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    padding: 24,
    textAlign: 'center',
    color: '#6b7280',
    fontSize: 13,
    lineHeight: 1.55,
  },
  results: { display: 'flex', flexDirection: 'column', gap: 8, padding: 10 },
  result: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    border: '1px solid #e5e7eb',
    borderRadius: 9,
    background: '#fff',
    color: '#374151',
    padding: 11,
    textAlign: 'left',
    fontFamily: 'inherit',
    fontSize: 13,
    cursor: 'pointer',
  },
  resultSelected: {
    borderColor: '#4f46e5',
    boxShadow: '0 0 0 3px rgba(79,70,229,.10)',
  },
  cardTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    alignItems: 'flex-start',
  },
  statusPill: {
    borderRadius: 999,
    padding: '3px 7px',
    fontSize: 10,
    fontWeight: 800,
    whiteSpace: 'nowrap',
  },
  configureHint: { color: '#4f46e5', fontSize: 11, fontWeight: 800 },
  loadMoreWrap: {
    display: 'flex',
    justifyContent: 'center',
    padding: '2px 10px 12px',
  },
  detail: {
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    background: '#fff',
    padding: 18,
    minHeight: 260,
  },
  detailTitle: { margin: 0, color: '#111827', fontSize: 16 },
  detailCopy: { margin: '8px 0 0', color: '#6b7280', fontSize: 13, lineHeight: 1.55 },
}
