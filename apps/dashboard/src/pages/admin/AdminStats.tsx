import { useEffect, useState } from 'react'
import { API_BASE } from '../../lib/api'

function authH() {
  const t = localStorage.getItem('token')
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

type StatsData = {
  mrr: number
  arr: number
  storage_total_mb: number
  active_tenants: number
  by_plan: { plan_id: string; count: number }[]
}

const PLAN_PRICES: Record<string, number> = { basic: 9.99, pro: 29.99 }

function buildStats(raw: any): StatsData {
  const byPlan: { plan_id: string; count: number }[] = raw.by_plan ?? []
  const mrr = byPlan.reduce((acc, p) => acc + (PLAN_PRICES[p.plan_id] ?? 0) * (p.count ?? 0), 0)
  return {
    mrr,
    arr: mrr * 12,
    storage_total_mb: raw.storage_mb ?? 0,
    active_tenants: raw.users ?? 0,
    by_plan: byPlan,
  }
}

type TopPublication = {
  id: string
  title: string
  tenant_email: string
  total_views: number
}

type RecentView = {
  id: string
  publication_title: string
  device: string
  viewed_at: string
}

function KPI({ icon, label, value, sub }: { icon: string; label: string; value: string | number; sub?: string }) {
  return (
    <div style={s.kpi}>
      <span style={{ fontSize: 28 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: '#111827' }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: '#9ca3af' }}>{sub}</div>}
      </div>
    </div>
  )
}

const PLAN_COLORS: Record<string, string> = {
  free:  '#6b7280',
  basic: '#4f46e5',
  pro:   '#059669',
}

export default function AdminStats() {
  const [stats, setStats]           = useState<StatsData | null>(null)
  const [topPubs, setTopPubs]       = useState<TopPublication[]>([])
  const [recentViews, setRecentViews] = useState<RecentView[]>([])
  const [loading, setLoading]       = useState(true)
  const [msg, setMsg]               = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [sr, tr, vr] = await Promise.all([
        fetch(`${API_BASE}/admin/stats`, { headers: authH() }),
        fetch(`${API_BASE}/admin/stats/top-publications`, { headers: authH() }),
        fetch(`${API_BASE}/admin/stats/recent-views`, { headers: authH() }),
      ])
      const sd = await sr.json()
      const td = await tr.json()
      const vd = await vr.json()
      if (!sr.ok) throw new Error(sd.error ?? `HTTP ${sr.status}`)
      if (!tr.ok) throw new Error(td.error ?? `HTTP ${tr.status}`)
      if (!vr.ok) throw new Error(vd.error ?? `HTTP ${vr.status}`)
      setStats(buildStats(sd.data))
      setTopPubs(td.data ?? [])
      setRecentViews(vd.data ?? [])
    } catch (e: any) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  if (loading) return <div style={{ padding: '3rem', color: '#666' }}>Cargando estadísticas...</div>

  const totalTenants = (stats?.by_plan ?? []).reduce((acc, p) => acc + (p.count ?? 0), 0)

  return (
    <div style={s.page}>
      {msg && <div style={s.toast}>{msg}</div>}

      <div style={s.header}>
        <div>
          <h1 style={s.h1}>Estadísticas globales</h1>
          <p style={s.sub}>Métricas clave del sistema Intap Flipbook</p>
        </div>
        <button onClick={load} style={s.refreshBtn}>↻ Actualizar</button>
      </div>

      {/* KPI Cards */}
      <div style={s.kpiGrid}>
        <KPI
          icon="💰"
          label="MRR estimado"
          value={`$${(stats?.mrr ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          sub="Ingresos mensuales recurrentes"
        />
        <KPI
          icon="📈"
          label="ARR estimado"
          value={`$${(stats?.arr ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          sub="MRR × 12"
        />
        <KPI
          icon="💾"
          label="Storage total"
          value={`${(stats?.storage_total_mb ?? 0).toLocaleString('es-AR')} MB`}
          sub="Consumido por todos los tenants"
        />
        <KPI
          icon="👥"
          label="Tenants activos"
          value={stats?.active_tenants ?? 0}
          sub="Usuarios con al menos una publicación"
        />
      </div>

      {/* Distribución por plan — barras CSS */}
      <section style={s.card}>
        <h2 style={s.cardTitle}>Distribución por plan</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {(stats?.by_plan ?? []).map((p) => {
            const pct = totalTenants > 0 ? Math.round((p.count / totalTenants) * 100) : 0
            const color = PLAN_COLORS[p.plan_id] ?? '#9ca3af'
            return (
              <div key={p.plan_id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#374151', textTransform: 'capitalize' as const }}>
                    {p.plan_id}
                  </span>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>
                    {p.count} tenant{p.count !== 1 ? 's' : ''} — {pct}%
                  </span>
                </div>
                <div style={{ background: '#f3f4f6', borderRadius: 6, height: 10, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${pct}%`,
                      background: color,
                      borderRadius: 6,
                      transition: 'width .4s ease',
                      minWidth: pct > 0 ? 4 : 0,
                    }}
                  />
                </div>
              </div>
            )
          })}
          {(stats?.by_plan ?? []).length === 0 && (
            <p style={{ color: '#9ca3af', fontSize: 13 }}>Sin datos de distribución.</p>
          )}
        </div>
      </section>

      {/* Top 10 publicaciones más vistas */}
      <section style={s.card}>
        <h2 style={s.cardTitle}>Top 10 publicaciones más vistas</h2>
        {topPubs.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: 13 }}>Sin datos disponibles.</p>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                {['#', 'Título', 'Tenant', 'Vistas totales'].map((h) => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topPubs.slice(0, 10).map((pub, i) => (
                <tr key={pub.id} style={s.tr}>
                  <td style={{ ...s.td, color: '#9ca3af', fontWeight: 700, width: 32 }}>{i + 1}</td>
                  <td style={s.td}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{pub.title}</span>
                  </td>
                  <td style={s.td}>
                    <span style={{ fontSize: 12, color: '#6b7280' }}>{pub.tenant_email}</span>
                  </td>
                  <td style={s.td}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: '#4f46e5' }}>
                      {pub.total_views.toLocaleString('es-AR')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Actividad reciente — últimas 20 vistas */}
      <section style={s.card}>
        <h2 style={s.cardTitle}>Actividad reciente — últimas 20 vistas</h2>
        {recentViews.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: 13 }}>Sin actividad reciente.</p>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                {['Publicación', 'Dispositivo', 'Fecha'].map((h) => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentViews.slice(0, 20).map((v) => (
                <tr key={v.id} style={s.tr}>
                  <td style={s.td}>
                    <span style={{ fontSize: 13 }}>{v.publication_title}</span>
                  </td>
                  <td style={s.td}>
                    <span style={s.deviceBadge}>
                      {v.device === 'mobile' ? '📱' : v.device === 'tablet' ? '⬜' : '🖥️'}{' '}
                      {v.device ?? '—'}
                    </span>
                  </td>
                  <td style={s.td}>
                    <span style={{ fontSize: 12, color: '#6b7280' }}>
                      {new Date(v.viewed_at).toLocaleString('es-AR')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page:        { padding: '2rem 1.5rem', maxWidth: 1100, margin: '0 auto' },
  header:      { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' },
  h1:          { fontSize: '1.5rem', fontWeight: 800, color: '#111827', margin: 0 },
  sub:         { color: '#6b7280', fontSize: 13, margin: '4px 0 0' },
  refreshBtn:  { background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 13, color: '#374151' },
  toast:       { position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', background: '#1f2937', color: '#fff', padding: '8px 20px', borderRadius: 8, fontSize: 13, zIndex: 200 },
  kpiGrid:     { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' },
  kpi:         { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' },
  card:        { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '1.25rem', marginBottom: '1rem' },
  cardTitle:   { fontSize: 15, fontWeight: 700, color: '#111827', margin: '0 0 1rem' },
  table:       { width: '100%', borderCollapse: 'collapse' as const },
  th:          { padding: '8px 10px', textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: '#6b7280', borderBottom: '1px solid #f3f4f6', background: '#fafafa' },
  tr:          { borderBottom: '1px solid #f9fafb' },
  td:          { padding: '10px 10px', fontSize: 13, verticalAlign: 'middle' as const },
  deviceBadge: { fontSize: 12, color: '#374151' },
}
