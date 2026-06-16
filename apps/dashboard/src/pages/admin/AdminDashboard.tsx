import { useEffect, useState } from 'react'
import { API_BASE } from '../../lib/api'

function authH() {
  const t = localStorage.getItem('token')
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}
async function adminGet<T>(path: string): Promise<T> {
  const r = await fetch(`${API_BASE}/admin${path}`, { headers: authH() })
  const d = await r.json()
  if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
  return d
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

export default function AdminDashboard() {
  const [stats, setStats]     = useState<any>(null)
  const [users, setUsers]     = useState<any[]>([])
  const [requests, setReqs]   = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg]         = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [s, u, r] = await Promise.all([
        adminGet<any>('/stats'),
        adminGet<any>('/users'),
        adminGet<any>('/plan-requests'),
      ])
      setStats(s.data)
      setUsers(u.data)
      setReqs(r.data ?? [])
    } catch (e: any) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  async function handleRequest(id: number, action: 'approve' | 'reject') {
    try {
      await fetch(`${API_BASE}/admin/plan-requests/${id}`, {
        method: 'PUT',
        headers: authH(),
        body: JSON.stringify({ action }),
      })
      setReqs((prev) => prev.filter((r) => r.id !== id))
      flash(action === 'approve' ? 'Solicitud aprobada.' : 'Solicitud rechazada.')
    } catch (e: any) { flash(e.message) }
  }

  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(''), 3000) }

  if (loading) return <div style={{ padding: '3rem', color: '#666' }}>Cargando...</div>

  const byPlan = stats?.by_plan ?? []
  const mrr = byPlan.reduce((acc: number, p: any) => {
    const prices: Record<string, number> = { basic: 9.99, pro: 29.99 }
    return acc + (prices[p.plan_id] ?? 0) * (p.count ?? 0)
  }, 0)

  return (
    <div style={s.page}>
      {msg && <div style={s.toast}>{msg}</div>}

      <div style={s.header}>
        <div>
          <h1 style={s.h1}>Dashboard global</h1>
          <p style={s.sub}>Vista general del sistema Intap Flipbook</p>
        </div>
        <button onClick={load} style={s.refreshBtn}>↻ Actualizar</button>
      </div>

      {/* KPIs */}
      <div style={s.kpiGrid}>
        <KPI icon="👥" label="Tenants activos"    value={stats?.users ?? 0} />
        <KPI icon="💰" label="MRR estimado"       value={`$${mrr.toFixed(2)}`} sub="ingresos mensuales recurrentes" />
        <KPI icon="💾" label="Storage total"      value={`${stats?.storage_mb ?? 0} MB`} />
        <KPI icon="⏳" label="Solicitudes pendientes" value={requests.filter((r) => r.status === 'pending').length} />
      </div>

      {/* Distribución por plan */}
      <section style={s.card}>
        <h2 style={s.cardTitle}>Distribución por plan</h2>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          {byPlan.map((p: any) => (
            <div key={p.plan_id} style={s.planChip}>
              <span style={{ fontWeight: 700, fontSize: 13, color: '#374151' }}>{p.plan_id?.toUpperCase()}</span>
              <span style={{ fontSize: 11, color: '#6b7280' }}>{p.count} tenants</span>
            </div>
          ))}
        </div>
      </section>

      {/* Solicitudes pendientes */}
      <section style={s.card}>
        <h2 style={s.cardTitle}>Solicitudes de cambio de plan</h2>
        {requests.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: 13 }}>No hay solicitudes pendientes.</p>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>{['Tenant', 'Dirección', 'Plan solicitado', 'Fecha', 'Acciones'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} style={s.tr}>
                  <td style={s.td}>{r.email ?? r.user_id}</td>
                  <td style={s.td}><span style={{ ...s.badge, background: r.direction === 'upgrade' ? '#d1fae5' : '#fee2e2', color: r.direction === 'upgrade' ? '#065f46' : '#991b1b' }}>{r.direction}</span></td>
                  <td style={s.td}>{r.requested_plan}</td>
                  <td style={s.td}>{new Date(r.created_at).toLocaleDateString('es-AR')}</td>
                  <td style={s.td}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => handleRequest(r.id, 'approve')} style={s.btnApprove}>✓ Aprobar</button>
                      <button onClick={() => handleRequest(r.id, 'reject')}  style={s.btnReject}>✗ Rechazar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Actividad reciente — últimos 10 usuarios registrados */}
      <section style={s.card}>
        <h2 style={s.cardTitle}>Actividad reciente — últimos registros</h2>
        <table style={s.table}>
          <thead>
            <tr>{['Tenant', 'Plan', 'Publicaciones', 'Storage', 'Registrado'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {users.slice(0, 10).map((u) => (
              <tr key={u.id} style={s.tr}>
                <td style={s.td}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{u.name || '—'}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{u.email}</div>
                </td>
                <td style={s.td}><span style={s.planBadge}>{u.plan_id}</span></td>
                <td style={{ ...s.td, textAlign: 'center' }}>{u.pub_count}</td>
                <td style={s.td}>{((u.total_bytes ?? 0) / 1024 / 1024).toFixed(1)} MB</td>
                <td style={s.td}>{new Date(u.created_at).toLocaleDateString('es-AR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page:       { padding: '2rem 1.5rem', maxWidth: 1100, margin: '0 auto' },
  header:     { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' },
  h1:         { fontSize: '1.5rem', fontWeight: 800, color: '#111827', margin: 0 },
  sub:        { color: '#6b7280', fontSize: 13, margin: '4px 0 0' },
  refreshBtn: { background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 13, color: '#374151' },
  toast:      { position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', background: '#1f2937', color: '#fff', padding: '8px 20px', borderRadius: 8, fontSize: 13, zIndex: 200 },
  kpiGrid:    { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' },
  kpi:        { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' },
  card:       { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '1.25rem', marginBottom: '1.25rem' },
  cardTitle:  { fontSize: 15, fontWeight: 700, color: '#111827', margin: '0 0 1rem' },
  planChip:   { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 100 },
  table:      { width: '100%', borderCollapse: 'collapse' as const },
  th:         { padding: '8px 10px', textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: '#6b7280', borderBottom: '1px solid #f3f4f6', background: '#fafafa' },
  tr:         { borderBottom: '1px solid #f9fafb' },
  td:         { padding: '10px 10px', fontSize: 13, verticalAlign: 'middle' as const },
  badge:      { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10 },
  planBadge:  { fontSize: 11, fontWeight: 700, background: '#e0e7ff', color: '#4338ca', padding: '2px 8px', borderRadius: 10 },
  btnApprove: { background: '#d1fae5', color: '#065f46', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  btnReject:  { background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
}
