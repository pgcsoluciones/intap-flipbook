import { useEffect, useState, useRef } from 'react'
import { api } from '../../lib/api'

// Planes y módulos disponibles (alineados con lib/plans.ts y el PRD de biblioteca SVG)
const PLANS = [
  { id: 'free', label: 'Free' },
  { id: 'basic', label: 'Basic' },
  { id: 'pro', label: 'Pro' },
]
const MODULES = [
  { id: 'canvas_insert_svg', label: 'Insertar en canvas' },
  { id: 'button_icon_picker', label: 'Icono de botón' },
  { id: 'shape_svg_picker', label: 'Formas / decoración' },
  { id: 'action_icon_picker', label: 'Iconos de acción' },
  { id: 'template_graphics', label: 'Gráficos de plantilla' },
]
const EDITABLE = [
  { key: 'editable_colors', label: 'Colores' },
  { key: 'editable_stroke', label: 'Trazo' },
  { key: 'editable_layers', label: 'Capas' },
  { key: 'editable_gradients', label: 'Gradientes' },
  { key: 'editable_geometry', label: 'Geometría' },
]

type BatchFile = { name: string; svg_content: string }

export default function AdminSvg() {
  const [resources, setResources] = useState<any[]>([])
  const [families, setFamilies] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filterFamily, setFilterFamily] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [q, setQ] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [showFamilies, setShowFamilies] = useState(false)
  const [editing, setEditing] = useState<any | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [r, f] = await Promise.all([
        api.adminSvg.list({ family: filterFamily, status: filterStatus, q }),
        api.adminSvg.families.list(),
      ])
      setResources(r.data ?? [])
      setFamilies(f.data ?? [])
    } catch (e: any) {
      alert(e?.message ?? 'Error cargando la biblioteca')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [filterFamily, filterStatus]) // eslint-disable-line

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>Biblioteca SVG</h1>
          <p style={s.sub}>Recursos vectoriales editables, controlados por plan y módulo. Solo super admin.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={s.secBtn} onClick={() => setShowFamilies(true)}>Familias</button>
          <button style={s.primBtn} onClick={() => setShowUpload(true)}>+ Subir SVG</button>
        </div>
      </div>

      {/* Filtros */}
      <div style={s.filters}>
        <input style={s.input} placeholder="Buscar por nombre o etiqueta…" value={q}
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <select style={s.input} value={filterFamily} onChange={(e) => setFilterFamily(e.target.value)}>
          <option value="">Todas las familias</option>
          {families.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.resource_count})</option>)}
        </select>
        <select style={s.input} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="active">Activos</option>
          <option value="draft">Borradores</option>
          <option value="archived">Archivados</option>
        </select>
        <button style={s.secBtn} onClick={load}>Buscar</button>
      </div>

      {loading ? (
        <p style={s.muted}>Cargando…</p>
      ) : resources.length === 0 ? (
        <p style={s.muted}>No hay recursos. Sube tu primer SVG con el botón “+ Subir SVG”.</p>
      ) : (
        <div style={s.grid}>
          {resources.map((r) => (
            <div key={r.id} style={{ ...s.card, ...(r.status === 'archived' ? { opacity: 0.55 } : {}) }}>
              <div style={s.preview}>
                <img src={r.svg_url} alt={r.name} style={s.previewImg} loading="lazy" />
              </div>
              <div style={s.cardBody}>
                <div style={s.cardName} title={r.name}>{r.name}</div>
                <div style={s.cardMeta}>{r.family_name ?? 'Sin familia'} · v{r.version}</div>
                <div style={s.badges}>
                  {safeArr(r.plans).map((p: string) => <span key={p} style={s.badge}>{p}</span>)}
                  {r.status !== 'active' && <span style={{ ...s.badge, background: '#fef3c7', color: '#92400e' }}>{r.status}</span>}
                </div>
                <div style={s.cardActions}>
                  <button style={s.miniBtn} onClick={() => setEditing(r)}>Editar</button>
                  {r.status !== 'archived' && (
                    <button style={s.miniBtnDanger} onClick={async () => {
                      if (!confirm(`¿Archivar "${r.name}"? No se podrá insertar en nuevos diseños, pero los existentes no se rompen.`)) return
                      await api.adminSvg.archive(r.id); load()
                    }}>Archivar</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showUpload && <UploadModal families={families} onClose={() => setShowUpload(false)} onDone={() => { setShowUpload(false); load() }} />}
      {showFamilies && <FamiliesModal families={families} onClose={() => setShowFamilies(false)} onChange={load} />}
      {editing && <EditModal resource={editing} families={families} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load() }} />}
    </div>
  )
}

// ─── Modal de subida (individual + lote) ──────────────────────────────────────
function UploadModal({ families, onClose, onDone }: { families: any[]; onClose: () => void; onDone: () => void }) {
  const [files, setFiles] = useState<BatchFile[]>([])
  const [familyId, setFamilyId] = useState('')
  const [newFamily, setNewFamily] = useState('')
  const [modules, setModules] = useState<string[]>(['canvas_insert_svg'])
  const [plans, setPlans] = useState<string[]>(['free'])
  const [flags, setFlags] = useState<Record<string, boolean>>({
    editable_colors: true, editable_stroke: true, editable_layers: true,
    editable_gradients: false, editable_geometry: true,
  })
  const [status, setStatus] = useState('active')
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function addFiles(fileList: FileList | null) {
    if (!fileList) return
    const next: BatchFile[] = []
    for (const f of Array.from(fileList)) {
      if (!f.name.toLowerCase().endsWith('.svg') && f.type !== 'image/svg+xml') continue
      const text = await f.text()
      next.push({ name: f.name.replace(/\.svg$/i, ''), svg_content: text })
    }
    setFiles((prev) => [...prev, ...next])
  }

  function toggle(arr: string[], set: (v: string[]) => void, val: string) {
    set(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val])
  }

  async function submit() {
    if (!files.length) return alert('Agrega al menos un archivo SVG.')
    if (!plans.length) return alert('Selecciona al menos un plan.')
    if (!modules.length) return alert('Selecciona al menos un módulo.')
    setBusy(true)
    try {
      // Familia: crear nueva si se escribió un nombre
      let famId: any = familyId || null
      if (newFamily.trim()) {
        const created = await api.adminSvg.families.create({ name: newFamily.trim() })
        famId = created.data.id
      }
      const shared = {
        family_id: famId, available_modules: modules, plans, status,
        ...flags,
      }
      if (files.length === 1) {
        await api.adminSvg.create({ name: files[0].name, svg_content: files[0].svg_content, ...shared })
      } else {
        const res = await api.adminSvg.batch({ items: files, ...shared })
        if (res.data.errors?.length) {
          alert(`Subidos: ${res.data.created.length}. Con error: ${res.data.errors.length}\n` +
            res.data.errors.map((e: any) => `• ${e.name}: ${e.error}`).join('\n'))
        }
      }
      onDone()
    } catch (e: any) {
      alert(e?.message ?? 'Error al subir')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Subir SVG a la biblioteca" onClose={onClose} wide>
      {/* Dropzone */}
      <div
        style={{ ...s.dropzone, ...(drag ? { borderColor: '#6366f1', background: '#eef2ff' } : {}) }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files) }}
        onClick={() => fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" accept=".svg,image/svg+xml" multiple style={{ display: 'none' }}
          onChange={(e) => addFiles(e.target.files)} />
        Arrastra archivos .svg aquí o haz clic para seleccionar (uno o varios)
      </div>

      {files.length > 0 && (
        <div style={s.fileGrid}>
          {files.map((f, i) => (
            <div key={i} style={s.fileItem}>
              <div style={s.filePreview} dangerouslySetInnerHTML={{ __html: f.svg_content }} />
              <input style={s.fileNameInput} value={f.name}
                onChange={(e) => setFiles((prev) => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
              <button style={s.removeFile} onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Configuración compartida del lote */}
      <div style={s.cfgGrid}>
        <div>
          <label style={s.label}>Familia existente</label>
          <select style={s.input} value={familyId} onChange={(e) => setFamilyId(e.target.value)} disabled={!!newFamily.trim()}>
            <option value="">— Sin familia —</option>
            {families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <label style={{ ...s.label, marginTop: 8 }}>…o crear familia nueva</label>
          <input style={s.input} placeholder="ej: Frutas" value={newFamily} onChange={(e) => setNewFamily(e.target.value)} />
        </div>
        <div>
          <label style={s.label}>Estado</label>
          <select style={s.input} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Activo</option>
            <option value="draft">Borrador</option>
          </select>
        </div>
      </div>

      <label style={s.label}>Disponible en módulos</label>
      <div style={s.chips}>
        {MODULES.map((m) => (
          <button key={m.id} style={{ ...s.chip, ...(modules.includes(m.id) ? s.chipOn : {}) }}
            onClick={() => toggle(modules, setModules, m.id)}>{m.label}</button>
        ))}
      </div>

      <label style={s.label}>Planes permitidos</label>
      <div style={s.chips}>
        {PLANS.map((p) => (
          <button key={p.id} style={{ ...s.chip, ...(plans.includes(p.id) ? s.chipOn : {}) }}
            onClick={() => toggle(plans, setPlans, p.id)}>{p.label}</button>
        ))}
      </div>

      <label style={s.label}>Permisos de edición (qué puede tocar el tenant)</label>
      <div style={s.chips}>
        {EDITABLE.map((f) => (
          <button key={f.key} style={{ ...s.chip, ...(flags[f.key] ? s.chipOn : {}) }}
            onClick={() => setFlags((p) => ({ ...p, [f.key]: !p[f.key] }))}>{f.label}</button>
        ))}
      </div>

      <div style={s.modalActions}>
        <button style={s.secBtn} onClick={onClose} disabled={busy}>Cancelar</button>
        <button style={s.primBtn} onClick={submit} disabled={busy || !files.length}>
          {busy ? 'Subiendo…' : `Subir ${files.length || ''} SVG`}
        </button>
      </div>
    </Modal>
  )
}

// ─── Modal de edición de metadata ─────────────────────────────────────────────
function EditModal({ resource, families, onClose, onDone }: { resource: any; families: any[]; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(resource.name)
  const [familyId, setFamilyId] = useState(resource.family_id ?? '')
  const [modules, setModules] = useState<string[]>(safeArr(resource.modules ?? resource.available_modules))
  const [plans, setPlans] = useState<string[]>(safeArr(resource.plans))
  const [status, setStatus] = useState(resource.status)
  const [flags, setFlags] = useState<Record<string, boolean>>({
    editable_colors: !!(resource.editable?.colors ?? resource.editable_colors),
    editable_stroke: !!(resource.editable?.stroke ?? resource.editable_stroke),
    editable_layers: !!(resource.editable?.layers ?? resource.editable_layers),
    editable_gradients: !!(resource.editable?.gradients ?? resource.editable_gradients),
    editable_geometry: !!(resource.editable?.geometry ?? resource.editable_geometry),
  })
  const [busy, setBusy] = useState(false)

  function toggle(arr: string[], set: (v: string[]) => void, val: string) {
    set(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val])
  }

  async function save() {
    setBusy(true)
    try {
      await api.adminSvg.update(resource.id, {
        name, family_id: familyId || null, available_modules: modules, plans, status, ...flags,
      })
      onDone()
    } catch (e: any) {
      alert(e?.message ?? 'Error al guardar')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Editar recurso SVG" onClose={onClose}>
      <div style={{ ...s.preview, height: 120, marginBottom: 12 }}>
        <img src={resource.svg_url} alt={name} style={s.previewImg} />
      </div>
      <label style={s.label}>Nombre</label>
      <input style={s.input} value={name} onChange={(e) => setName(e.target.value)} />
      <label style={s.label}>Familia</label>
      <select style={s.input} value={familyId} onChange={(e) => setFamilyId(e.target.value)}>
        <option value="">— Sin familia —</option>
        {families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
      <label style={s.label}>Estado</label>
      <select style={s.input} value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="active">Activo</option>
        <option value="draft">Borrador</option>
        <option value="archived">Archivado</option>
      </select>
      <label style={s.label}>Módulos</label>
      <div style={s.chips}>
        {MODULES.map((m) => (
          <button key={m.id} style={{ ...s.chip, ...(modules.includes(m.id) ? s.chipOn : {}) }}
            onClick={() => toggle(modules, setModules, m.id)}>{m.label}</button>
        ))}
      </div>
      <label style={s.label}>Planes</label>
      <div style={s.chips}>
        {PLANS.map((p) => (
          <button key={p.id} style={{ ...s.chip, ...(plans.includes(p.id) ? s.chipOn : {}) }}
            onClick={() => toggle(plans, setPlans, p.id)}>{p.label}</button>
        ))}
      </div>
      <label style={s.label}>Permisos de edición</label>
      <div style={s.chips}>
        {EDITABLE.map((f) => (
          <button key={f.key} style={{ ...s.chip, ...(flags[f.key] ? s.chipOn : {}) }}
            onClick={() => setFlags((p) => ({ ...p, [f.key]: !p[f.key] }))}>{f.label}</button>
        ))}
      </div>
      <div style={s.modalActions}>
        <button style={s.secBtn} onClick={onClose} disabled={busy}>Cancelar</button>
        <button style={s.primBtn} onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </Modal>
  )
}

// ─── Modal de familias ────────────────────────────────────────────────────────
function FamiliesModal({ families, onClose, onChange }: { families: any[]; onClose: () => void; onChange: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function create() {
    if (!name.trim()) return
    setBusy(true)
    try { await api.adminSvg.families.create({ name: name.trim() }); setName(''); onChange() }
    catch (e: any) { alert(e?.message ?? 'Error') }
    finally { setBusy(false) }
  }

  return (
    <Modal title="Familias de SVG" onClose={onClose}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input style={{ ...s.input, flex: 1 }} placeholder="Nueva familia (ej: Acciones)" value={name}
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        <button style={s.primBtn} onClick={create} disabled={busy}>Crear</button>
      </div>
      {families.length === 0 ? <p style={s.muted}>Aún no hay familias.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {families.map((f) => (
            <div key={f.id} style={s.famRow}>
              <span>{f.name} <span style={s.muted}>({f.resource_count})</span></span>
              <button style={s.miniBtnDanger} onClick={async () => {
                if (!confirm(`¿Eliminar la familia "${f.name}"? Sus recursos quedarán sin familia (no se borran).`)) return
                await api.adminSvg.families.remove(f.id); onChange()
              }}>Eliminar</button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

// ─── Modal genérico ───────────────────────────────────────────────────────────
function Modal({ title, children, onClose, wide }: { title: string; children: any; onClose: () => void; wide?: boolean }) {
  return (
    <div style={s.backdrop} onClick={onClose}>
      <div style={{ ...s.modal, ...(wide ? { maxWidth: 680 } : {}) }} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHead}>
          <h2 style={s.modalTitle}>{title}</h2>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={s.modalScroll}>{children}</div>
      </div>
    </div>
  )
}

function safeArr(v: any): string[] {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : [] } catch { return [] } }
  return []
}

const s: Record<string, React.CSSProperties> = {
  page: { padding: '2rem 1.5rem' },
  header: { marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  h1: { fontSize: '1.5rem', fontWeight: 800, color: '#111827', margin: 0 },
  sub: { color: '#6b7280', fontSize: 13, margin: '4px 0 0' },
  muted: { color: '#9ca3af', fontSize: 13 },
  filters: { display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' },
  input: { padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, width: '100%' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 },
  card: { border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', background: '#fff' },
  preview: { height: 100, background: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 },
  previewImg: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' },
  cardBody: { padding: 10 },
  cardName: { fontSize: 13, fontWeight: 600, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  cardMeta: { fontSize: 11, color: '#9ca3af', margin: '2px 0 6px' },
  badges: { display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 },
  badge: { fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#eef2ff', color: '#4338ca', textTransform: 'uppercase' as const },
  cardActions: { display: 'flex', gap: 6 },
  miniBtn: { flex: 1, fontSize: 12, padding: '5px 0', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer' },
  miniBtnDanger: { flex: 1, fontSize: 12, padding: '5px 8px', border: '1px solid #fecaca', borderRadius: 6, background: '#fff', color: '#dc2626', cursor: 'pointer' },
  primBtn: { padding: '8px 16px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  secBtn: { padding: '8px 16px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, cursor: 'pointer' },
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 },
  modal: { background: '#fff', borderRadius: 12, width: '100%', maxWidth: 460, maxHeight: '90vh', display: 'flex', flexDirection: 'column' },
  modalHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #e5e7eb' },
  modalTitle: { fontSize: 16, fontWeight: 700, margin: 0 },
  closeBtn: { border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: '#6b7280' },
  modalScroll: { padding: 20, overflow: 'auto' },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 },
  dropzone: { border: '2px dashed #d1d5db', borderRadius: 10, padding: '28px 16px', textAlign: 'center', color: '#6b7280', fontSize: 13, cursor: 'pointer', marginBottom: 14 },
  fileGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, marginBottom: 16 },
  fileItem: { border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, position: 'relative' },
  filePreview: { height: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 6, overflow: 'hidden' },
  fileNameInput: { width: '100%', fontSize: 11, padding: '4px 6px', border: '1px solid #e5e7eb', borderRadius: 5 },
  removeFile: { position: 'absolute', top: 4, right: 4, width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'rgba(220,38,38,.9)', color: '#fff', fontSize: 10, cursor: 'pointer', lineHeight: 1 },
  cfgGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 6 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', margin: '12px 0 5px' },
  chips: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  chip: { fontSize: 12, padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: 20, background: '#fff', color: '#374151', cursor: 'pointer' },
  chipOn: { background: '#4f46e5', color: '#fff', borderColor: '#4f46e5' },
  famRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 7, fontSize: 13 },
}
