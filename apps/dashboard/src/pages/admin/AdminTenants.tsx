import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE } from '../../lib/api'

function authH() {
  const t = localStorage.getItem('token')
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}
async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${API_BASE}/admin${path}`, { ...init, headers: { ...authH(), ...(init.headers ?? {}) } })
  const d = await r.json()
  if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
  return d
}

const STATUS_COLORS: Record<string, string> = {
  active:     '#d1fae5',
  degraded:   '#fef3c7',
  suspended:  '#fee2e2',
}
const STATUS_TEXT: Record<string, string> = {
  active:    '#065f46',
  degraded:  '#92400e',
  suspended: '#991b1b',
}

export default function AdminTenants() {
  const [users, setUsers]   = useState<any[]>([])
  const [loading, setLoad]  = useState(true)
  const [search, setSearch] = useState('')
  const [planF, setPlanF]   = useState('')
  const [msg, setMsg]       = useState('')

  useEffect(() => { adminFetch<any>('/users').then((r) => setUsers(r.data)).finally(() => setLoad(false)) }, [])

  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(''), 3000) }

  async function changePlan(id: string, plan: string) {
    await adminFetch(`/users/${id}/plan`, { method: 'PUT', body: JSON.stringify({ plan_id: plan }) })
    setUsers((prev) => prev.map((u) => u.id === id ? { ...u, plan_id: plan } : u))
    flash('Plan actualizado.')
  }

  async function deleteUser(id: string, email: string) {
    if (!confirm(`¿Eliminar tenant ${email}? Esta acción es irreversible.`)) return
    await adminFetch(`/users/${id}`, { method: 'DELETE' })
    setUsers((prev) => prev.filter((u) => u.id !== id))
    flash('Tenant eliminado.')
  }

  const filtered = users.filter((u) => {
    const matchSearch = !search || u.email?.includes(search) || (u.name ?? '').toLowerCase().includes(search.toLowerCase())
    const matchPlan = !planF || u.plan_id === planF
    return matchSearch && matchPlan
  })

  if (loading) return <div style={{ padding: '3rem', color: '#666' }}>Cargando...</div>

  return (
    <div style={s.page}>
      {msg && <div style={s.toast}>{msg}</div>}

      <div style={s.header}>
        <div>
          <h1 style={s.h1}>Tenants</h1>
          <p style={s.sub}>{users.length} clientes registrados</p>
        </div>
      </div>

      {/* Filtros */}
      <div style={s.filters}>
        <input style={s.searchInput} placeholder="Buscar por email o nombre..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select style={s.select} value={planF} onChange={(e) => setPlanF(e.target.value)}>
          <option value="">Todos los planes</option>
          <option value="free">Free</option>
          <option value="basic">Basic</option>
          <option value="pro">Pro</option>
        </select>
      </div>

      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>{['Tenant', 'Plan', 'Estado', 'Publicaciones', 'Storage', 'Registrado', 'Acciones'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} style={s.tr}>
                <td style={s.td}>
                  <Link to={`/admin/tenants/${u.id}`} style={{ textDecoration: 'none' }}>
                    <div style={{ fontWeight: 600, color: '#4f46e5', fontSize: 13 }}>{u.name || '(sin nombre)'}</div>
                    <div style={{ fontSize: 11, color: '#6b7280' }}>{u.email}</div>
                  </Link>
                </td>
                <td style={s.td}>
                  <select value={u.plan_id} onChange={(e) => changePlan(u.id, e.target.value)} style={s.planSelect}>
                    {['free','basic','pro'].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </td>
                <td style={s.td}>
                  <span style={{ ...s.statusBadge, background: STATUS_COLORS[u.status ?? 'active'], color: STATUS_TEXT[u.status ?? 'active'] }}>
                    {u.status ?? 'active'}
                  </span>
                </td>
                <td style={{ ...s.td, textAlign: 'center' }}>{u.pub_count}</td>
                <td style={s.td}>{((u.total_bytes ?? 0) / 1024 / 1024).toFixed(1)} MB</td>
                <td style={s.td}>{new Date(u.created_at).toLocaleDateString('es-AR')}</td>
                <td style={s.td}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Link to={`/admin/tenants/${u.id}`} style={s.btnView}>Ver</Link>
                    <button onClick={() => deleteUser(u.id, u.email)} style={s.btnDel}>🗑</button>
                  </div>
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
  )
}

const s: Record<string, React.CSSProperties> = {
  page:        { padding: '2rem 1.5rem' },
  header:      { marginBottom: '1.25rem' },
  h1:          { fontSize: '1.5rem', fontWeight: 800, color: '#111827', margin: 0 },
  sub:         { color: '#6b7280', fontSize: 13, margin: '4px 0 0' },
  toast:       { position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', background: '#1f2937', color: '#fff', padding: '8px 20px', borderRadius: 8, fontSize: 13, zIndex: 200 },
  filters:     { display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' as const },
  searchInput: { border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 13, flex: 1, minWidth: 200, outline: 'none' },
  select:      { border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 13, background: '#fff', cursor: 'pointer', outline: 'none' },
  tableWrap:   { background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'auto' },
  table:       { width: '100%', borderCollapse: 'collapse' as const, minWidth: 700 },
  th:          { padding: '10px 12px', textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: '#6b7280', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' },
  tr:          { borderBottom: '1px solid #f9fafb' },
  td:          { padding: '10px 12px', fontSize: 13, verticalAlign: 'middle' as const },
  planSelect:  { border: '1px solid #d1d5db', borderRadius: 6, padding: '3px 8px', fontSize: 12, cursor: 'pointer', background: '#fff' },
  statusBadge: { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10 },
  btnView:     { background: '#e0e7ff', color: '#4338ca', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-block' },
  btnDel:      { background: '#fee2e2', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 13 },
}
