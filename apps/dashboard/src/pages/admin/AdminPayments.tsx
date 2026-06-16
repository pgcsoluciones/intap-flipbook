import { useEffect, useState } from 'react'
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

type Payment = {
  id: string
  tenant_email: string
  tenant_name?: string
  amount: number
  currency: 'USD' | 'DOP'
  method: 'transfer' | 'deposit' | 'paypal' | 'readdy' | 'other'
  plan_paid: 'free' | 'basic' | 'pro'
  status: 'paid' | 'pending' | 'expired' | 'refunded'
  reference?: string
  notes?: string
  created_at: string
}

type User = { id: string; email: string; name?: string }

const METHOD_LABELS: Record<string, string> = {
  transfer: 'Transferencia bancaria',
  deposit:  'Depósito en efectivo',
  paypal:   'PayPal',
  readdy:   'Readdy',
  other:    'Otro',
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  paid:     { bg: '#d1fae5', text: '#065f46' },
  pending:  { bg: '#fef3c7', text: '#92400e' },
  expired:  { bg: '#ffedd5', text: '#9a3412' },
  refunded: { bg: '#f3f4f6', text: '#4b5563' },
}

const EMPTY_FORM = {
  tenant_id:  '',
  tenant_email: '',
  plan_paid:  'basic',
  amount:     '',
  currency:   'USD',
  method:     'transfer',
  reference:  '',
  notes:      '',
}

export default function AdminPayments() {
  const [payments, setPayments] = useState<Payment[]>([])
  const [users, setUsers]       = useState<User[]>([])
  const [loading, setLoading]   = useState(true)
  const [msg, setMsg]           = useState('')
  const [error, setError]       = useState('')

  // Filtros
  const [filterMethod, setFilterMethod] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterEmail, setFilterEmail]   = useState('')

  // Modal
  const [showModal, setShowModal]     = useState(false)
  const [saving, setSaving]           = useState(false)
  const [form, setForm]               = useState({ ...EMPTY_FORM })
  const [userSearch, setUserSearch]   = useState('')

  useEffect(() => {
    Promise.all([
      adminFetch<{ data: Payment[] }>('/payments'),
      adminFetch<{ data: User[] }>('/users'),
    ])
      .then(([p, u]) => { setPayments(p.data); setUsers(u.data) })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(''), 3000) }

  const filtered = payments.filter((p) => {
    const mMatch = !filterMethod || p.method === filterMethod
    const sMatch = !filterStatus || p.status === filterStatus
    const eMatch = !filterEmail  || p.tenant_email.toLowerCase().includes(filterEmail.toLowerCase())
    return mMatch && sMatch && eMatch
  })

  const matchedUsers = users.filter((u) =>
    !userSearch ||
    u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
    (u.name ?? '').toLowerCase().includes(userSearch.toLowerCase())
  ).slice(0, 8)

  function selectUser(u: User) {
    setForm((f) => ({ ...f, tenant_id: u.id, tenant_email: u.email }))
    setUserSearch(u.email)
  }

  async function handleSave() {
    if (!form.tenant_id) { setError('Selecciona un tenant.'); return }
    if (!form.amount || isNaN(Number(form.amount))) { setError('Monto inválido.'); return }
    setSaving(true)
    setError('')
    try {
      const res = await adminFetch<{ data: Payment }>('/payments', {
        method: 'POST',
        body: JSON.stringify({
          tenant_id: form.tenant_id,
          plan_paid: form.plan_paid,
          amount:    Number(form.amount),
          currency:  form.currency,
          method:    form.method,
          reference: form.reference || null,
          notes:     form.notes || null,
        }),
      })
      setPayments((prev) => [res.data, ...prev])
      setShowModal(false)
      setForm({ ...EMPTY_FORM })
      setUserSearch('')
      flash('Pago registrado correctamente.')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function exportCSV() {
    const cols = ['Tenant', 'Monto', 'Moneda', 'Método', 'Plan', 'Estado', 'Fecha', 'Referencia', 'Notas']
    const rows = filtered.map((p) => [
      p.tenant_email,
      p.amount,
      p.currency,
      METHOD_LABELS[p.method] ?? p.method,
      p.plan_paid,
      p.status,
      new Date(p.created_at).toLocaleDateString('es-AR'),
      p.reference ?? '',
      (p.notes ?? '').replace(/\n/g, ' '),
    ])
    const csv = [cols, ...rows].map((r) => r.map((v) => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `pagos-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <div style={{ padding: '3rem', color: '#666' }}>Cargando...</div>

  return (
    <div style={s.page}>
      {msg   && <div style={s.toast}>{msg}</div>}

      {/* Encabezado */}
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>Pagos</h1>
          <p style={s.sub}>{payments.length} registros totales</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={exportCSV} style={s.btnSecondary}>Exportar CSV</button>
          <button onClick={() => { setShowModal(true); setError('') }} style={s.btnPrimary}>+ Registrar pago manual</button>
        </div>
      </div>

      {error && <div style={s.errBanner}>{error}</div>}

      {/* Filtros */}
      <div style={s.filters}>
        <input
          style={s.input}
          placeholder="Buscar por email de tenant..."
          value={filterEmail}
          onChange={(e) => setFilterEmail(e.target.value)}
        />
        <select style={s.select} value={filterMethod} onChange={(e) => setFilterMethod(e.target.value)}>
          <option value="">Todos los métodos</option>
          {Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select style={s.select} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="paid">Pagado</option>
          <option value="pending">Pendiente</option>
          <option value="expired">Vencido</option>
          <option value="refunded">Reembolsado</option>
        </select>
      </div>

      {/* Tabla */}
      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              {['Tenant', 'Monto', 'Método', 'Plan', 'Estado', 'Fecha', 'Referencia', 'Notas'].map((h) => (
                <th key={h} style={s.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const sc = STATUS_COLORS[p.status] ?? { bg: '#f3f4f6', text: '#374151' }
              return (
                <tr key={p.id} style={s.tr}>
                  <td style={s.td}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{p.tenant_name || p.tenant_email}</div>
                    {p.tenant_name && <div style={{ fontSize: 11, color: '#6b7280' }}>{p.tenant_email}</div>}
                  </td>
                  <td style={s.td}>
                    <span style={{ fontWeight: 600 }}>{p.currency} {Number(p.amount).toFixed(2)}</span>
                  </td>
                  <td style={s.td}>{METHOD_LABELS[p.method] ?? p.method}</td>
                  <td style={s.td}>
                    <span style={{ ...s.planBadge, ...PLAN_COLORS[p.plan_paid] }}>{p.plan_paid}</span>
                  </td>
                  <td style={s.td}>
                    <span style={{ ...s.badge, background: sc.bg, color: sc.text }}>{p.status}</span>
                  </td>
                  <td style={s.td}>{new Date(p.created_at).toLocaleDateString('es-AR')}</td>
                  <td style={s.td}><span style={{ fontSize: 12, color: '#6b7280' }}>{p.reference || '—'}</span></td>
                  <td style={{ ...s.td, maxWidth: 180 }}>
                    <span style={{ fontSize: 12, color: '#6b7280', display: 'block', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      {p.notes || '—'}
                    </span>
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: '#9ca3af' }}>Sin resultados</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div style={s.overlay} onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div style={s.modal}>
            <h2 style={s.modalTitle}>Registrar pago manual</h2>

            {error && <div style={s.errBanner}>{error}</div>}

            {/* Buscar tenant */}
            <label style={s.label}>Tenant *</label>
            <div style={{ position: 'relative' }}>
              <input
                style={s.input}
                placeholder="Buscar por email o nombre..."
                value={userSearch}
                onChange={(e) => { setUserSearch(e.target.value); setForm((f) => ({ ...f, tenant_id: '', tenant_email: '' })) }}
              />
              {userSearch && !form.tenant_id && matchedUsers.length > 0 && (
                <div style={s.dropdown}>
                  {matchedUsers.map((u) => (
                    <div key={u.id} style={s.dropdownItem} onClick={() => selectUser(u)}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{u.name || u.email}</div>
                      {u.name && <div style={{ fontSize: 11, color: '#9ca3af' }}>{u.email}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {form.tenant_id && (
              <div style={{ fontSize: 12, color: '#4f46e5', marginTop: 4 }}>Tenant seleccionado: {form.tenant_email}</div>
            )}

            {/* Plan */}
            <label style={s.label}>Plan pagado *</label>
            <select style={s.input} value={form.plan_paid} onChange={(e) => setForm((f) => ({ ...f, plan_paid: e.target.value }))}>
              <option value="free">Free</option>
              <option value="basic">Basic</option>
              <option value="pro">Pro</option>
            </select>

            {/* Monto y Moneda */}
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 2 }}>
                <label style={s.label}>Monto *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  style={s.input}
                  placeholder="0.00"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={s.label}>Moneda</label>
                <select style={s.input} value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}>
                  <option value="USD">USD</option>
                  <option value="DOP">DOP</option>
                </select>
              </div>
            </div>

            {/* Método */}
            <label style={s.label}>Método de pago</label>
            <select style={s.input} value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}>
              {Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>

            {/* Referencia */}
            <label style={s.label}>Referencia</label>
            <input
              style={s.input}
              placeholder="Número de transacción, comprobante..."
              value={form.reference}
              onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
            />

            {/* Notas */}
            <label style={s.label}>Notas</label>
            <textarea
              style={{ ...s.input, minHeight: 80, resize: 'vertical' as const }}
              placeholder="Observaciones adicionales..."
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />

            <div style={{ display: 'flex', gap: 10, marginTop: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowModal(false); setError(''); setForm({ ...EMPTY_FORM }); setUserSearch('') }} style={s.btnSecondary}>
                Cancelar
              </button>
              <button onClick={handleSave} disabled={saving} style={{ ...s.btnPrimary, opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Guardando...' : 'Registrar pago'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const PLAN_COLORS: Record<string, React.CSSProperties> = {
  free:  { background: '#f3f4f6', color: '#374151' },
  basic: { background: '#dbeafe', color: '#1e40af' },
  pro:   { background: '#ede9fe', color: '#5b21b6' },
}

const s: Record<string, React.CSSProperties> = {
  page:        { padding: '2rem 1.5rem', background: '#f8fafc', minHeight: '100vh' },
  header:      { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' },
  h1:          { fontSize: '1.5rem', fontWeight: 800, color: '#111827', margin: 0 },
  sub:         { color: '#6b7280', fontSize: 13, margin: '4px 0 0' },
  toast:       { position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', background: '#1f2937', color: '#fff', padding: '8px 20px', borderRadius: 8, fontSize: 13, zIndex: 200 },
  errBanner:   { background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 12 },
  filters:     { display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' as const },
  input:       { border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 13, width: '100%', outline: 'none', boxSizing: 'border-box' as const, background: '#fff' },
  select:      { border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 13, background: '#fff', cursor: 'pointer', outline: 'none' },
  tableWrap:   { background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'auto' },
  table:       { width: '100%', borderCollapse: 'collapse' as const, minWidth: 900 },
  th:          { padding: '10px 12px', textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: '#6b7280', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' },
  tr:          { borderBottom: '1px solid #f9fafb' },
  td:          { padding: '10px 12px', fontSize: 13, verticalAlign: 'middle' as const },
  badge:       { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, display: 'inline-block' },
  planBadge:   { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, display: 'inline-block', textTransform: 'uppercase' as const },
  btnPrimary:  { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btnSecondary:{ background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  overlay:     { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1rem' },
  modal:       { background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '2rem', width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' as const },
  modalTitle:  { fontSize: '1.125rem', fontWeight: 800, color: '#111827', margin: '0 0 1.25rem' },
  label:       { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4, marginTop: 12 },
  dropdown:    { position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 50, maxHeight: 220, overflowY: 'auto' as const },
  dropdownItem:{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f3f4f6' },
}
