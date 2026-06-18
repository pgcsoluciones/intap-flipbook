import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE } from '../lib/api'

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

function fmtDuration(ms: number) {
  const s = Math.round((ms ?? 0) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

const ACTION_LABEL: Record<string, string> = {
  link: '🔗 Enlace', page: '📄 Ir a página', call: '📞 Llamar', email: '✉️ Email',
  whatsapp: '💬 WhatsApp', popup_text: '💬 Popup texto', popup_image: '🖼️ Popup imagen',
  popup_video: '🎬 Popup video', download: '⬇️ Descarga', show_hide: '👁️ Mostrar/ocultar',
}

const DEVICE_ICON: Record<string, string> = { mobile: '📱', desktop: '💻', tablet: '📋' }

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins < 60) return `hace ${mins} min`
  if (hours < 24) return `hace ${hours} h`
  return `hace ${days} d`
}

// Donut SVG nativo para breakdown de dispositivos.
// r=36 → circunferencia = 2 * π * 36 ≈ 226.19
function DeviceDonut({ views }: { views: RecentView[] }) {
  const total = views.length
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

  const counts = { mobile: 0, desktop: 0, tablet: 0 }
  for (const v of views) {
    const d = v.device as keyof typeof counts
    if (d in counts) counts[d]++
    else counts.desktop++
  }

  const C = 226.19 // circunferencia (2 * π * 36)
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

export default function TenantStats() {
  const navigate = useNavigate()
  const [stats, setStats]     = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [selectedPub, setSelectedPub] = useState<string>('') // '' = todas

  useEffect(() => {
    if (!localStorage.getItem('token')) { navigate('/login'); return }
    load()
  }, [selectedPub])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const qs = selectedPub ? `?publication_id=${encodeURIComponent(selectedPub)}` : ''
      const r = await fetch(`${API_BASE}/auth/stats/my${qs}`, { headers: authH() })
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
          <p style={s.sub}>Resumen de rendimiento de tus flipbooks</p>
        </div>

        {/* Selector de publicación para el detalle de analíticas */}
        {publications.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: '#6b7280', fontWeight: 600 }}>Analíticas de:</span>
            <select
              value={selectedPub}
              onChange={(e) => setSelectedPub(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, background: '#fff', minWidth: 200 }}
            >
              <option value="">Todas las publicaciones</option>
              {publications.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
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
            <h2 style={s.cardTitle}>⏱️ Tiempo promedio por página</h2>
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
            <h2 style={s.cardTitle}>🖱️ Botones más clickeados</h2>
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

        {/* Tabla de vistas recientes */}
        {recentViews.length > 0 && (
          <div style={s.card}>
            <h2 style={s.cardTitle}>Últimas vistas</h2>
            <table style={s.table}>
              <thead>
                <tr>
                  {['Flipbook', 'Dispositivo', 'Hace'].map((h) => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentViews.slice(0, 10).map((v, i) => (
                  <tr key={v.id ?? i} style={s.tr}>
                    <td style={s.td}>{v.flipbook_title}</td>
                    <td style={s.td}>
                      <span style={s.deviceCell}>
                        {DEVICE_ICON[v.device] ?? '🖥️'} {v.device}
                      </span>
                    </td>
                    <td style={{ ...s.td, color: '#9ca3af' }}>{timeAgo(v.viewed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {stats.total_views === 0 && (
          <div style={{ ...s.card, textAlign: 'center', padding: '3rem', color: '#9ca3af' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
            <p style={{ margin: 0 }}>Aún no tenés vistas registradas. Publicá tu flipbook y compartilo para ver estadísticas aquí.</p>
          </div>
        )}
      </div>
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
}
