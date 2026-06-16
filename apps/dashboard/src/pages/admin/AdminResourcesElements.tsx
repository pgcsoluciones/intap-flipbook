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

const TYPES = ['icon', 'background', 'shape', 'button']
const PLANS = ['free', 'basic', 'pro']

const TYPE_COLORS: Record<string, string> = {
  icon:       '#dbeafe',
  background: '#f3e8ff',
  shape:      '#dcfce7',
  button:     '#fef3c7',
}
const TYPE_TEXT: Record<string, string> = {
  icon:       '#1e40af',
  background: '#6b21a8',
  shape:      '#15803d',
  button:     '#92400e',
}

interface Resource {
  id: number
  name: string
  type: string
  file_url: string
  plan_required: string
  active: number
  sort_order: number
}

interface FormData {
  name: string
  type: string
  file_url: string
  plan_required: string
  active: boolean
  sort_order: number
}

const EMPTY_FORM: FormData = { name: '', type: 'icon', file_url: '', plan_required: 'free', active: true, sort_order: 0 }

export default function AdminResourcesElements() {
  const [resources, setResources] = useState<Resource[]>([])
  const [loading, setLoading]     = useState(true)
  const [msg, setMsg]             = useState('')
  const [isErr, setIsErr]         = useState(false)
  const [typeF, setTypeF]         = useState('')
  const [planF, setPlanF]         = useState('')
  const [modal, setModal]         = useState(false)
  const [editing, setEditing]     = useState<Resource | null>(null)
  const [form, setForm]           = useState<FormData>(EMPTY_FORM)

  useEffect(() => {
    adminFetch<any>('/resources').then((r) => setResources(r.data)).finally(() => setLoading(false))
  }, [])

  function flash(t: string, err = false) { setMsg(t); setIsErr(err); setTimeout(() => setMsg(''), 3500) }

  function openCreate() { setEditing(null); setForm(EMPTY_FORM); setModal(true) }
  function openEdit(r: Resource) {
    setEditing(r)
    setForm({ name: r.name, type: r.type, file_url: r.file_url, plan_required: r.plan_required, active: r.active === 1, sort_order: r.sort_order })
    setModal(true)
  }

  async function save() {
    try {
      if (editing) {
        await adminFetch(`/resources/${editing.id}`, { method: 'PUT', body: JSON.stringify(form) })
        setResources((prev) => prev.map((r) => r.id === editing.id ? { ...r, ...form, active: form.active ? 1 : 0 } : r))
        flash('Recurso actualizado.')
      } else {
        const res = await adminFetch<any>('/resources', { method: 'POST', body: JSON.stringify(form) })
        setResources((prev) => [{ id: res.data.id, ...form, active: form.active ? 1 : 0 }, ...prev])
        flash('Recurso creado.')
      }
      setModal(false)
    } catch (e: any) { flash(e.message, true) }
  }

  async function deleteRes(r: Resource) {
    if (!confirm(`¿Eliminar "${r.name}"?`)) return
    try {
      await adminFetch(`/resources/${r.id}`, { method: 'DELETE' })
      setResources((prev) => prev.filter((x) => x.id !== r.id))
      flash('Recurso eliminado.')
    } catch (e: any) { flash(e.message, true) }
  }

  async function toggleActive(r: Resource) {
    const newActive = r.active ? 0 : 1
    try {
      await adminFetch(`/resources/${r.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...r, active: newActive === 1 }),
      })
      setResources((prev) => prev.map((x) => x.id === r.id ? { ...x, active: newActive } : x))
    } catch (e: any) { flash(e.message, true) }
  }

  const filtered = resources.filter((r) => {
    const matchType = !typeF || r.type === typeF
    const matchPlan = !planF || r.plan_required === planF
    return matchType && matchPlan
  })

  if (loading) return <div style={{ padding: '2rem', color: '#666' }}>Cargando...</div>

  return (
    <div>
      {msg && <div style={{ ...s.toast, background: isErr ? '#dc2626' : '#1f2937' }}>{msg}</div>}

      <div style={s.sectionHeader}>
        <div>
          <p style={s.sub}>{resources.length} elementos — íconos, fondos, formas y botones para el canvas</p>
        </div>
        <button onClick={openCreate} style={s.btnPrimary}>+ Nuevo recurso</button>
      </div>

      {/* Filtros */}
      <div style={s.filters}>
        <select style={s.select} value={typeF} onChange={(e) => setTypeF(e.target.value)}>
          <option value="">Todos los tipos</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select style={s.select} value={planF} onChange={(e) => setPlanF(e.target.value)}>
          <option value="">Todos los planes</option>
          {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <span style={{ fontSize: 13, color: '#9ca3af', alignSelf: 'center' }}>{filtered.length} resultado(s)</span>
      </div>

      {/* Grid */}
      <div style={s.grid}>
        {filtered.map((r) => (
          <div key={r.id} style={{ ...s.card, opacity: r.active ? 1 : 0.55 }}>
            <div style={s.preview}>
              <img src={r.file_url} alt={r.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
            </div>
            <div style={s.cardBody}>
              <div style={s.cardName}>{r.name}</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={{ ...s.badge, background: TYPE_COLORS[r.type] ?? '#f3f4f6', color: TYPE_TEXT[r.type] ?? '#374151' }}>{r.type}</span>
                <span style={s.planBadge}>{r.plan_required}</span>
                {!r.active && <span style={{ ...s.badge, background: '#fee2e2', color: '#991b1b' }}>inactivo</span>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => openEdit(r)} style={s.btnEdit}>Editar</button>
                <button onClick={() => toggleActive(r)} style={s.btnToggle}>{r.active ? 'Desactivar' : 'Activar'}</button>
                <button onClick={() => deleteRes(r)} style={s.btnDel}>X</button>
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '3rem', color: '#9ca3af' }}>
            Sin recursos. Crea el primero con "+ Nuevo recurso".
          </div>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <div style={s.overlay} onClick={() => setModal(false)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={s.modalTitle}>{editing ? 'Editar recurso' : 'Nuevo recurso'}</h2>

            <label style={s.label}>Nombre</label>
            <input style={s.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nombre del recurso" />

            <label style={s.label}>Tipo</label>
            <select style={s.input} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>

            <label style={s.label}>URL del archivo (R2 o externa)</label>
            <input style={s.input} value={form.file_url} onChange={(e) => setForm({ ...form, file_url: e.target.value })} placeholder="https://..." />

            <label style={s.label}>Plan requerido</label>
            <select style={s.input} value={form.plan_required} onChange={(e) => setForm({ ...form, plan_required: e.target.value })}>
              {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>

            <label style={s.label}>Orden (sort_order)</label>
            <input style={s.input} type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })} />

            <label style={{ ...s.label, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Activo
            </label>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setModal(false)} style={s.btnCancel}>Cancelar</button>
              <button onClick={save} style={s.btnPrimary}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' },
  sub:        { color: '#6b7280', fontSize: 13, margin: 0 },
  toast:      { position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', color: '#fff', padding: '8px 20px', borderRadius: 8, fontSize: 13, zIndex: 200 },
  filters:    { display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' as const },
  select:     { border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 13, background: '#fff', cursor: 'pointer', outline: 'none' },
  grid:       { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' },
  card:       { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' },
  preview:    { background: '#f3f4f6', height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8 },
  cardBody:   { padding: '10px 12px' },
  cardName:   { fontWeight: 600, fontSize: 13, color: '#111827', marginBottom: 6 },
  badge:      { fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 6 },
  planBadge:  { fontSize: 10, fontWeight: 700, background: '#e0e7ff', color: '#4338ca', padding: '2px 6px', borderRadius: 6 },
  btnEdit:    { background: '#e0e7ff', color: '#4338ca', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 600 },
  btnToggle:  { background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 11 },
  btnDel:     { background: '#fee2e2', border: 'none', borderRadius: 6, padding: '4px 6px', cursor: 'pointer', fontSize: 11 },
  btnPrimary: { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  overlay:    { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal:      { background: '#fff', borderRadius: 16, padding: '1.5rem', width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' as const },
  modalTitle: { fontSize: 16, fontWeight: 700, margin: '0 0 1rem', color: '#111827' },
  label:      { fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4, marginTop: 12 },
  input:      { width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' as const },
  btnCancel:  { background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13 },
}
