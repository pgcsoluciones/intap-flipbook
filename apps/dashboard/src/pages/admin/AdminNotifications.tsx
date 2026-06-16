import { useEffect, useState } from 'react'
import { API_BASE } from '../../lib/api'

function authH() {
  const t = localStorage.getItem('token')
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

type NotificationRecord = {
  id: number
  recipient: string
  channel: string
  subject: string
  status: 'enviado' | 'programado' | 'fallido'
  sent_at: string | null
  scheduled_at: string | null
}

const RECIPIENT_OPTIONS = [
  { value: 'all',   label: 'Todos los tenants' },
  { value: 'free',  label: 'Solo plan Free' },
  { value: 'basic', label: 'Solo plan Basic' },
  { value: 'pro',   label: 'Solo plan Pro' },
  { value: 'specific', label: 'Tenant específico' },
]

function statusBadge(status: string) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    enviado:    { bg: '#d1fae5', color: '#065f46', label: 'Enviado' },
    programado: { bg: '#dbeafe', color: '#1e40af', label: 'Programado' },
    fallido:    { bg: '#fee2e2', color: '#991b1b', label: 'Fallido' },
  }
  const style = map[status] ?? { bg: '#f3f4f6', color: '#374151', label: status }
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: style.bg, color: style.color }}>
      {style.label}
    </span>
  )
}

const EMPTY_FORM = {
  recipient: 'all',
  specific_tenant: '',
  channel: 'in-app',
  subject: '',
  message: '',
  schedule: 'immediate' as 'immediate' | 'scheduled',
  scheduled_at: '',
}

export default function AdminNotifications() {
  const [history, setHistory]   = useState<NotificationRecord[]>([])
  const [loading, setLoading]   = useState(true)
  const [sending, setSending]   = useState(false)
  const [msg, setMsg]           = useState('')
  const [form, setForm]         = useState(EMPTY_FORM)

  useEffect(() => { loadHistory() }, [])

  async function loadHistory() {
    setLoading(true)
    try {
      const r = await fetch(`${API_BASE}/admin/notifications`, { headers: authH() })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
      setHistory(d.data ?? [])
    } catch (e: any) { flash(e.message) }
    finally { setLoading(false) }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    setSending(true)
    try {
      const payload = {
        recipient: form.recipient,
        ...(form.recipient === 'specific' ? { specific_tenant: form.specific_tenant } : {}),
        channel: form.channel,
        subject: form.subject,
        message: form.message,
        scheduled_at: form.schedule === 'scheduled' ? form.scheduled_at : null,
      }
      const r = await fetch(`${API_BASE}/admin/notifications`, {
        method: 'POST',
        headers: authH(),
        body: JSON.stringify(payload),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
      flash(form.schedule === 'immediate' ? 'Notificación enviada.' : 'Notificación programada.')
      setForm(EMPTY_FORM)
      loadHistory()
    } catch (e: any) { flash(e.message) }
    finally { setSending(false) }
  }

  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(''), 3500) }

  function recipientLabel(value: string) {
    return RECIPIENT_OPTIONS.find((o) => o.value === value)?.label ?? value
  }

  if (loading) return <div style={{ padding: '3rem', color: '#666' }}>Cargando...</div>

  return (
    <div style={s.page}>
      {msg && <div style={s.toast}>{msg}</div>}

      <div style={s.header}>
        <div>
          <h1 style={s.h1}>Notificaciones</h1>
          <p style={s.sub}>Envía mensajes in-app a tus tenants</p>
        </div>
      </div>

      {/* Formulario de envío */}
      <section style={s.card}>
        <h2 style={s.cardTitle}>Nueva notificación</h2>
        <form onSubmit={handleSend} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={s.labelText}>Destinatario *</label>
              <select
                style={s.input}
                value={form.recipient}
                onChange={(e) => setForm({ ...form, recipient: e.target.value, specific_tenant: '' })}
                required
              >
                {RECIPIENT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={s.labelText}>Canal *</label>
              <select
                style={s.input}
                value={form.channel}
                onChange={(e) => setForm({ ...form, channel: e.target.value })}
                required
              >
                <option value="in-app">In-app (banner en dashboard)</option>
                <option value="email" disabled>Email (próximamente)</option>
              </select>
            </div>
          </div>

          {form.recipient === 'specific' && (
            <label style={s.label}>
              Buscar tenant (email o ID)
              <input
                style={s.input}
                value={form.specific_tenant}
                onChange={(e) => setForm({ ...form, specific_tenant: e.target.value })}
                placeholder="usuario@ejemplo.com"
                required
              />
            </label>
          )}

          <label style={s.label}>
            Asunto *
            <input
              style={s.input}
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              placeholder="Ej: Nueva funcionalidad disponible"
              required
            />
          </label>

          <label style={s.label}>
            Mensaje *
            <textarea
              style={{ ...s.input, resize: 'vertical', minHeight: 96 }}
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              placeholder="Escribe el contenido del mensaje..."
              required
            />
          </label>

          {/* Programar envío */}
          <div style={s.label}>
            Programar envío
            <div style={{ display: 'flex', gap: 20, marginTop: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="schedule"
                  value="immediate"
                  checked={form.schedule === 'immediate'}
                  onChange={() => setForm({ ...form, schedule: 'immediate', scheduled_at: '' })}
                />
                Inmediato
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="schedule"
                  value="scheduled"
                  checked={form.schedule === 'scheduled'}
                  onChange={() => setForm({ ...form, schedule: 'scheduled' })}
                />
                Fecha y hora específica
              </label>
            </div>
          </div>

          {form.schedule === 'scheduled' && (
            <label style={s.label}>
              Fecha y hora de envío *
              <input
                style={s.input}
                type="datetime-local"
                value={form.scheduled_at}
                onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })}
                required
              />
            </label>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="submit" disabled={sending} style={s.primaryBtn}>
              {sending ? 'Enviando...' : 'Enviar notificación'}
            </button>
          </div>
        </form>
      </section>

      {/* Historial */}
      <section style={s.card}>
        <h2 style={s.cardTitle}>Historial de notificaciones</h2>
        {history.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: 13 }}>No hay notificaciones enviadas aún.</p>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                {['Destinatario', 'Canal', 'Asunto', 'Estado', 'Fecha envío'].map((h) => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((n) => (
                <tr key={n.id} style={s.tr}>
                  <td style={s.td}>{recipientLabel(n.recipient)}</td>
                  <td style={s.td}>
                    <span style={{ fontSize: 12 }}>
                      {n.channel === 'in-app' ? 'In-app' : n.channel}
                    </span>
                  </td>
                  <td style={s.td}>{n.subject}</td>
                  <td style={s.td}>{statusBadge(n.status)}</td>
                  <td style={s.td}>
                    {n.sent_at
                      ? new Date(n.sent_at).toLocaleString('es-AR')
                      : n.scheduled_at
                        ? `Prog. ${new Date(n.scheduled_at).toLocaleString('es-AR')}`
                        : '—'}
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
  page:       { padding: '2rem 1.5rem', maxWidth: 1100, margin: '0 auto' },
  header:     { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' },
  h1:         { fontSize: '1.5rem', fontWeight: 800, color: '#111827', margin: 0 },
  sub:        { color: '#6b7280', fontSize: 13, margin: '4px 0 0' },
  toast:      { position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', background: '#1f2937', color: '#fff', padding: '8px 20px', borderRadius: 8, fontSize: 13, zIndex: 200 },
  card:       { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '1.25rem', marginBottom: '1rem' },
  cardTitle:  { fontSize: 15, fontWeight: 700, color: '#111827', margin: '0 0 1rem' },
  label:      { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: 13, fontWeight: 500, color: '#374151' },
  labelText:  { fontSize: 13, fontWeight: 500, color: '#374151' },
  input:      { border: '1px solid #d1d5db', borderRadius: 7, padding: '7px 10px', fontSize: 13, color: '#111827', outline: 'none', fontFamily: 'inherit' },
  primaryBtn: { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  table:      { width: '100%', borderCollapse: 'collapse' as const },
  th:         { padding: '8px 10px', textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: '#6b7280', borderBottom: '1px solid #f3f4f6', background: '#fafafa' },
  tr:         { borderBottom: '1px solid #f9fafb' },
  td:         { padding: '10px 10px', fontSize: 13, verticalAlign: 'middle' as const },
}
