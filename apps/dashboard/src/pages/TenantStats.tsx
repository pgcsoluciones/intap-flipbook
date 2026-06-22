import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE, api } from '../lib/api'

function authH() {
  const t = localStorage.getItem('token')
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

type FlipbookStat = {
  id: string
  title: string
  views: number
  status: string
  page_count: number
  cover_url?: string | null
}

type RecentView = {
  id: number
  flipbook_title: string
  viewed_at: string
  device: string
}

type PageTime = {
  page_number: number
  visits: number
  avg_ms: number
}

type ButtonClick = {
  label: string
  action_type: string
  page_number: number
  clicks: number
}

type Stats = {
  total_views: number
  published_count: number
  total_pages: number
  publications: FlipbookStat[]
  recent_views: RecentView[]
  page_times: PageTime[]
  button_clicks: ButtonClick[]
}

type PubDetail = {
  publication: { id: string; title: string; status: string; views_count: number; public_slug: string | null }
  total_views: number
  recent_views: { id: number; viewed_at: string; device: string }[]
  device_breakdown: { device: string; count: number }[]
  page_times: { page_number: number; visits: number; avg_ms: number }[]
  button_clicks: { label: string; action_type: string; page_number: number; clicks: number }[]
  views_by_day: { day: string; views: number }[]
  country_breakdown?: { country: string; count: number }[]
  top_links?: { action_type: string; label: string | null; url_destination: string | null; count: number }[]
  page_visits?: { page_number: number; visits: number; avg_ms: number }[]
}

function fmtDuration(ms: number) {
  const s = Math.round((ms ?? 0) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

const ACTION_LABEL: Record<string, string> = {
  link: 'Enlace', page: 'Ir a pagina', call: 'Llamar', email: 'Email',
  whatsapp: 'WhatsApp', popup_text: 'Popup texto', popup_image: 'Popup imagen',
  popup_video: 'Popup video', download: 'Descarga', show_hide: 'Mostrar/ocultar',
}

const DEVICE_ICON: Record<string, string> = { mobile: '📱', desktop: '💻', tablet: '📋' }

function fmtDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleString('es-AR')
}

// Convierte un código ISO 3166-1 alpha-2 (ej: "AR") en emoji de bandera
function countryFlag(code: string): string {
  if (!code || code.length !== 2) return ''
  try {
    return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1F1E6 + c.charCodeAt(0) - 65))
  } catch {
    return ''
  }
}

// Donut SVG nativo para breakdown de dispositivos.
// r=36 → circunferencia = 2 * π * 36 ≈ 226.19
function DeviceDonut({ views, breakdown }: { views: { device: string }[]; breakdown?: { device: string; count: number }[] }) {
  // Si la API devuelve device_breakdown ya agregado, lo usamos directamente
  let counts: { mobile: number; desktop: number; tablet: number }
  if (breakdown && breakdown.length > 0) {
    counts = { mobile: 0, desktop: 0, tablet: 0 }
    for (const b of breakdown) {
      const d = b.device as keyof typeof counts
      if (d in counts) counts[d] += b.count
      else counts.desktop += b.count
    }
  } else {
    counts = { mobile: 0, desktop: 0, tablet: 0 }
    for (const v of views) {
      const d = v.device as keyof typeof counts
      if (d in counts) counts[d]++
      else counts.desktop++
    }
  }

  const total = counts.mobile + counts.desktop + counts.tablet
  if (total === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '1rem' }}>
        <svg width="96" height="96" viewBox="0 0 96 96">
          <circle cx="48" cy="48" r="36" fill="none" stroke="#f3f4f6" strokeWidth="14" />
        </svg>
        <span style={{ fontSize: 12, color: '#9ca3af' }}>Sin datos</span>
      </div>
    )
  }

  const C = 226.19
  const segments = [
    { label: 'Mobile',  key: 'mobile',  color: '#4f46e5', count: counts.mobile },
    { label: 'Desktop', key: 'desktop', color: '#059669', count: counts.desktop },
    { label: 'Tablet',  key: 'tablet',  color: '#d97706', count: counts.tablet },
  ]

  let offset = 0
  const arcs = segments.map((seg) => {
    const arc = (seg.count / total) * C
    const dashoffset = -offset
    offset += arc
    return { ...seg, arc, dashoffset }
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <svg width="96" height="96" viewBox="0 0 96 96" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="48" cy="48" r="36" fill="none" stroke="#f3f4f6" strokeWidth="14" />
        {arcs.map((seg) =>
          seg.arc > 0 ? (
            <circle
              key={seg.key}
              cx="48"
              cy="48"
              r="36"
              fill="none"
              stroke={seg.color}
              strokeWidth="14"
              strokeDasharray={`${seg.arc} ${C - seg.arc}`}
              strokeDashoffset={seg.dashoffset}
            />
          ) : null
        )}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
        {arcs.map((seg) => (
          <div key={seg.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: seg.color, display: 'inline-block' }} />
              {seg.label}
            </span>
            <span style={{ color: '#6b7280' }}>
              {seg.count} ({total > 0 ? Math.round((seg.count / total) * 100) : 0}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Panel de detalle por publicación individual
function PubDetailPanel({
  pubId,
  pubTitle,
  onBack,
}: {
  pubId: string
  pubTitle: string
  onBack: () => void
}) {
  const [detail, setDetail] = useState<PubDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.stats.publication(pubId)
      .then((res) => {
        setDetail(res.data)
      })
      .catch((e: any) => {
        setError(e.message ?? 'Error al cargar estadísticas')
      })
      .finally(() => setLoading(false))
  }, [pubId])

  if (loading) {
    return (
      <div style={s.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1rem' }}>
          <button onClick={onBack} style={s.backBtn}>← Volver</button>
          <h2 style={{ ...s.cardTitle, margin: 0 }}>{pubTitle}</h2>
        </div>
        <div style={{ color: '#6b7280', fontSize: 14 }}>Cargando estadísticas...</div>
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div style={s.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1rem' }}>
          <button onClick={onBack} style={s.backBtn}>← Volver</button>
          <h2 style={{ ...s.cardTitle, margin: 0 }}>{pubTitle}</h2>
        </div>
        <div style={{ color: '#ef4444', fontSize: 14 }}>
          {error ?? 'No se pudieron cargar las estadísticas.'}
        </div>
      </div>
    )
  }

  const pageTimes = detail.page_times ?? []
  const buttonClicks = detail.button_clicks ?? []
  const recentViews = detail.recent_views ?? []
  const viewsByDay = detail.views_by_day ?? []
  const maxAvgMs = Math.max(...pageTimes.map((p) => p.avg_ms ?? 0), 1)
  const maxClicks = Math.max(...buttonClicks.map((b) => b.clicks ?? 0), 1)

  // Barra de vistas por día — sparkline simple con barras SVG
  const maxDayViews = Math.max(...viewsByDay.map((d) => d.views ?? 0), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Header con volver */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={onBack} style={s.backBtn}>← Volver al resumen</button>
        <div>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#111827', margin: 0 }}>{detail.publication.title}</h2>
          {detail.publication.status === 'published' && (
            <span style={{ fontSize: 11, background: '#d1fae5', color: '#065f46', borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>Publicado</span>
          )}
        </div>
      </div>

      {/* Métricas principales */}
      <div style={s.summaryRow}>
        <SummaryCard label="Vistas totales"    value={detail.total_views}     icon="👁️" color="#4f46e5" />
        <SummaryCard label="Vistas recientes"  value={recentViews.length}     icon="📅" color="#059669" />
        <SummaryCard label="Paginas con datos" value={pageTimes.length}       icon="📄" color="#d97706" />
      </div>

      {/* Gráfico de vistas por día + donut dispositivos */}
      {(viewsByDay.length > 0 || recentViews.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '1.25rem', alignItems: 'start' }}>
          {viewsByDay.length > 0 ? (
            <div style={s.card}>
              <h2 style={s.cardTitle}>Vistas por dia (ultimos 30 dias)</h2>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80, padding: '0 4px' }}>
                {viewsByDay.map((d) => {
                  const pct = Math.round(((d.views ?? 0) / maxDayViews) * 100)
                  return (
                    <div key={d.day} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, gap: 4, minWidth: 0 }}>
                      <div
                        title={`${d.day}: ${d.views} vistas`}
                        style={{
                          width: '100%',
                          height: `${Math.max(4, pct * 0.76)}px`,
                          background: '#4f46e5',
                          borderRadius: '3px 3px 0 0',
                          cursor: 'default',
                          transition: 'opacity .2s',
                        }}
                      />
                    </div>
                  )
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: '#9ca3af' }}>
                <span>{viewsByDay[0]?.day ?? ''}</span>
                <span>{viewsByDay[viewsByDay.length - 1]?.day ?? ''}</span>
              </div>
            </div>
          ) : (
            <div style={{ ...s.card, color: '#9ca3af', fontSize: 13, textAlign: 'center', padding: '2rem' }}>
              Sin datos de vistas por dia.
            </div>
          )}

          <div style={{ ...s.card, minWidth: 180 }}>
            <h2 style={s.cardTitle}>Dispositivos</h2>
            <DeviceDonut views={recentViews} breakdown={detail.device_breakdown} />
          </div>
        </div>
      )}

      {/* Tiempo promedio por página */}
      {pageTimes.length > 0 ? (
        <div style={s.card}>
          <h2 style={s.cardTitle}>Tiempo promedio por pagina</h2>
          <div style={s.barList}>
            {pageTimes
              .slice()
              .sort((a, b) => (b.avg_ms ?? 0) - (a.avg_ms ?? 0))
              .map((pt) => {
                const pct = Math.round(((pt.avg_ms ?? 0) / maxAvgMs) * 100)
                return (
                  <div key={pt.page_number} style={s.barRow}>
                    <div style={s.barLabel}>
                      <span style={s.barTitle}>Pagina {pt.page_number}</span>
                      <span style={s.barCount}>{fmtDuration(pt.avg_ms)} · {pt.visits} visita{pt.visits === 1 ? '' : 's'}</span>
                    </div>
                    <div style={s.barTrack}>
                      <div style={{ ...s.barFill, width: `${pct}%`, background: '#059669' }} />
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      ) : (
        <div style={{ ...s.card, textAlign: 'center', padding: '2rem', color: '#9ca3af' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
          <p style={{ margin: 0, fontSize: 14 }}>Aun no hay estadisticas detalladas de paginas para este flipbook.</p>
          <p style={{ margin: '8px 0 0', fontSize: 12 }}>Los datos aparecen cuando los lectores visitan el flipbook publicado.</p>
        </div>
      )}

      {/* Botones mas clickeados */}
      {buttonClicks.length > 0 && (
        <div style={s.card}>
          <h2 style={s.cardTitle}>Botones mas clickeados</h2>
          <div style={s.barList}>
            {buttonClicks.map((bc, i) => {
              const pct = Math.round(((bc.clicks ?? 0) / maxClicks) * 100)
              const kind = ACTION_LABEL[bc.action_type] ?? bc.action_type
              return (
                <div key={i} style={s.barRow}>
                  <div style={s.barLabel}>
                    <span style={s.barTitle}>
                      {bc.label || kind}
                      <span style={{ color: '#9ca3af', fontWeight: 400 }}> · {kind} · pag {bc.page_number}</span>
                    </span>
                    <span style={s.barCount}>{bc.clicks} clic{bc.clicks === 1 ? '' : 's'}</span>
                  </div>
                  <div style={s.barTrack}>
                    <div style={{ ...s.barFill, width: `${pct}%`, background: '#d97706' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Páginas más visitadas */}
      {(detail.page_visits ?? []).length > 0 && (
        <div style={s.card}>
          <h2 style={s.cardTitle}>Paginas mas visitadas</h2>
          <table style={s.table}>
            <thead>
              <tr>
                {['Pagina', 'Visitas', 'Tiempo promedio'].map((h) => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(detail.page_visits ?? []).map((pv) => (
                <tr key={pv.page_number} style={s.tr}>
                  <td style={s.td}>Pagina {pv.page_number}</td>
                  <td style={s.td}>{pv.visits}</td>
                  <td style={{ ...s.td, color: '#6b7280' }}>{fmtDuration(pv.avg_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Links mas clickeados con URL destino */}
      {(detail.top_links ?? []).length > 0 && (
        <div style={s.card}>
          <h2 style={s.cardTitle}>Links mas clickeados</h2>
          <table style={s.table}>
            <thead>
              <tr>
                {['Tipo', 'Etiqueta', 'URL destino', 'Clics'].map((h) => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(detail.top_links ?? []).map((link, i) => {
                const dest = link.url_destination ?? ''
                const destTrunc = dest.length > 40 ? dest.slice(0, 40) + '…' : dest
                const kind = ACTION_LABEL[link.action_type] ?? link.action_type
                return (
                  <tr key={i} style={s.tr}>
                    <td style={s.td}>{kind}</td>
                    <td style={{ ...s.td, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {link.label ?? '—'}
                    </td>
                    <td style={{ ...s.td, color: '#6b7280', maxWidth: 200 }}>
                      <span title={dest}>{destTrunc || '—'}</span>
                    </td>
                    <td style={{ ...s.td, fontWeight: 700 }}>{link.count}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Top Paises */}
      {(detail.country_breakdown ?? []).length > 0 && (
        <div style={s.card}>
          <h2 style={s.cardTitle}>Top Paises</h2>
          {(() => {
            const items = detail.country_breakdown ?? []
            const maxCount = Math.max(...items.map((c) => c.count), 1)
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {items.map((item) => {
                  const pct = Math.round((item.count / maxCount) * 100)
                  const flag = countryFlag(item.country)
                  return (
                    <div key={item.country} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 20, width: 28, textAlign: 'center', flexShrink: 0 }}>{flag}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#374151', width: 36, flexShrink: 0 }}>{item.country}</span>
                      <div style={{ flex: 1, height: 10, background: '#f3f4f6', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: '#4f46e5', borderRadius: 6, transition: 'width .4s' }} />
                      </div>
                      <span style={{ fontSize: 12, color: '#6b7280', width: 36, textAlign: 'right', flexShrink: 0 }}>{item.count}</span>
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </div>
      )}

      {/* Ultimas vistas */}
      {recentViews.length > 0 && (
        <div style={s.card}>
          <h2 style={s.cardTitle}>Ultimas vistas</h2>
          <table style={s.table}>
            <thead>
              <tr>
                {['Dispositivo', 'Fecha'].map((h) => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentViews.slice(0, 50).map((v, i) => (
                <tr key={v.id ?? i} style={s.tr}>
                  <td style={s.td}>
                    <span style={s.deviceCell}>
                      {DEVICE_ICON[v.device] ?? '🖥️'} {v.device}
                    </span>
                  </td>
                  <td style={{ ...s.td, color: '#9ca3af' }}>{fmtDateTime(v.viewed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {recentViews.length > 50 && (
            <p style={{ marginTop: 8, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
              Mostrando las 50 vistas mas recientes de {recentViews.length} totales.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default function TenantStats() {
  const navigate = useNavigate()
  const [stats, setStats]     = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [selectedPub, setSelectedPub] = useState<string>('') // '' = vista general
  const [selectedPubTitle, setSelectedPubTitle] = useState<string>('')

  useEffect(() => {
    if (!localStorage.getItem('token')) { navigate('/login'); return }
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`${API_BASE}/auth/stats/my`, { headers: authH() })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      if (!d.success) throw new Error(d.error ?? 'Error al cargar estadísticas')
      setStats(d.data)
    } catch (e: any) {
      setError(e.message)
      setStats(null)
    } finally {
      setLoading(false)
    }
  }

  function handleSelectPub(pub: FlipbookStat) {
    setSelectedPub(pub.id)
    setSelectedPubTitle(pub.title)
  }

  function handleBack() {
    setSelectedPub('')
    setSelectedPubTitle('')
  }

  if (loading) return <div style={s.loading}>Cargando estadísticas...</div>

  if (error || !stats) {
    return (
      <div style={s.page}>
        <div style={s.inner}>
          <div style={s.pageHeader}>
            <h1 style={s.h1}>Mis estadísticas</h1>
          </div>
          <div style={{ ...s.card, textAlign: 'center', padding: '3rem', color: '#9ca3af' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
            <p style={{ margin: 0 }}>
              {error
                ? `No se pudieron cargar las estadísticas: ${error}`
                : 'Aún no tenés vistas registradas. Publicá tu flipbook y compartilo para ver estadísticas aquí.'}
            </p>
            <button onClick={load} style={{ marginTop: 16, padding: '8px 18px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
              Reintentar
            </button>
          </div>
        </div>
      </div>
    )
  }

  const publications = stats.publications ?? []
  const recentViews  = stats.recent_views ?? []
  const maxViews     = Math.max(...publications.map((f) => f.views ?? 0), 1)
  const pageTimes    = stats.page_times ?? []
  const buttonClicks = stats.button_clicks ?? []
  const maxAvgMs     = Math.max(...pageTimes.map((p) => p.avg_ms ?? 0), 1)
  const maxClicks    = Math.max(...buttonClicks.map((b) => b.clicks ?? 0), 1)

  return (
    <div style={s.page}>
      <div style={s.inner}>
        <div style={s.pageHeader}>
          <h1 style={s.h1}>Mis estadísticas</h1>
          <p style={s.sub}>
            {selectedPub ? 'Detalle del flipbook seleccionado' : 'Resumen de rendimiento de tus flipbooks'}
          </p>
        </div>

        {/* Vista de detalle por publicación */}
        {selectedPub ? (
          <PubDetailPanel
            pubId={selectedPub}
            pubTitle={selectedPubTitle}
            onBack={handleBack}
          />
        ) : (
          <>
            {/* Listado de publicaciones clickeables */}
            {publications.length > 0 && (
              <div style={s.card}>
                <h2 style={s.cardTitle}>Tus flipbooks — hacé clic para ver el detalle</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {publications
                    .slice()
                    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
                    .map((pub) => {
                      const pct = Math.round(((pub.views ?? 0) / maxViews) * 100)
                      return (
                        <button
                          key={pub.id}
                          onClick={() => handleSelectPub(pub)}
                          style={s.pubRow}
                          title={`Ver estadísticas detalladas de "${pub.title}"`}
                        >
                          {/* Miniatura / placeholder */}
                          <div style={s.pubThumb}>
                            {(pub.cover_url ?? (pub as any).cover_image_url) ? (
                              <img src={pub.cover_url ?? (pub as any).cover_image_url} alt={pub.title} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6 }} />
                            ) : (
                              <span style={{ fontSize: 22 }}>📖</span>
                            )}
                          </div>

                          {/* Info + barra */}
                          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                              <span style={{ fontWeight: 700, fontSize: 14, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {pub.title}
                              </span>
                              <span style={{ fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                {pub.views ?? 0} vista{pub.views === 1 ? '' : 's'}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ flex: 1, height: 8, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${pct}%`, background: '#4f46e5', borderRadius: 4, transition: 'width .4s' }} />
                              </div>
                              {pub.status === 'published' ? (
                                <span style={{ fontSize: 10, background: '#d1fae5', color: '#065f46', borderRadius: 4, padding: '1px 6px', fontWeight: 600, flexShrink: 0 }}>
                                  Publicado
                                </span>
                              ) : (
                                <span style={{ fontSize: 10, background: '#f3f4f6', color: '#9ca3af', borderRadius: 4, padding: '1px 6px', fontWeight: 600, flexShrink: 0 }}>
                                  Borrador
                                </span>
                              )}
                            </div>
                          </div>

                          <span style={{ color: '#9ca3af', fontSize: 16, flexShrink: 0 }}>›</span>
                        </button>
                      )
                    })}
                </div>
              </div>
            )}

            {/* Summary cards */}
            <div style={s.summaryRow}>
              <SummaryCard label="Vistas totales"       value={stats.total_views}     icon="👁️" color="#4f46e5" />
              <SummaryCard label="Flipbooks publicados" value={stats.published_count} icon="📚" color="#059669" />
              <SummaryCard label="Páginas totales"      value={stats.total_pages}     icon="📄" color="#d97706" />
            </div>

            {/* Gráfico de barras + donut en fila */}
            {publications.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '1.25rem', alignItems: 'start' }}>
                {/* Barras SVG */}
                <div style={s.card}>
                  <h2 style={s.cardTitle}>Vistas por flipbook</h2>
                  <div style={s.barList}>
                    {publications
                      .slice()
                      .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
                      .map((fb) => {
                        const pct = Math.round(((fb.views ?? 0) / maxViews) * 100)
                        return (
                          <div key={fb.id} style={s.barRow}>
                            <div style={s.barLabel}>
                              <span style={s.barTitle}>{fb.title}</span>
                              <span style={s.barCount}>{fb.views ?? 0} vistas</span>
                            </div>
                            <div style={s.barTrack}>
                              <div style={{ ...s.barFill, width: `${pct}%` }} />
                            </div>
                          </div>
                        )
                      })}
                  </div>
                </div>

                {/* Donut dispositivos */}
                <div style={{ ...s.card, minWidth: 180 }}>
                  <h2 style={s.cardTitle}>Dispositivos</h2>
                  <DeviceDonut views={recentViews} />
                </div>
              </div>
            )}

            {/* Tiempo de permanencia por página */}
            {pageTimes.length > 0 && (
              <div style={s.card}>
                <h2 style={s.cardTitle}>Tiempo promedio por página</h2>
                <div style={s.barList}>
                  {pageTimes
                    .slice()
                    .sort((a, b) => (b.avg_ms ?? 0) - (a.avg_ms ?? 0))
                    .map((pt) => {
                      const pct = Math.round(((pt.avg_ms ?? 0) / maxAvgMs) * 100)
                      return (
                        <div key={pt.page_number} style={s.barRow}>
                          <div style={s.barLabel}>
                            <span style={s.barTitle}>Página {pt.page_number}</span>
                            <span style={s.barCount}>{fmtDuration(pt.avg_ms)} · {pt.visits} visita{pt.visits === 1 ? '' : 's'}</span>
                          </div>
                          <div style={s.barTrack}>
                            <div style={{ ...s.barFill, width: `${pct}%`, background: '#059669' }} />
                          </div>
                        </div>
                      )
                    })}
                </div>
              </div>
            )}

            {/* Botones más clickeados */}
            {buttonClicks.length > 0 && (
              <div style={s.card}>
                <h2 style={s.cardTitle}>Botones más clickeados</h2>
                <div style={s.barList}>
                  {buttonClicks.map((bc, i) => {
                    const pct = Math.round(((bc.clicks ?? 0) / maxClicks) * 100)
                    const kind = ACTION_LABEL[bc.action_type] ?? bc.action_type
                    return (
                      <div key={i} style={s.barRow}>
                        <div style={s.barLabel}>
                          <span style={s.barTitle}>
                            {bc.label || kind}
                            <span style={{ color: '#9ca3af', fontWeight: 400 }}> · {kind} · pág {bc.page_number}</span>
                          </span>
                          <span style={s.barCount}>{bc.clicks} clic{bc.clicks === 1 ? '' : 's'}</span>
                        </div>
                        <div style={s.barTrack}>
                          <div style={{ ...s.barFill, width: `${pct}%`, background: '#d97706' }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Tabla de vistas recientes con filtros y paginación */}
            {recentViews.length > 0 && <RecentViewsReport views={recentViews} />}

            {stats.total_views === 0 && (
              <div style={{ ...s.card, textAlign: 'center', padding: '3rem', color: '#9ca3af' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
                <p style={{ margin: 0 }}>Aún no tenés vistas registradas. Publicá tu flipbook y compartilo para ver estadísticas aquí.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// Reporte de vistas recientes: filtro por dispositivo y por flipbook + paginación (10/pág)
const PAGE_SIZE = 10
function RecentViewsReport({ views }: { views: RecentView[] }) {
  const [deviceFilter, setDeviceFilter] = useState('')
  const [fbFilter, setFbFilter]         = useState('')
  const [page, setPage]                 = useState(1)

  const devices = Array.from(new Set(views.map((v) => v.device).filter(Boolean)))

  const filtered = views.filter((v) => {
    const dMatch = !deviceFilter || v.device === deviceFilter
    const fMatch = !fbFilter || (v.flipbook_title ?? '').toLowerCase().includes(fbFilter.toLowerCase())
    return dMatch && fMatch
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const pageRows   = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function resetTo1<T>(setter: (v: T) => void) {
    return (val: T) => { setter(val); setPage(1) }
  }

  return (
    <div style={s.card}>
      <h2 style={s.cardTitle}>Últimas vistas</h2>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <input
          style={{ flex: 1, minWidth: 160, border: '1px solid #d1d5db', borderRadius: 8, padding: '7px 10px', fontSize: 13, boxSizing: 'border-box' }}
          placeholder="Buscar por flipbook..."
          value={fbFilter}
          onChange={(e) => resetTo1(setFbFilter)(e.target.value)}
        />
        <select
          style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: '7px 10px', fontSize: 13, background: '#fff' }}
          value={deviceFilter}
          onChange={(e) => resetTo1(setDeviceFilter)(e.target.value)}
        >
          <option value="">Todos los dispositivos</option>
          {devices.map((d) => <option key={d} value={d}>{DEVICE_ICON[d] ?? '🖥️'} {d}</option>)}
        </select>
      </div>

      <table style={s.table}>
        <thead>
          <tr>
            {['Flipbook', 'Dispositivo', 'Fecha'].map((h) => (
              <th key={h} style={s.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageRows.map((v, i) => (
            <tr key={v.id ?? i} style={s.tr}>
              <td style={s.td}>{v.flipbook_title}</td>
              <td style={s.td}>
                <span style={s.deviceCell}>
                  {DEVICE_ICON[v.device] ?? '🖥️'} {v.device}
                </span>
              </td>
              <td style={{ ...s.td, color: '#9ca3af' }}>{fmtDateTime(v.viewed_at)}</td>
            </tr>
          ))}
          {pageRows.length === 0 && (
            <tr><td colSpan={3} style={{ textAlign: 'center', padding: '1.5rem', color: '#9ca3af' }}>Sin resultados para el filtro.</td></tr>
          )}
        </tbody>
      </table>

      {filtered.length > PAGE_SIZE && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 12 }}>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}
            style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #d1d5db', background: safePage <= 1 ? '#f3f4f6' : '#fff', cursor: safePage <= 1 ? 'default' : 'pointer', fontSize: 13 }}>
            Anterior
          </button>
          <span style={{ fontSize: 13, color: '#6b7280' }}>Página {safePage} de {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
            style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #d1d5db', background: safePage >= totalPages ? '#f3f4f6' : '#fff', cursor: safePage >= totalPages ? 'default' : 'pointer', fontSize: 13 }}>
            Siguiente
          </button>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, icon, color }: { label: string; value: number; icon: string; color: string }) {
  return (
    <div style={s.summaryCard}>
      <div style={{ ...s.summaryIcon, background: color + '18', color }}>
        {icon}
      </div>
      <span style={s.summaryValue}>{(value ?? 0).toLocaleString('es-AR')}</span>
      <span style={s.summaryLabel}>{label}</span>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page:         { minHeight: '100vh', background: '#f8fafc' },
  loading:      { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#6b7280' },
  inner:        { maxWidth: 900, margin: '0 auto', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' },
  pageHeader:   { display: 'flex', flexDirection: 'column', gap: 4 },
  h1:           { fontSize: '1.5rem', fontWeight: 800, color: '#111827', margin: 0 },
  sub:          { color: '#6b7280', fontSize: 14, margin: 0 },
  summaryRow:   { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' },
  summaryCard:  { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 },
  summaryIcon:  { width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 },
  summaryValue: { fontSize: '2rem', fontWeight: 800, color: '#111827', lineHeight: 1 },
  summaryLabel: { fontSize: 13, color: '#6b7280' },
  card:         { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '1.25rem 1.5rem' },
  cardTitle:    { fontSize: 15, fontWeight: 700, color: '#111827', margin: '0 0 1.25rem' },
  barList:      { display: 'flex', flexDirection: 'column', gap: 16 },
  barRow:       { display: 'flex', flexDirection: 'column', gap: 6 },
  barLabel:     { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' },
  barTitle:     { fontSize: 13, fontWeight: 600, color: '#374151' },
  barCount:     { fontSize: 12, color: '#6b7280' },
  barTrack:     { height: 10, background: '#f3f4f6', borderRadius: 6, overflow: 'hidden' },
  barFill:      { height: '100%', background: '#4f46e5', borderRadius: 6, transition: 'width .4s' },
  table:        { width: '100%', borderCollapse: 'collapse' },
  th:           { padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#6b7280', borderBottom: '1px solid #f3f4f6', background: '#fafafa' },
  tr:           { borderBottom: '1px solid #f9fafb' },
  td:           { padding: '10px 10px', fontSize: 13, verticalAlign: 'middle' },
  deviceCell:   { display: 'flex', alignItems: 'center', gap: 6, textTransform: 'capitalize', fontSize: 13 },
  // Fila de publicacion clickeable
  pubRow: {
    display: 'flex', alignItems: 'center', gap: 14,
    padding: '10px 12px', borderRadius: 10,
    border: '1px solid #e5e7eb', background: '#fafafa',
    cursor: 'pointer', textAlign: 'left', width: '100%',
    transition: 'background .15s, border-color .15s',
  } as React.CSSProperties,
  pubThumb: {
    width: 48, height: 48, borderRadius: 8,
    background: '#f3f4f6', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  } as React.CSSProperties,
  backBtn: {
    padding: '7px 14px', borderRadius: 8,
    border: '1px solid #d1d5db', background: '#fff',
    cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#374151',
  } as React.CSSProperties,
}
