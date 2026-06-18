import { useEffect, useState } from 'react'
import { API_BASE } from '../../lib/api'
import FileField from '../../components/FileField'

function authH() {
  const t = localStorage.getItem('token')
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

type Promotion = {
  id: number
  title: string
  description: string
  benefit_type: 'descuento_%' | 'dias_gratis' | 'upgrade_temporal'
  benefit_value: number
  target_plans: string[]
  cta_text: string
  cta_url: string
  promo_code?: string
  start_date: string
  end_date: string
  status: 'activa' | 'programada' | 'pausada' | 'vencida'
}

const EMPTY_FORM = {
  title: '',
  description: '',
  benefit_type: 'descuento_%' as Promotion['benefit_type'],
  benefit_value: 0,
  target_plans: [] as string[],
  cta_text: '',
  cta_url: '',
  promo_code: '',
  start_date: '',
  end_date: '',
  image_url: '',
  status: 'programada' as Promotion['status'],
}

function statusBadge(status: string) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    activa:     { bg: '#d1fae5', color: '#065f46', label: 'Activa' },
    programada: { bg: '#dbeafe', color: '#1e40af', label: 'Programada' },
    pausada:    { bg: '#f3f4f6', color: '#374151', label: 'Pausada' },
    vencida:    { bg: '#fee2e2', color: '#991b1b', label: 'Vencida' },
  }
  const style = map[status] ?? map.pausada
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: style.bg, color: style.color }}>
      {style.label}
    </span>
  )
}

function benefitLabel(type: string) {
  const map: Record<string, string> = {
    'descuento_%':      'Descuento %',
    'dias_gratis':      'Días gratis',
    'upgrade_temporal': 'Upgrade temporal',
  }
  return map[type] ?? type
}

export default function AdminPromotions() {
  const [promos, setPromos]     = useState<Promotion[]>([])
  const [loading, setLoading]   = useState(true)
  const [msg, setMsg]           = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm]         = useState(EMPTY_FORM)
  const [saving, setSaving]     = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const r = await fetch(`${API_BASE}/admin/promotions`, { headers: authH() })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
      // Normaliza los nombres de campo que devuelve la API (starts_at/ends_at, target_plans JSON)
      const rows = (d.data ?? []).map((p: any) => ({
        ...p,
        start_date: p.start_date ?? p.starts_at,
        end_date: p.end_date ?? p.ends_at,
        target_plans: Array.isArray(p.target_plans)
          ? p.target_plans
          : (() => { try { return JSON.parse(p.target_plans ?? '[]') } catch { return [] } })(),
      }))
      setPromos(rows)
    } catch (e: any) { flash(e.message) }
    finally { setLoading(false) }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      // La API espera starts_at/ends_at (no start_date/end_date)
      const payload = {
        title: form.title,
        description: form.description,
        benefit_type: form.benefit_type,
        benefit_value: form.benefit_value,
        target_plans: form.target_plans,
        cta_text: form.cta_text,
        cta_url: form.cta_url,
        promo_code: form.promo_code,
        image_url: form.image_url,
        starts_at: form.start_date,
        ends_at: form.end_date,
        status: form.status,
      }
      const r = await fetch(`${API_BASE}/admin/promotions`, {
        method: 'POST',
        headers: authH(),
        body: JSON.stringify(payload),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
      flash('Promoción creada correctamente.')
      setShowModal(false)
      setForm(EMPTY_FORM)
      load()
    } catch (e: any) { flash(e.message) }
    finally { setSaving(false) }
  }

  async function handleToggle(id: number) {
    try {
      const r = await fetch(`${API_BASE}/admin/promotions/${id}/toggle`, {
        method: 'PATCH',
        headers: authH(),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
      flash('Estado actualizado.')
      load()
    } catch (e: any) { flash(e.message) }
  }

  async function handleDelete(id: number) {
    if (!confirm('¿Eliminar esta promoción? Esta acción no se puede deshacer.')) return
    try {
      const r = await fetch(`${API_BASE}/admin/promotions/${id}`, {
        method: 'DELETE',
        headers: authH(),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
      flash('Promoción eliminada.')
      setPromos((prev) => prev.filter((p) => p.id !== id))
    } catch (e: any) { flash(e.message) }
  }

  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(''), 3500) }

  function togglePlan(plan: string) {
    setForm((f) => ({
      ...f,
      target_plans: f.target_plans.includes(plan)
        ? f.target_plans.filter((p) => p !== plan)
        : [...f.target_plans, plan],
    }))
  }

  if (loading) return <div style={{ padding: '3rem', color: '#666' }}>Cargando...</div>

  return (
    <div style={s.page}>
      {msg && <div style={s.toast}>{msg}</div>}

      <div style={s.header}>
        <div>
          <h1 style={s.h1}>Promociones</h1>
          <p style={s.sub}>Gestiona ofertas, descuentos y upgrades temporales</p>
        </div>
        <button onClick={() => setShowModal(true)} style={s.primaryBtn}>+ Nueva promoción</button>
      </div>

      <section style={s.card}>
        {promos.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: 13 }}>No hay promociones configuradas.</p>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                {['Título', 'Tipo de beneficio', 'Planes objetivo', 'Fechas', 'Estado', 'Acciones'].map((h) => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {promos.map((p) => (
                <tr key={p.id} style={s.tr}>
                  <td style={s.td}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{p.title}</div>
                    {p.promo_code && (
                      <div style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace', marginTop: 2 }}>
                        {p.promo_code}
                      </div>
                    )}
                  </td>
                  <td style={s.td}>
                    <div style={{ fontSize: 13 }}>{benefitLabel(p.benefit_type)}</div>
                    <div style={{ fontSize: 11, color: '#6b7280' }}>
                      {p.benefit_type === 'descuento_%' ? `${p.benefit_value}%` : `${p.benefit_value} días`}
                    </div>
                  </td>
                  <td style={s.td}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {(p.target_plans ?? []).map((plan) => (
                        <span key={plan} style={s.planChip}>{plan}</span>
                      ))}
                    </div>
                  </td>
                  <td style={s.td}>
                    <div style={{ fontSize: 12, color: '#374151' }}>
                      {new Date(p.start_date).toLocaleDateString('es-AR')} →
                    </div>
                    <div style={{ fontSize: 12, color: '#374151' }}>
                      {new Date(p.end_date).toLocaleDateString('es-AR')}
                    </div>
                  </td>
                  <td style={s.td}>{statusBadge(p.status)}</td>
                  <td style={s.td}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => handleToggle(p.id)} style={s.btnToggle}>
                        {p.status === 'activa' ? '⏸ Pausar' : '▶ Activar'}
                      </button>
                      <button onClick={() => handleDelete(p.id)} style={s.btnDelete}>✕ Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {showModal && (
        <div style={s.overlay} onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
          <div style={s.modal}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#111827' }}>Nueva promoción</h2>
              <button onClick={() => setShowModal(false)} style={s.closeBtn}>✕</button>
            </div>

            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={s.label}>
                Título *
                <input style={s.input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              </label>

              <label style={s.label}>
                Descripción
                <textarea
                  style={{ ...s.input, resize: 'vertical', minHeight: 72 }}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </label>

              <div style={s.label}>
                Imagen / banner (opcional)
                <FileField
                  value={form.image_url}
                  onChange={(url) => setForm({ ...form, image_url: url })}
                  hint="JPG, PNG, WEBP o SVG · máx 10 MB"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={s.label}>
                  Tipo de beneficio *
                  <select style={s.input} value={form.benefit_type} onChange={(e) => setForm({ ...form, benefit_type: e.target.value as Promotion['benefit_type'] })}>
                    <option value="descuento_%">Descuento %</option>
                    <option value="dias_gratis">Días gratis</option>
                    <option value="upgrade_temporal">Upgrade temporal</option>
                  </select>
                </label>
                <label style={s.label}>
                  Valor {form.benefit_type === 'descuento_%' ? '(%)' : '(días)'} *
                  <input
                    style={s.input}
                    type="number"
                    min={1}
                    value={form.benefit_value}
                    onChange={(e) => setForm({ ...form, benefit_value: Number(e.target.value) })}
                    required
                  />
                </label>
              </div>

              <div style={s.label}>
                Planes objetivo *
                <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                  {['Free', 'Basic', 'Pro', 'Todos'].map((plan) => (
                    <label key={plan} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={form.target_plans.includes(plan)}
                        onChange={() => togglePlan(plan)}
                      />
                      {plan}
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={s.label}>
                  Texto CTA
                  <input style={s.input} value={form.cta_text} onChange={(e) => setForm({ ...form, cta_text: e.target.value })} placeholder="Ej: Activar ahora" />
                </label>
                <label style={s.label}>
                  URL CTA
                  <input style={s.input} type="url" value={form.cta_url} onChange={(e) => setForm({ ...form, cta_url: e.target.value })} placeholder="https://..." />
                </label>
              </div>

              <label style={s.label}>
                Código promocional (opcional)
                <input style={s.input} value={form.promo_code} onChange={(e) => setForm({ ...form, promo_code: e.target.value })} placeholder="Ej: VERANO25" />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={s.label}>
                  Fecha inicio *
                  <input style={s.input} type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} required />
                </label>
                <label style={s.label}>
                  Fecha fin *
                  <input style={s.input} type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} required />
                </label>
              </div>

              <label style={s.label}>
                Estado inicial
                <select style={s.input} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Promotion['status'] })}>
                  <option value="activa">Activa</option>
                  <option value="programada">Programada</option>
                  <option value="pausada">Pausada</option>
                </select>
              </label>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" onClick={() => setShowModal(false)} style={s.cancelBtn}>Cancelar</button>
                <button type="submit" disabled={saving} style={s.primaryBtn}>
                  {saving ? 'Guardando...' : 'Guardar promoción'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page:       { padding: '2rem 1.5rem', maxWidth: 1100, margin: '0 auto' },
  header:     { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' },
  h1:         { fontSize: '1.5rem', fontWeight: 800, color: '#111827', margin: 0 },
  sub:        { color: '#6b7280', fontSize: 13, margin: '4px 0 0' },
  toast:      { position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', background: '#1f2937', color: '#fff', padding: '8px 20px', borderRadius: 8, fontSize: 13, zIndex: 300 },
  card:       { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '1.25rem', marginBottom: '1rem' },
  table:      { width: '100%', borderCollapse: 'collapse' as const },
  th:         { padding: '8px 10px', textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: '#6b7280', borderBottom: '1px solid #f3f4f6', background: '#fafafa' },
  tr:         { borderBottom: '1px solid #f9fafb' },
  td:         { padding: '10px 10px', fontSize: 13, verticalAlign: 'middle' as const },
  planChip:   { fontSize: 11, fontWeight: 600, background: '#e0e7ff', color: '#4338ca', padding: '2px 7px', borderRadius: 8 },
  primaryBtn: { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btnToggle:  { background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  btnDelete:  { background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  overlay:    { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '1rem' },
  modal:      { background: '#fff', borderRadius: 14, padding: '1.5rem', width: '100%', maxWidth: 580, maxHeight: '90vh', overflowY: 'auto' as const },
  closeBtn:   { background: 'transparent', border: 'none', fontSize: 18, cursor: 'pointer', color: '#6b7280', lineHeight: 1 },
  label:      { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: 13, fontWeight: 500, color: '#374151' },
  input:      { border: '1px solid #d1d5db', borderRadius: 7, padding: '7px 10px', fontSize: 13, color: '#111827', outline: 'none', fontFamily: 'inherit' },
  cancelBtn:  { background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13 },
}
