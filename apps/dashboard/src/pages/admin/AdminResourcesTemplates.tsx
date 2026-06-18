import { useEffect, useState } from 'react'
import { API_BASE } from '../../lib/api'
import FileField from '../../components/FileField'

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

const CATEGORIES = ['catalogo', 'menu', 'portafolio', 'revista', 'folleto', 'otro']
const PLANS = ['free', 'basic', 'pro']

const PLAN_COLORS: Record<string, { bg: string; text: string }> = {
  free:  { bg: '#f3f4f6', text: '#374151' },
  basic: { bg: '#dbeafe', text: '#1e40af' },
  pro:   { bg: '#ede9fe', text: '#5b21b6' },
  all:   { bg: '#dcfce7', text: '#15803d' },
}

// `plan_required` se guarda como texto: un plan, varios separados por coma
// ("basic,pro"), o "all" para todos. Estas funciones traducen entre el texto
// guardado y la lista de planes seleccionados en el formulario.
function parsePlans(raw: string | null | undefined): string[] {
  if (!raw) return ['free']
  const v = raw.trim().toLowerCase()
  if (v === 'all' || v === 'todos') return [...PLANS]
  const list = v.split(',').map((p) => p.trim()).filter((p) => PLANS.includes(p))
  return list.length ? list : ['free']
}

function plansToString(plans: string[]): string {
  // Si están los 3 → "all"; si no, lista ordenada separada por coma
  if (PLANS.every((p) => plans.includes(p))) return 'all'
  return PLANS.filter((p) => plans.includes(p)).join(',')
}

// Clasificación → planes por defecto:
//   Básica  = disponible en todos los planes (free, basic, pro)
//   Premium = solo planes de pago (basic, pro)
const CLASSIFICATIONS = {
  basica:  ['free', 'basic', 'pro'],
  premium: ['basic', 'pro'],
}

// Deduce la clasificación a partir de los planes seleccionados (o 'personalizada')
function classOf(plans: string[]): 'basica' | 'premium' | 'custom' {
  const set = [...plans].sort().join(',')
  if (set === [...CLASSIFICATIONS.basica].sort().join(',')) return 'basica'
  if (set === [...CLASSIFICATIONS.premium].sort().join(',')) return 'premium'
  return 'custom'
}

interface Template {
  id: number
  name: string
  category_id: number | null
  plan_required: string
  cover_url: string | null
  active: number
  sort_order: number
  created_at: string
}

interface FormData {
  name: string
  category: string
  plans: string[]        // planes seleccionados (uno o varios)
  cover_url: string
  active: boolean
}

const EMPTY_FORM: FormData = { name: '', category: 'catalogo', plans: ['free'], cover_url: '', active: true }

export default function AdminResourcesTemplates() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading]     = useState(true)
  const [msg, setMsg]             = useState('')
  const [isErr, setIsErr]         = useState(false)
  const [modal, setModal]         = useState(false)
  const [editing, setEditing]     = useState<Template | null>(null)
  const [form, setForm]           = useState<FormData>(EMPTY_FORM)

  useEffect(() => {
    adminFetch<any>('/templates').then((r) => setTemplates(r.data)).finally(() => setLoading(false))
  }, [])

  function flash(t: string, err = false) { setMsg(t); setIsErr(err); setTimeout(() => setMsg(''), 3500) }

  function openCreate() { setEditing(null); setForm(EMPTY_FORM); setModal(true) }
  function openEdit(t: Template) {
    setEditing(t)
    setForm({
      name: t.name,
      category: t.category_id ? String(t.category_id) : 'catalogo',
      plans: parsePlans(t.plan_required),
      cover_url: t.cover_url ?? '',
      active: t.active === 1,
    })
    setModal(true)
  }

  async function save() {
    if (form.plans.length === 0) { flash('Selecciona al menos un plan.', true); return }
    try {
      const plan_required = plansToString(form.plans)
      const payload = {
        name: form.name,
        category: form.category,
        plan_required,
        cover_url: form.cover_url || null,
        active: form.active,
      }
      if (editing) {
        await adminFetch(`/templates/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) })
        setTemplates((prev) => prev.map((t) =>
          t.id === editing.id ? { ...t, plan_required, cover_url: payload.cover_url, name: form.name, active: form.active ? 1 : 0 } : t
        ))
        flash('Plantilla actualizada.')
      } else {
        const res = await adminFetch<any>('/templates', { method: 'POST', body: JSON.stringify(payload) })
        setTemplates((prev) => [{
          id: res.data.id,
          name: form.name,
          category_id: null,
          plan_required,
          cover_url: form.cover_url || null,
          active: form.active ? 1 : 0,
          sort_order: 0,
          created_at: new Date().toISOString(),
        }, ...prev])
        flash('Plantilla creada.')
      }
      setModal(false)
    } catch (e: any) { flash(e.message, true) }
  }

  async function deleteTpl(t: Template) {
    if (!confirm(`¿Eliminar "${t.name}"?`)) return
    try {
      await adminFetch(`/templates/${t.id}`, { method: 'DELETE' })
      setTemplates((prev) => prev.filter((x) => x.id !== t.id))
      flash('Plantilla eliminada.')
    } catch (e: any) { flash(e.message, true) }
  }

  async function toggleActive(t: Template) {
    const newActive = t.active ? 0 : 1
    try {
      await adminFetch(`/templates/${t.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...t, active: newActive === 1 }),
      })
      setTemplates((prev) => prev.map((x) => x.id === t.id ? { ...x, active: newActive } : x))
    } catch (e: any) { flash(e.message, true) }
  }

  if (loading) return <div style={{ padding: '2rem', color: '#666' }}>Cargando...</div>

  return (
    <div>
      {msg && <div style={{ ...s.toast, background: isErr ? '#dc2626' : '#1f2937' }}>{msg}</div>}

      <div style={s.sectionHeader}>
        <p style={s.sub}>{templates.length} plantillas prediseñadas</p>
        <button onClick={openCreate} style={s.btnPrimary}>+ Nueva plantilla</button>
      </div>

      {/* Tabla */}
      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr style={s.theadRow}>
              <th style={s.th}>Thumbnail</th>
              <th style={s.th}>Nombre</th>
              <th style={s.th}>Categoria</th>
              <th style={s.th}>Plan</th>
              <th style={s.th}>Estado</th>
              <th style={s.th}>Fecha</th>
              <th style={s.th}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => {
              const isAll = (t.plan_required ?? '').trim().toLowerCase() === 'all' || parsePlans(t.plan_required).length === PLANS.length
              const planList = parsePlans(t.plan_required)
              return (
                <tr key={t.id} style={{ ...s.row, opacity: t.active ? 1 : 0.55 }}>
                  <td style={s.td}>
                    {t.cover_url
                      ? <img src={t.cover_url} alt={t.name} style={{ width: 60, height: 40, objectFit: 'cover', borderRadius: 4 }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                      : <div style={{ width: 60, height: 40, background: '#f3f4f6', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#9ca3af' }}>sin img</div>
                    }
                  </td>
                  <td style={{ ...s.td, fontWeight: 600, color: '#111827' }}>{t.name}</td>
                  <td style={s.td}><span style={s.catBadge}>{t.category_id ?? '—'}</span></td>
                  <td style={s.td}>
                    {isAll ? (
                      <span style={{ ...s.badge, background: PLAN_COLORS.all.bg, color: PLAN_COLORS.all.text }}>todos</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {planList.map((p) => {
                          const c = PLAN_COLORS[p] ?? PLAN_COLORS.free
                          return <span key={p} style={{ ...s.badge, background: c.bg, color: c.text }}>{p}</span>
                        })}
                      </div>
                    )}
                  </td>
                  <td style={s.td}>
                    <span style={{ ...s.badge, background: t.active ? '#dcfce7' : '#fee2e2', color: t.active ? '#15803d' : '#991b1b' }}>
                      {t.active ? 'activo' : 'inactivo'}
                    </span>
                  </td>
                  <td style={{ ...s.td, color: '#6b7280', fontSize: 12 }}>{t.created_at?.slice(0, 10) ?? '—'}</td>
                  <td style={s.td}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => openEdit(t)} style={s.btnEdit}>Editar</button>
                      <button onClick={() => toggleActive(t)} style={s.btnToggle}>{t.active ? 'Desactivar' : 'Activar'}</button>
                      <button onClick={() => deleteTpl(t)} style={s.btnDel}>X</button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {templates.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: '#9ca3af' }}>
                  Sin plantillas. Crea la primera con "+ Nueva plantilla".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {modal && (
        <div style={s.overlay} onClick={() => setModal(false)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={s.modalTitle}>{editing ? 'Editar plantilla' : 'Nueva plantilla'}</h2>

            <label style={s.label}>Nombre</label>
            <input style={s.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nombre de la plantilla" />

            <label style={s.label}>Categoria</label>
            <select style={s.input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </select>

            <label style={s.label}>Clasificación</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setForm({ ...form, plans: CLASSIFICATIONS.basica })}
                style={{ ...s.classBtn, ...(classOf(form.plans) === 'basica' ? s.classBtnActive : {}) }}
              >Básica <span style={s.classHint}>(todos los planes)</span></button>
              <button
                type="button"
                onClick={() => setForm({ ...form, plans: CLASSIFICATIONS.premium })}
                style={{ ...s.classBtn, ...(classOf(form.plans) === 'premium' ? s.classBtnActive : {}) }}
              >Premium <span style={s.classHint}>(Basic y Pro)</span></button>
            </div>

            <label style={s.label}>Planes con acceso</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
              <button
                type="button"
                onClick={() => setForm({ ...form, plans: [...PLANS] })}
                style={{ ...s.planChip, ...(form.plans.length === PLANS.length ? s.planChipAll : {}) }}
              >✓ Todos</button>
              {PLANS.map((p) => {
                const checked = form.plans.includes(p)
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      const next = checked ? form.plans.filter((x) => x !== p) : [...form.plans, p]
                      setForm({ ...form, plans: next })
                    }}
                    style={{ ...s.planChip, ...(checked ? s.planChipOn : {}) }}
                  >{checked ? '✓ ' : ''}{p}</button>
                )
              })}
            </div>

            <label style={s.label}>Portada</label>
            <FileField
              value={form.cover_url}
              onChange={(url) => setForm({ ...form, cover_url: url })}
              hint="JPG, PNG, WEBP · máx 10 MB"
            />

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
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' },
  sub:        { color: '#6b7280', fontSize: 13, margin: 0 },
  toast:      { position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', color: '#fff', padding: '8px 20px', borderRadius: 8, fontSize: 13, zIndex: 200 },
  tableWrap:  { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' },
  table:      { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  theadRow:   { background: '#f8fafc' },
  th:         { padding: '10px 14px', textAlign: 'left' as const, fontWeight: 600, color: '#6b7280', fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid #e5e7eb' },
  row:        { borderBottom: '1px solid #f3f4f6' },
  td:         { padding: '12px 14px', verticalAlign: 'middle' as const },
  badge:      { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6 },
  catBadge:   { fontSize: 11, background: '#f3f4f6', color: '#374151', padding: '2px 8px', borderRadius: 6 },
  btnEdit:    { background: '#e0e7ff', color: '#4338ca', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 600 },
  btnToggle:  { background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 11 },
  btnDel:     { background: '#fee2e2', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 11, color: '#991b1b', fontWeight: 600 },
  btnPrimary: { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  overlay:    { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal:      { background: '#fff', borderRadius: 16, padding: '1.5rem', width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' as const },
  modalTitle: { fontSize: 16, fontWeight: 700, margin: '0 0 1rem', color: '#111827' },
  label:      { fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4, marginTop: 12 },
  input:      { width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' as const },
  btnCancel:  { background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13 },
  classBtn:       { flex: 1, background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 10px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#374151', textAlign: 'center' as const },
  classBtnActive: { borderColor: '#4f46e5', background: '#eef2ff', color: '#4338ca' },
  classHint:      { display: 'block', fontSize: 10, fontWeight: 400, color: '#9ca3af', marginTop: 2 },
  planChip:       { background: '#fff', border: '1px solid #d1d5db', borderRadius: 999, padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#6b7280' },
  planChipOn:     { borderColor: '#4f46e5', background: '#eef2ff', color: '#4338ca' },
  planChipAll:    { borderColor: '#15803d', background: '#dcfce7', color: '#15803d' },
}
