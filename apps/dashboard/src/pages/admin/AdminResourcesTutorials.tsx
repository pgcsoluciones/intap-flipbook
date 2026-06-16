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

const CATEGORIES: { value: string; label: string }[] = [
  { value: 'getting_started', label: 'Primeros pasos' },
  { value: 'editor',          label: 'Editor' },
  { value: 'publish',         label: 'Publicar y compartir' },
  { value: 'plans',           label: 'Planes y pagos' },
]

const TYPES = ['video', 'guide']

const CAT_LABELS: Record<string, string> = {
  getting_started: 'Primeros pasos',
  editor:          'Editor',
  publish:         'Publicar y compartir',
  plans:           'Planes y pagos',
}

interface Tutorial {
  id: number
  title: string
  category: string
  type: string
  url: string | null
  content: string | null
  thumbnail_url: string | null
  sort_order: number
  active: number
  created_at: string
}

interface FormData {
  title: string
  category: string
  type: string
  url: string
  content: string
  thumbnail_url: string
  sort_order: number
  active: boolean
}

const EMPTY_FORM: FormData = {
  title: '', category: 'getting_started', type: 'video',
  url: '', content: '', thumbnail_url: '', sort_order: 0, active: true,
}

export default function AdminResourcesTutorials() {
  const [tutorials, setTutorials] = useState<Tutorial[]>([])
  const [loading, setLoading]     = useState(true)
  const [msg, setMsg]             = useState('')
  const [isErr, setIsErr]         = useState(false)
  const [modal, setModal]         = useState(false)
  const [editing, setEditing]     = useState<Tutorial | null>(null)
  const [form, setForm]           = useState<FormData>(EMPTY_FORM)

  useEffect(() => {
    adminFetch<any>('/tutorials').then((r) => setTutorials(r.data)).finally(() => setLoading(false))
  }, [])

  function flash(t: string, err = false) { setMsg(t); setIsErr(err); setTimeout(() => setMsg(''), 3500) }

  function openCreate() { setEditing(null); setForm(EMPTY_FORM); setModal(true) }
  function openEdit(t: Tutorial) {
    setEditing(t)
    setForm({
      title:         t.title,
      category:      t.category,
      type:          t.type,
      url:           t.url ?? '',
      content:       t.content ?? '',
      thumbnail_url: t.thumbnail_url ?? '',
      sort_order:    t.sort_order,
      active:        t.active === 1,
    })
    setModal(true)
  }

  async function save() {
    try {
      const payload = {
        ...form,
        url:           form.url || null,
        content:       form.content || null,
        thumbnail_url: form.thumbnail_url || null,
      }
      if (editing) {
        await adminFetch(`/tutorials/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) })
        setTutorials((prev) => prev.map((t) =>
          t.id === editing.id ? { ...t, ...payload, active: payload.active ? 1 : 0 } : t
        ))
        flash('Tutorial actualizado.')
      } else {
        const res = await adminFetch<any>('/tutorials', { method: 'POST', body: JSON.stringify(payload) })
        setTutorials((prev) => [{
          id: res.data.id,
          title: form.title,
          category: form.category,
          type: form.type,
          url: form.url || null,
          content: form.content || null,
          thumbnail_url: form.thumbnail_url || null,
          sort_order: form.sort_order,
          active: form.active ? 1 : 0,
          created_at: new Date().toISOString(),
        }, ...prev])
        flash('Tutorial creado.')
      }
      setModal(false)
    } catch (e: any) { flash(e.message, true) }
  }

  async function deleteTut(t: Tutorial) {
    if (!confirm(`¿Eliminar "${t.title}"?`)) return
    try {
      await adminFetch(`/tutorials/${t.id}`, { method: 'DELETE' })
      setTutorials((prev) => prev.filter((x) => x.id !== t.id))
      flash('Tutorial eliminado.')
    } catch (e: any) { flash(e.message, true) }
  }

  async function toggleActive(t: Tutorial) {
    const newActive = t.active ? 0 : 1
    try {
      await adminFetch(`/tutorials/${t.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...t, active: newActive === 1 }),
      })
      setTutorials((prev) => prev.map((x) => x.id === t.id ? { ...x, active: newActive } : x))
    } catch (e: any) { flash(e.message, true) }
  }

  if (loading) return <div style={{ padding: '2rem', color: '#666' }}>Cargando...</div>

  return (
    <div>
      {msg && <div style={{ ...s.toast, background: isErr ? '#dc2626' : '#1f2937' }}>{msg}</div>}

      <div style={s.sectionHeader}>
        <p style={s.sub}>{tutorials.length} tutoriales y guias</p>
        <button onClick={openCreate} style={s.btnPrimary}>+ Nuevo tutorial</button>
      </div>

      {/* Tabla */}
      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr style={s.theadRow}>
              <th style={s.th}>Titulo</th>
              <th style={s.th}>Categoria</th>
              <th style={s.th}>Tipo</th>
              <th style={s.th}>URL / Contenido</th>
              <th style={s.th}>Orden</th>
              <th style={s.th}>Estado</th>
              <th style={s.th}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {tutorials.map((t) => {
              const preview = t.type === 'video' ? (t.url ?? '—') : (t.content ?? '—')
              return (
                <tr key={t.id} style={{ ...s.row, opacity: t.active ? 1 : 0.55 }}>
                  <td style={{ ...s.td, fontWeight: 600, color: '#111827', maxWidth: 200 }}>{t.title}</td>
                  <td style={s.td}><span style={s.catBadge}>{CAT_LABELS[t.category] ?? t.category}</span></td>
                  <td style={s.td}>
                    <span style={{ ...s.badge, background: t.type === 'video' ? '#dbeafe' : '#fef3c7', color: t.type === 'video' ? '#1e40af' : '#92400e' }}>
                      {t.type === 'video' ? 'Video' : 'Guia'}
                    </span>
                  </td>
                  <td style={{ ...s.td, color: '#6b7280', fontSize: 12, maxWidth: 200 }}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {preview.length > 50 ? preview.slice(0, 50) + '…' : preview}
                    </span>
                  </td>
                  <td style={{ ...s.td, color: '#6b7280', textAlign: 'center' as const }}>{t.sort_order}</td>
                  <td style={s.td}>
                    <span style={{ ...s.badge, background: t.active ? '#dcfce7' : '#fee2e2', color: t.active ? '#15803d' : '#991b1b' }}>
                      {t.active ? 'activo' : 'inactivo'}
                    </span>
                  </td>
                  <td style={s.td}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => openEdit(t)} style={s.btnEdit}>Editar</button>
                      <button onClick={() => toggleActive(t)} style={s.btnToggle}>{t.active ? 'Desactivar' : 'Activar'}</button>
                      <button onClick={() => deleteTut(t)} style={s.btnDel}>X</button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {tutorials.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: '#9ca3af' }}>
                  Sin tutoriales. Crea el primero con "+ Nuevo tutorial".
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
            <h2 style={s.modalTitle}>{editing ? 'Editar tutorial' : 'Nuevo tutorial'}</h2>

            <label style={s.label}>Titulo</label>
            <input style={s.input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Titulo del tutorial" />

            <label style={s.label}>Categoria</label>
            <select style={s.input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>

            <label style={s.label}>Tipo</label>
            <select style={s.input} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map((tp) => <option key={tp} value={tp}>{tp === 'video' ? 'Video' : 'Guia'}</option>)}
            </select>

            {form.type === 'video' && (
              <>
                <label style={s.label}>URL del video</label>
                <input style={s.input} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://youtube.com/..." />
              </>
            )}

            {form.type === 'guide' && (
              <>
                <label style={s.label}>Contenido (texto o HTML)</label>
                <textarea
                  style={{ ...s.input, minHeight: 100, resize: 'vertical' as const }}
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  placeholder="Contenido de la guia..."
                />
              </>
            )}

            <label style={s.label}>Miniatura / thumbnail (opcional)</label>
            <FileField
              value={form.thumbnail_url}
              onChange={(url) => setForm({ ...form, thumbnail_url: url })}
              hint="JPG, PNG, WEBP · máx 10 MB"
            />

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
}
