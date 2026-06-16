import { useEffect, useState } from 'react'
import { API_BASE } from '../../lib/api'

function authH() {
  const t = localStorage.getItem('token')
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

type ReferralConfig = {
  active: boolean
  reward_type: 'dias_gratis' | 'descuento_%'
  reward_value: number
  condition: 'solo_registro' | 'plan_pagado'
}

type Referral = {
  id: number
  referrer_email: string
  referred_email: string
  created_at: string
  status: 'pendiente' | 'aprobado' | 'rechazado'
  reward_applied: boolean
}

function statusBadge(status: string) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    pendiente:  { bg: '#fef3c7', color: '#92400e', label: 'Pendiente' },
    aprobado:   { bg: '#d1fae5', color: '#065f46', label: 'Aprobado' },
    rechazado:  { bg: '#fee2e2', color: '#991b1b', label: 'Rechazado' },
  }
  const style = map[status] ?? map.pendiente
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: style.bg, color: style.color }}>
      {style.label}
    </span>
  )
}

function exportCSV(referrals: Referral[]) {
  const headers = ['ID', 'Referidor', 'Referido', 'Fecha', 'Estado', 'Recompensa aplicada']
  const rows = referrals.map((r) => [
    r.id,
    r.referrer_email,
    r.referred_email,
    new Date(r.created_at).toLocaleDateString('es-AR'),
    r.status,
    r.reward_applied ? 'Sí' : 'No',
  ])
  const csv = [headers, ...rows].map((row) => row.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `referidos-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function AdminReferrals() {
  const [config, setConfig]       = useState<ReferralConfig | null>(null)
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [loading, setLoading]     = useState(true)
  const [msg, setMsg]             = useState('')
  const [savingConfig, setSavingConfig] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [cr, rr] = await Promise.all([
        fetch(`${API_BASE}/admin/referral-config`, { headers: authH() }),
        fetch(`${API_BASE}/admin/referrals`, { headers: authH() }),
      ])
      const cd = await cr.json()
      const rd = await rr.json()
      if (!cr.ok) throw new Error(cd.error ?? `HTTP ${cr.status}`)
      if (!rr.ok) throw new Error(rd.error ?? `HTTP ${rr.status}`)
      setConfig(cd.data)
      setReferrals(rd.data ?? [])
    } catch (e: any) { flash(e.message) }
    finally { setLoading(false) }
  }

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault()
    if (!config) return
    setSavingConfig(true)
    try {
      const r = await fetch(`${API_BASE}/admin/referral-config`, {
        method: 'PUT',
        headers: authH(),
        body: JSON.stringify(config),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
      flash('Configuración guardada.')
    } catch (e: any) { flash(e.message) }
    finally { setSavingConfig(false) }
  }

  async function handleApprove(id: number) {
    try {
      const r = await fetch(`${API_BASE}/admin/referrals/${id}/approve`, {
        method: 'PUT',
        headers: authH(),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
      flash('Referido aprobado.')
      load()
    } catch (e: any) { flash(e.message) }
  }

  async function handleReject(id: number) {
    const motivo = prompt('Motivo de rechazo (opcional):') ?? ''
    try {
      const r = await fetch(`${API_BASE}/admin/referrals/${id}/reject`, {
        method: 'PUT',
        headers: authH(),
        body: JSON.stringify({ reason: motivo }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
      flash('Referido rechazado.')
      load()
    } catch (e: any) { flash(e.message) }
  }

  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(''), 3500) }

  if (loading) return <div style={{ padding: '3rem', color: '#666' }}>Cargando...</div>

  return (
    <div style={s.page}>
      {msg && <div style={s.toast}>{msg}</div>}

      <div style={s.header}>
        <div>
          <h1 style={s.h1}>Programa de referidos</h1>
          <p style={s.sub}>Configura recompensas y gestiona los referidos registrados</p>
        </div>
      </div>

      {/* Configuración global */}
      {config && (
        <section style={s.card}>
          <h2 style={s.cardTitle}>Configuración global del programa</h2>
          <form onSubmit={saveConfig} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label style={s.toggleRow}>
              <span style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>Programa activo</span>
              <div
                onClick={() => setConfig({ ...config, active: !config.active })}
                style={{
                  ...s.toggle,
                  background: config.active ? '#4f46e5' : '#d1d5db',
                }}
              >
                <div style={{ ...s.toggleKnob, transform: config.active ? 'translateX(20px)' : 'translateX(2px)' }} />
              </div>
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <label style={s.label}>
                Tipo de recompensa
                <select
                  style={s.input}
                  value={config.reward_type}
                  onChange={(e) => setConfig({ ...config, reward_type: e.target.value as ReferralConfig['reward_type'] })}
                >
                  <option value="dias_gratis">Días gratis</option>
                  <option value="descuento_%">Descuento %</option>
                </select>
              </label>

              <label style={s.label}>
                Valor {config.reward_type === 'descuento_%' ? '(%)' : '(días)'}
                <input
                  style={s.input}
                  type="number"
                  min={1}
                  value={config.reward_value}
                  onChange={(e) => setConfig({ ...config, reward_value: Number(e.target.value) })}
                />
              </label>

              <label style={s.label}>
                Condición de activación
                <select
                  style={s.input}
                  value={config.condition}
                  onChange={(e) => setConfig({ ...config, condition: e.target.value as ReferralConfig['condition'] })}
                >
                  <option value="solo_registro">Solo registro</option>
                  <option value="plan_pagado">Plan pagado activado</option>
                </select>
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" disabled={savingConfig} style={s.primaryBtn}>
                {savingConfig ? 'Guardando...' : 'Guardar configuración'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Tabla de referidos */}
      <section style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ ...s.cardTitle, margin: 0 }}>Referidos registrados</h2>
          <button onClick={() => exportCSV(referrals)} style={s.secondaryBtn}>
            ↓ Exportar CSV
          </button>
        </div>

        {referrals.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: 13 }}>No hay referidos registrados.</p>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                {['Referidor', 'Referido', 'Fecha', 'Estado', 'Recompensa aplicada', 'Acciones'].map((h) => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {referrals.map((r) => (
                <tr key={r.id} style={s.tr}>
                  <td style={s.td}>{r.referrer_email}</td>
                  <td style={s.td}>{r.referred_email}</td>
                  <td style={s.td}>{new Date(r.created_at).toLocaleDateString('es-AR')}</td>
                  <td style={s.td}>{statusBadge(r.status)}</td>
                  <td style={{ ...s.td, textAlign: 'center' as const }}>
                    {r.reward_applied ? (
                      <span style={{ color: '#065f46', fontWeight: 600, fontSize: 13 }}>✓ Sí</span>
                    ) : (
                      <span style={{ color: '#9ca3af', fontSize: 13 }}>No</span>
                    )}
                  </td>
                  <td style={s.td}>
                    {r.status === 'pendiente' && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => handleApprove(r.id)} style={s.btnApprove}>✓ Aprobar</button>
                        <button onClick={() => handleReject(r.id)} style={s.btnReject}>✗ Rechazar</button>
                      </div>
                    )}
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
  toast:       { position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', background: '#1f2937', color: '#fff', padding: '8px 20px', borderRadius: 8, fontSize: 13, zIndex: 200 },
  card:        { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '1.25rem', marginBottom: '1rem' },
  cardTitle:   { fontSize: 15, fontWeight: 700, color: '#111827', margin: '0 0 1rem' },
  table:       { width: '100%', borderCollapse: 'collapse' as const },
  th:          { padding: '8px 10px', textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: '#6b7280', borderBottom: '1px solid #f3f4f6', background: '#fafafa' },
  tr:          { borderBottom: '1px solid #f9fafb' },
  td:          { padding: '10px 10px', fontSize: 13, verticalAlign: 'middle' as const },
  label:       { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: 13, fontWeight: 500, color: '#374151' },
  input:       { border: '1px solid #d1d5db', borderRadius: 7, padding: '7px 10px', fontSize: 13, color: '#111827', outline: 'none', fontFamily: 'inherit' },
  toggleRow:   { display: 'flex', alignItems: 'center', gap: 12 },
  toggle:      { width: 42, height: 24, borderRadius: 12, cursor: 'pointer', position: 'relative' as const, transition: 'background .2s', flexShrink: 0 },
  toggleKnob:  { position: 'absolute' as const, top: 2, width: 20, height: 20, background: '#fff', borderRadius: '50%', transition: 'transform .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' },
  primaryBtn:  { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  secondaryBtn:{ background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 13 },
  btnApprove:  { background: '#d1fae5', color: '#065f46', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  btnReject:   { background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
}
