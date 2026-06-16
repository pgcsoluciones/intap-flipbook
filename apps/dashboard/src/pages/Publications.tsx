import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useIsMobile } from '../hooks/useIsMobile'

const CATEGORIES: Record<string, string> = {
  catalogo:   'Catálogo',
  menu:       'Menú',
  portafolio: 'Portafolio',
  revista:    'Revista',
  folleto:    'Folleto',
  otro:       'Otro',
  catalog:    'Catálogo',
  portfolio:  'Portafolio',
}

const CAT_OPTIONS = [
  { value: 'catalogo',   label: 'Catálogo de productos' },
  { value: 'menu',       label: 'Menú de restaurante' },
  { value: 'portafolio', label: 'Portafolio / Brochure' },
  { value: 'revista',    label: 'Revista' },
  { value: 'folleto',    label: 'Folleto' },
  { value: 'otro',       label: 'Otro' },
]

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']

type Tab = 'active' | 'trash'

export default function Publications() {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Lista
  const [all, setAll]         = useState<any[]>([])
  const [trash, setTrash]     = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab]         = useState<Tab>('active')
  const [search, setSearch]   = useState('')

  // Modal de creación
  const [showModal, setShowModal]     = useState(false)
  const [modalFiles, setModalFiles]   = useState<File[]>([])
  const [previews, setPreviews]       = useState<string[]>([])
  const [title, setTitle]             = useState('')
  const [category, setCategory]       = useState('catalogo')
  const [isDragOver, setIsDragOver]   = useState(false)
  const [creating, setCreating]       = useState(false)
  const [progress, setProgress]       = useState('')
  const [modalError, setModalError]   = useState('')

  useEffect(() => {
    if (!localStorage.getItem('token')) { navigate('/login'); return }
    api.publications.list()
      .then((res) => setAll(res.data ?? []))
      .catch(() => { localStorage.removeItem('token'); navigate('/login') })
      .finally(() => setLoading(false))
  }, [])

  // ── Archivos ──────────────────────────────────────────────
  function addFiles(incoming: FileList | null) {
    if (!incoming) return
    const valid = Array.from(incoming).filter((f) => ACCEPTED.includes(f.type))
    if (!valid.length) return
    setModalFiles((prev) => [...prev, ...valid])
    setPreviews((prev) => [...prev, ...valid.map((f) => URL.createObjectURL(f))])
  }

  function removeFile(i: number) {
    URL.revokeObjectURL(previews[i])
    setModalFiles((prev) => prev.filter((_, j) => j !== i))
    setPreviews((prev) => prev.filter((_, j) => j !== i))
  }

  function openModal() {
    setModalFiles([]); setPreviews([]); setTitle(''); setCategory('catalogo')
    setModalError(''); setProgress(''); setShowModal(true)
  }

  function closeModal() {
    if (creating) return
    previews.forEach((u) => URL.revokeObjectURL(u))
    setShowModal(false)
  }

  // ── Crear flipbook ────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setModalError('El nombre es requerido.'); return }
    setCreating(true); setModalError('')
    try {
      const pubRes = await api.publications.create({ title: title.trim(), description: '', category })
      const pubId: string = pubRes.data.id
      for (let i = 0; i < modalFiles.length; i++) {
        setProgress(`Subiendo imagen ${i + 1} de ${modalFiles.length}...`)
        const up = await api.upload(modalFiles[i])
        await api.pages.add(pubId, { image_url: up.data.url })
      }
      navigate(`/publications/${pubId}/editor`)
    } catch (err: any) {
      setModalError(err.message ?? 'Error al crear.')
      setCreating(false); setProgress('')
    }
  }

  // ── Acciones sobre publicaciones ──────────────────────────
  async function handleDelete(id: string) {
    if (!confirm('¿Mover a papelera?')) return
    await api.publications.delete(id)
    const pub = all.find((p) => p.id === id)
    setAll((prev) => prev.filter((p) => p.id !== id))
    if (pub) setTrash((prev) => [{ ...pub, deleted: true }, ...prev])
  }

  async function handleRestore(id: string) {
    setTrash((prev) => prev.filter((p) => p.id !== id))
  }

  async function handlePermanentDelete(id: string) {
    if (!confirm('¿Eliminar definitivamente? Esta acción no se puede deshacer.')) return
    setTrash((prev) => prev.filter((p) => p.id !== id))
  }

  async function handlePublish(id: string) {
    const res = await api.publications.publish(id)
    setAll((prev) => prev.map((p) => (p.id === id ? res.data : p)))
  }

  const filtered = all.filter((p) =>
    !search || p.title.toLowerCase().includes(search.toLowerCase())
  )

  if (loading) return <div style={s.loading}>Cargando...</div>

  return (
    <div style={{ ...s.page, padding: isMobile ? '1rem' : '2rem' }}>

      {/* ── Modal de creación ── */}
      {showModal && (
        <div style={s.overlay} onClick={(e) => e.target === e.currentTarget && closeModal()}>
          <div style={s.modal}>
            <div style={s.modalHeader}>
              <h2 style={s.modalTitle}>Nuevo flipbook</h2>
              <button style={s.closeBtn} onClick={closeModal} disabled={creating}>✕</button>
            </div>

            {/* Zona drag & drop */}
            <div
              style={{
                ...s.dropZone,
                borderColor: isDragOver ? '#4f46e5' : '#c7d2fe',
                background:  isDragOver ? '#eef2ff' : '#fafafe',
              }}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setIsDragOver(false); addFiles(e.dataTransfer.files) }}
            >
              <div style={{ fontSize: 40 }}>📤</div>
              <div style={s.dropTitle}>Arrastrá tus imágenes aquí</div>
              <div style={s.dropSub}>o hacé click para seleccionar</div>
              <div style={s.dropFormats}>JPG · PNG · WEBP &nbsp;·&nbsp; Múltiples archivos &nbsp;·&nbsp; Máx. 10 MB c/u</div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".jpg,.jpeg,.png,.webp"
                style={{ display: 'none' }}
                onChange={(e) => addFiles(e.target.files)}
              />
            </div>

            {/* Previews */}
            {previews.length > 0 && (
              <div style={s.previewRow}>
                <div style={s.previewCount}>{previews.length} imagen{previews.length !== 1 ? 'es' : ''} seleccionada{previews.length !== 1 ? 's' : ''}</div>
                <div style={s.previewScroll}>
                  {previews.map((src, i) => (
                    <div key={i} style={s.previewThumb}>
                      <img src={src} style={s.previewImg} />
                      <button style={s.previewDel} onClick={() => removeFile(i)}>✕</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={handleCreate} style={s.modalForm}>
              <div style={s.formField}>
                <label style={s.formLabel}>Nombre del flipbook *</label>
                <input
                  style={s.formInput}
                  required
                  placeholder="Ej: Catálogo Temporada 2025"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={creating}
                />
              </div>
              <div style={s.formField}>
                <label style={s.formLabel}>Categoría</label>
                <select style={s.formInput} value={category} onChange={(e) => setCategory(e.target.value)} disabled={creating}>
                  {CAT_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              {progress && <div style={s.progressText}>{progress}</div>}
              {modalError && <div style={s.errorText}>{modalError}</div>}
              <div style={s.modalFooter}>
                <button type="button" style={s.btnCancel} onClick={closeModal} disabled={creating}>Cancelar</button>
                <button type="submit" style={{ ...s.btnCreate, opacity: creating ? 0.7 : 1 }} disabled={creating || !title.trim()}>
                  {creating ? 'Creando...' : 'Crear flipbook →'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div style={{ ...s.topBar, ...(isMobile ? { flexDirection: 'column', alignItems: 'stretch', gap: 12 } : {}) }}>
        <h1 style={s.pageTitle}>Mis Flipbooks</h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            style={{ ...s.searchInput, ...(isMobile ? { flex: 1, width: 'auto' } : {}) }}
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button style={{ ...s.btnNew, whiteSpace: 'nowrap' }} onClick={openModal}>+ Subir</button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={s.tabs}>
        <button style={{ ...s.tabBtn, ...(tab === 'active' ? s.tabActive : {}) }} onClick={() => setTab('active')}>
          Mis archivos ({all.length})
        </button>
        <button style={{ ...s.tabBtn, ...(tab === 'trash' ? s.tabActive : {}) }} onClick={() => setTab('trash')}>
          Papelera ({trash.length})
        </button>
      </div>

      {/* ── Contenido ── */}
      {tab === 'active' && (
        <>
          {filtered.length === 0 ? (
            <div style={s.emptyState}>
              <div style={{ fontSize: 56, marginBottom: 16, opacity: 0.4 }}>📂</div>
              <div style={s.emptyTitle}>{search ? 'Sin resultados' : 'Aún no hay archivos'}</div>
              <div style={s.emptySub}>{search ? 'Probá con otro término.' : 'Subí tus imágenes para crear tu primer flipbook.'}</div>
              {!search && (
                <button style={{ ...s.btnNew, marginTop: 20, padding: '12px 28px', fontSize: 15 }} onClick={openModal}>
                  Cargar ahora
                </button>
              )}
            </div>
          ) : (
            <div style={{ ...s.grid, gridTemplateColumns: isMobile ? 'repeat(auto-fill, minmax(150px, 1fr))' : 'repeat(auto-fill, minmax(220px, 1fr))' }}>
              {filtered.map((pub) => (
                <PubCard
                  key={pub.id}
                  pub={pub}
                  isMobile={isMobile}
                  onDelete={() => handleDelete(pub.id)}
                  onPublish={() => handlePublish(pub.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'trash' && (
        <>
          {trash.length === 0 ? (
            <div style={s.emptyState}>
              <div style={{ fontSize: 56, marginBottom: 16, opacity: 0.4 }}>🗑️</div>
              <div style={s.emptyTitle}>La papelera está vacía</div>
            </div>
          ) : (
            <div style={{ ...s.grid, gridTemplateColumns: isMobile ? 'repeat(auto-fill, minmax(150px, 1fr))' : 'repeat(auto-fill, minmax(220px, 1fr))' }}>
              {trash.map((pub) => (
                <TrashCard key={pub.id} pub={pub} onRestore={() => handleRestore(pub.id)} onDelete={() => handlePermanentDelete(pub.id)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function PubCard({ pub, isMobile, onDelete, onPublish }: { pub: any; isMobile?: boolean; onDelete: () => void; onPublish: () => void }) {
  const [hover, setHover] = useState(false)
  const isPublished = pub.status === 'published'

  return (
    <div
      style={{ ...s.card, boxShadow: hover ? '0 4px 20px rgba(0,0,0,0.12)' : '0 1px 4px rgba(0,0,0,0.07)' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={s.coverWrap}>
        {pub.cover_image_url
          ? <img src={pub.cover_image_url} alt={pub.title} style={s.coverImg} />
          : <div style={s.coverPlaceholder}><span style={{ fontSize: 40, opacity: 0.3 }}>📄</span></div>
        }
        {hover && (
          <div style={s.hoverOverlay}>
            <Link to={`/publications/${pub.id}/editor`} style={{ textDecoration: 'none' }}>
              <button style={s.overlayBtn}>Editar</button>
            </Link>
            <Link to={`/publications/${pub.id}/preview`} style={{ textDecoration: 'none' }}>
              <button style={s.overlayBtn}>Vista previa</button>
            </Link>
          </div>
        )}
        <div style={{ ...s.statusBadge, background: isPublished ? '#d1fae5' : '#f3f4f6', color: isPublished ? '#065f46' : '#6b7280' }}>
          {isPublished ? 'Publicado' : 'Borrador'}
        </div>
      </div>
      <div style={s.cardInfo}>
        <div style={s.cardName}>{pub.title}</div>
        <div style={s.cardMeta}>
          {pub.page_count ?? 0} páginas · {pub.views_count ?? 0} vistas
        </div>
        {isMobile && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 2 }}>
            <Link to={`/publications/${pub.id}/editor`} style={{ flex: 1, textDecoration: 'none' }}>
              <button style={s.mobilePrimary}>Editar</button>
            </Link>
            <Link to={`/publications/${pub.id}/preview`} style={{ flex: 1, textDecoration: 'none' }}>
              <button style={s.mobileGhost}>Vista previa</button>
            </Link>
          </div>
        )}
        <div style={s.cardActions}>
          <Link to={`/publications/${pub.id}/settings`}>
            <button style={s.actionBtn}>⚙️</button>
          </Link>
          {!isPublished && (
            <button style={{ ...s.actionBtn, color: '#059669', fontWeight: 600 }} onClick={onPublish}>Publicar</button>
          )}
          <button style={{ ...s.actionBtn, color: '#ef4444', marginLeft: 'auto' }} onClick={onDelete}>🗑️</button>
        </div>
      </div>
    </div>
  )
}

function TrashCard({ pub, onRestore, onDelete }: { pub: any; onRestore: () => void; onDelete: () => void }) {
  return (
    <div style={{ ...s.card, opacity: 0.75 }}>
      <div style={s.coverWrap}>
        {pub.cover_image_url
          ? <img src={pub.cover_image_url} alt={pub.title} style={{ ...s.coverImg, filter: 'grayscale(70%)' }} />
          : <div style={s.coverPlaceholder}><span style={{ fontSize: 40, opacity: 0.3 }}>📄</span></div>
        }
      </div>
      <div style={s.cardInfo}>
        <div style={s.cardName}>{pub.title}</div>
        <div style={s.cardActions}>
          <button style={{ ...s.actionBtn, color: '#4f46e5' }} onClick={onRestore}>↩ Restaurar</button>
          <button style={{ ...s.actionBtn, color: '#ef4444', marginLeft: 'auto' }} onClick={onDelete}>Eliminar</button>
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page:    { padding: '2rem', maxWidth: 1200, margin: '0 auto', minHeight: '100vh' },
  loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#6b7280' },

  topBar:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' },
  pageTitle: { fontSize: 22, fontWeight: 700, color: '#111827', margin: 0 },
  searchInput: { border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 14px', fontSize: 13, outline: 'none', width: 200, background: '#fff' },
  btnNew:  { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },

  tabs:    { display: 'flex', gap: 0, borderBottom: '2px solid #f3f4f6', marginBottom: '1.5rem' },
  tabBtn:  { background: 'none', border: 'none', borderBottom: '2px solid transparent', padding: '10px 18px', fontSize: 13, fontWeight: 500, color: '#6b7280', cursor: 'pointer', marginBottom: -2 },
  tabActive: { color: '#4f46e5', borderBottomColor: '#4f46e5', fontWeight: 600 },

  grid:    { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 },

  card:       { background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #e5e7eb', transition: 'box-shadow 0.18s' },
  coverWrap:  { position: 'relative', height: 150, background: '#f8fafc' },
  coverImg:   { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  coverPlaceholder: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  hoverOverlay: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 },
  overlayBtn: { background: '#fff', color: '#111827', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  statusBadge: { position: 'absolute', top: 8, right: 8, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10 },

  cardInfo:    { padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 },
  cardName:    { fontWeight: 600, fontSize: 13, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  cardMeta:    { fontSize: 11, color: '#9ca3af' },
  cardActions: { display: 'flex', gap: 4, alignItems: 'center', marginTop: 2 },
  actionBtn:   { background: 'none', border: 'none', fontSize: 12, cursor: 'pointer', color: '#6b7280', padding: '4px 6px', borderRadius: 4 },
  mobilePrimary: { width: '100%', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 6, padding: '8px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  mobileGhost:   { width: '100%', background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 6, padding: '8px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },

  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', textAlign: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: 600, color: '#374151', marginBottom: 8 },
  emptySub:   { fontSize: 14, color: '#9ca3af' },

  // Modal
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modal:   { background: '#fff', borderRadius: 16, width: 560, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px 16px', borderBottom: '1px solid #f3f4f6' },
  modalTitle: { fontSize: 18, fontWeight: 700, color: '#111827', margin: 0 },
  closeBtn:   { background: 'none', border: 'none', fontSize: 18, color: '#9ca3af', cursor: 'pointer', lineHeight: 1 },

  dropZone: {
    margin: '20px 24px 0',
    borderRadius: 12,
    border: '2px dashed #c7d2fe',
    padding: '32px 20px',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'border-color 0.18s, background 0.18s',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
  },
  dropTitle:   { fontSize: 15, fontWeight: 600, color: '#374151' },
  dropSub:     { fontSize: 13, color: '#9ca3af' },
  dropFormats: { fontSize: 11, color: '#c7d2fe', marginTop: 4, fontWeight: 500 },

  previewRow:   { padding: '16px 24px 0' },
  previewCount: { fontSize: 12, color: '#6b7280', marginBottom: 8, fontWeight: 500 },
  previewScroll: { display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 },
  previewThumb:  { position: 'relative', flexShrink: 0 },
  previewImg:    { width: 72, height: 90, objectFit: 'cover', borderRadius: 6, display: 'block', border: '1px solid #e5e7eb' },
  previewDel:    { position: 'absolute', top: -6, right: -6, background: '#ef4444', color: '#fff', border: 'none', borderRadius: '50%', width: 18, height: 18, fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1 },

  modalForm:   { padding: '16px 24px 24px', display: 'flex', flexDirection: 'column', gap: 14 },
  formField:   { display: 'flex', flexDirection: 'column', gap: 4 },
  formLabel:   { fontSize: 12, fontWeight: 600, color: '#374151' },
  formInput:   { border: '1px solid #e5e7eb', borderRadius: 8, padding: '9px 12px', fontSize: 13, outline: 'none', background: '#fff', width: '100%', boxSizing: 'border-box' as const },
  progressText: { fontSize: 13, color: '#4f46e5', fontWeight: 500, textAlign: 'center' as const },
  errorText:    { fontSize: 13, color: '#ef4444', textAlign: 'center' as const },
  modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  btnCancel:   { background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  btnCreate:   { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
}
