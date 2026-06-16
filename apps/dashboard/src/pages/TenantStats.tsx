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
}

type RecentView = {
  id: number
  flipbook_title: string
  viewed_at: string
  device: string
}

type Stats = {
  total_views: number
  published_count: number
  total_pages: number
  flipbooks: FlipbookStat[]
  recent_views: RecentView[]
}

// TODO: reemplazar con datos reales cuando GET /api/stats/my esté implementado
const MOCK_STATS: Stats = {
  total_views: 142,
  published_count: 3,
  total_pages: 24,
  flipbooks: [
    { id: '1', title: 'Catálogo de verano', views: 89, status: 'published' },
    { id: '2', title: 'Menú especial',       views: 35, status: 'published' },
    { id: '3', title: 'Portafolio 2024',     views: 18, status: 'published' },
  ],
  recent_views: [
    { id: 1, flipbook_title: 'Catálogo de verano', viewed_at: new Date(Date.now() - 30 * 60000).toISOString(),  device: 'mobile' },
    { id: 2, flipbook_title: 'Menú especial',       viewed_at: new Date(Date.now() - 2 * 3600000).toISOString(), device: 'desktop' },
    { id: 3, flipbook_title: 'Catálogo de verano', viewed_at: new Date(Date.now() - 5 * 3600000).toISOString(), device: 'desktop' },
    { id: 4, flipbook_title: 'Portafolio 2024',    viewed_at: new Date(Date.now() - 86400000).toISOString(),    device: 'mobile' },
    { id: 5, flipbook_title: 'Menú especial',       viewed_at: new Date(Date.now() - 2 * 86400000).toISOString(), device: 'tablet' },
    { id: 6, flipbook_title: 'Catálogo de verano', viewed_at: new Date(Date.now() - 3 * 86400000).toISOString(), device: 'desktop' },
    { id: 7, flipbook_title: 'Catálogo de verano', viewed_at: new Date(Date.now() - 6 * 86400000).toISOString(), device: 'mobile' },
  ],
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

export default function TenantStats() {
  const navigate = useNavigate()
  const [stats, setStats]   = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!localStorage.getItem('token')) { navigate('/login'); return }
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const r = await fetch(`${API_BASE}/api/stats/my`, { headers: authH() })
      if (r.ok) {
        const d = await r.json()
        setStats(d.data)
      } else {
        setStats(MOCK_STATS)
      }
    } catch {
      setStats(MOCK_STATS)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div style={s.loading}>Cargando estadísticas...</div>
  if (!stats) return <div style={s.loading}>No hay estadísticas disponibles.</div>

  const maxViews = Math.max(...stats.flipbooks.map((f) => f.views), 1)

  return (
    <div style={s.page}>
      <div style={s.inner}>
        <div style={s.pageHeader}>
          <h1 style={s.h1}>Mis estadísticas</h1>
          <p style={s.sub}>Resumen de rendimiento de tus flipbooks</p>
        </div>

        <div style={s.summaryRow}>
          <SummaryCard label="Vistas totales"    value={stats.total_views}     icon="👁️" color="#4f46e5" />
          <SummaryCard label="Flipbooks publicados" value={stats.published_count} icon="📚" color="#059669" />
          <SummaryCard label="Páginas totales"   value={stats.total_pages}     icon="📄" color="#d97706" />
        </div>

        {stats.flipbooks.length > 0 && (
          <div style={s.card}>
            <h2 style={s.cardTitle}>Vistas por flipbook</h2>
            <div style={s.barList}>
              {stats.flipbooks
                .slice()
                .sort((a, b) => b.views - a.views)
                .map((fb) => {
                  const pct = Math.round((fb.views / maxViews) * 100)
                  return (
                    <div key={fb.id} style={s.barRow}>
                      <div style={s.barLabel}>
                        <span style={s.barTitle}>{fb.title}</span>
                        <span style={s.barCount}>{fb.views} vistas</span>
                      </div>
                      <div style={s.barTrack}>
                        <div style={{ ...s.barFill, width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>
        )}

        {stats.recent_views.length > 0 && (
          <div style={s.card}>
            <h2 style={s.cardTitle}>Últimas 7 vistas</h2>
            <table style={s.table}>
              <thead>
                <tr>
                  {['Flipbook', 'Dispositivo', 'Hace'].map((h) => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.recent_views.slice(0, 7).map((v) => (
                  <tr key={v.id} style={s.tr}>
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
      <span style={s.summaryValue}>{value.toLocaleString('es-AR')}</span>
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
