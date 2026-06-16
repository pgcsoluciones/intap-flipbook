import { useEffect, useState } from 'react'
import { API_BASE } from '../lib/api'

function authHeaders() {
  const token = localStorage.getItem('token')
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}/admin${path}`, { ...init, headers: { ...authHeaders(), ...(init.headers ?? {}) } })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data
}

const PLANS = ['free', 'basic', 'pro']

function fmtMb(bytes: number) { return (bytes / 1024 / 1024).toFixed(1) + ' MB' }
function fmtDate(d: string)   { return new Date(d).toLocaleDateString('es-AR') }

export default function AdminPanel() {
  const [stats, setStats]   = useState<any>(null)
  const [users, setUsers]   = useState<any[]>([])
  const [loading, setLoad]  = useState(true)
  const [error, setError]   = useState('')
  const [search, setSearch] = useState('')
  const [tab, setTab]       = useState<'users' | 'stats'>('stats')
  const [msg, setMsg]       = useState('')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoad(true)
    try {
      const [s, u] = await Promise.all([
        adminFetch<any>('/stats'),
        adminFetch<any>('/users'),
      ])
      setStats(s.data)
      setUsers(u.data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoad(false)
    }
  }

  async function changePlan(userId: string, planId: string) {
    try {
      await adminFetch(`/users/${userId}/plan`, {
        method: 'PUT',
        body: JSON.stringify({ plan_id: planId }),
      })
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, plan_id: planId } : u))
      flash('Plan actualizado.')
    } catch (e: any) { flash(e.message) }
  }

  async function deleteUser(userId: string, email: string) {
    if (!confirm(`¿Eliminar usuario ${email} y todos sus datos? Esta acción es irreversible.`)) return
    try {
      await adminFetch(`/users/${userId}`, { method: 'DELETE' })
      setUsers((prev) => prev.filter((u) => u.id !== userId))
      flash('Usuario eliminado.')
    } catch (e: any) { flash(e.message) }
  }

  function flash(text: string) {
    setMsg(text)
    setTimeout(() => setMsg(''), 3000)
  }

  const filtered = users.filter((u) =>
    !search || u.email.includes(search) || (u.name ?? '').toLowerCase().includes(search.toLowerCase())
  )

  if (loading) return <div style={{ padding: '3rem', color: '#666' }}>Cargando panel admin...</div>
  if (error)   return <div style={{ padding: '3rem', color: '#dc2626' }}>Error: {error}</div>

  return (
    <div style={styles.page}>
      <div style={styles.titleRow}>
        <div>
          <h1 style={styles.h1}>Super Admin</h1>
          <p style={styles.subtitle}>Panel de administración de usuarios y estadísticas globales.</p>
        </div>
        <button onClick={loadData} style={styles.btnSecondary}>↻ Actualizar</button>
      </div>

      {msg && <div style={styles.toast}>{msg}</div>}

      {/* Tabs */}
      <div style={styles.tabBar}>
        <button onClick={() => setTab('stats')} style={{ ...styles.tab, ...(tab === 'stats' ? styles.tabActive : {}) }}>Estadísticas</button>
        <button onClick={() => setTab('users')} style={{ ...styles.tab, ...(tab === 'users' ? styles.tabActive : {}) }}>
          Usuarios ({users.length})
        </button>
      </div>

      {/* Stats tab */}
      {tab === 'stats' && stats && (
        <div>
          <div style={styles.statGrid}>
            <StatCard icon="👥" label="Usuarios"       value={stats.users} />
            <StatCard icon="📚" label="Publicaciones"  value={stats.publications} />
            <StatCard icon="📄" label="Páginas"        value={stats.pages} />
            <StatCard icon="💾" label="Almacenamiento" value={`${stats.storage_mb} MB`} />
          </div>

          <section style={styles.card}>
            <h2 style={styles.sectionTitle}>Distribución por plan</h2>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              {(stats.by_plan ?? []).map((p: any) => (
                <div key={p.plan_id} style={styles.planStat}>
                  <span style={styles.planStatName}>{p.plan_id?.toUpperCase()}</span>
                  <span style={styles.planStatCount}>{p.count} usuarios</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Users tab */}
      {tab === 'users' && (
        <div>
          <input
            style={styles.searchInput}
            placeholder="Buscar por email o nombre..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {['Usuario', 'Plan', 'Publicaciones', 'Almacenamiento', 'Registrado', 'Admin', 'Acciones'].map((h) => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} style={styles.tr}>
                    <td style={styles.td}>
                      <div style={{ fontWeight: 600, color: '#111827', fontSize: '0.875rem' }}>{u.name || '—'}</div>
                      <div style={{ color: '#6b7280', fontSize: '0.8rem' }}>{u.email}</div>
                    </td>
                    <td style={styles.td}>
                      <select
                        value={u.plan_id}
                        onChange={(e) => changePlan(u.id, e.target.value)}
                        style={styles.planSelect}
                      >
                        {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td style={{ ...styles.td, textAlign: 'center' }}>{u.pub_count}</td>
                    <td style={styles.td}>{fmtMb(u.total_bytes)}</td>
                    <td style={styles.td}>{fmtDate(u.created_at)}</td>
                    <td style={{ ...styles.td, textAlign: 'center' }}>
                      {u.is_admin ? <span style={styles.adminBadge}>Admin</span> : '—'}
                    </td>
                    <td style={styles.td}>
                      <button
                        onClick={() => deleteUser(u.id, u.email)}
                        style={styles.btnDanger}
                        title="Eliminar usuario"
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: '#9ca3af' }}>Sin resultados</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ icon, label, value }: { icon: string; label: string; value: string | number }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: '1.25rem', border: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: '1rem' }}>
      <span style={{ fontSize: '2rem' }}>{icon}</span>
      <div>
        <p style={{ margin: 0, fontSize: '0.8rem', color: '#6b7280' }}>{label}</p>
        <p style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, color: '#111827' }}>{value}</p>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page:         { padding: '2rem 1.5rem', fontFamily: 'Inter, system-ui, sans-serif' },
  titleRow:     { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem' },
  h1:           { fontSize: '1.5rem', fontWeight: 800, color: '#111827', margin: '0 0 0.25rem' },
  subtitle:     { color: '#6b7280', fontSize: '0.9rem', margin: 0 },
  toast:        { position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', background: '#1f2937', color: '#fff', padding: '0.6rem 1.25rem', borderRadius: 8, fontSize: '0.875rem', zIndex: 100 },
  tabBar:       { display: 'flex', gap: 0, borderBottom: '1px solid #e5e7eb', marginBottom: '1.5rem' },
  tab:          { background: 'none', border: 'none', borderBottom: '2px solid transparent', padding: '0.6rem 1.25rem', fontSize: '0.9rem', color: '#6b7280', cursor: 'pointer' },
  tabActive:    { color: '#4f46e5', borderBottom: '2px solid #4f46e5', fontWeight: 600 },
  statGrid:     { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' },
  card:         { background: '#fff', borderRadius: 12, padding: '1.5rem', border: '1px solid #e5e7eb', marginBottom: '1rem' },
  sectionTitle: { fontSize: '0.95rem', fontWeight: 700, color: '#111827', margin: '0 0 1rem' },
  planStat:     { background: '#f3f4f6', borderRadius: 8, padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: 2 },
  planStatName: { fontWeight: 700, color: '#374151', fontSize: '0.9rem' },
  planStatCount:{ color: '#6b7280', fontSize: '0.8rem' },
  searchInput:  { width: '100%', maxWidth: 360, border: '1px solid #d1d5db', borderRadius: 8, padding: '0.5rem 0.75rem', fontSize: '0.9rem', marginBottom: '1rem', boxSizing: 'border-box', outline: 'none' },
  tableWrap:    { background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'auto' },
  table:        { width: '100%', borderCollapse: 'collapse', minWidth: 700 },
  th:           { padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.8rem', fontWeight: 600, color: '#6b7280', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' },
  tr:           { borderBottom: '1px solid #f3f4f6' },
  td:           { padding: '0.75rem 1rem', verticalAlign: 'middle', fontSize: '0.875rem' },
  planSelect:   { border: '1px solid #d1d5db', borderRadius: 6, padding: '0.25rem 0.5rem', fontSize: '0.8rem', cursor: 'pointer', background: '#fff' },
  adminBadge:   { background: '#7c3aed', color: '#fff', fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 10 },
  btnSecondary: { background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, padding: '0.5rem 1rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem', color: '#374151' },
  btnDanger:    { background: '#fee2e2', border: 'none', borderRadius: 6, padding: '0.3rem 0.6rem', cursor: 'pointer', fontSize: '1rem' },
}
