import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useIsMobile } from '../hooks/useIsMobile'
import { BLANK_PAGE_URL } from './EditPublication'

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

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']

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

  // Carpetas
  const [folders, setFolders]                 = useState<any[]>([])
  const [selectedFolder, setSelectedFolder]   = useState<string | null | 'none'>('none')
  const [showFolderInput, setShowFolderInput] = useState(false)
  const [newFolderName, setNewFolderName]     = useState('')

  // Modal de creación
  // mode: 'choose' (elegir cómo empezar) | 'upload' (cargar imágenes) | 'scratch' (lienzo en blanco)
  const [mode, setMode]               = useState<'choose' | 'upload' | 'scratch' | 'pdf' | 'template'>('choose')
  const [templates, setTemplates]     = useState<any[]>([])
  const [showModal, setShowModal]     = useState(false)
  const [modalFiles, setModalFiles]   = useState<File[]>([])
  const [previews, setPreviews]       = useState<string[]>([])
  const [title, setTitle]             = useState('')
  const [category, setCategory]       = useState('catalogo')
  const [isDragOver, setIsDragOver]   = useState(false)
  const [creating, setCreating]       = useState(false)
  const [progress, setProgress]       = useState('')
  const [modalError, setModalError]   = useState('')
  const [pdfProgress, setPdfProgress] = useState('')
  const [pdfFile, setPdfFile]         = useState<File | null>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!localStorage.getItem('token')) { navigate('/login'); return }
    api.publications.list()
      .then((res) => setAll(res.data ?? []))
      .catch(() => { localStorage.removeItem('token'); navigate('/login') })
      .finally(() => setLoading(false))
    api.folders.list().then((r) => setFolders(r.data ?? [])).catch(() => {})
    api.templates.list().then((r) => setTemplates(r.data ?? [])).catch(() => {})
  }, [])

  // Carpeta destino actual: solo si hay una carpeta real seleccionada (no 'Todas'/'Sin carpeta')
  const targetFolderId = (selectedFolder !== 'none' && selectedFolder !== null) ? selectedFolder : null
  const targetFolderName = targetFolderId ? folders.find((f) => f.id === targetFolderId)?.name : null

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

  function openModal(startMode: 'choose' | 'scratch' = 'choose') {
    setModalFiles([]); setPreviews([]); setTitle(''); setCategory('catalogo')
    setModalError(''); setProgress(''); setPdfFile(null); setPdfProgress('')
    setMode(startMode); setShowModal(true)
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

  // ── Crear desde cero (lienzo en blanco) ───────────────────
  async function handleCreateBlank(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setModalError('El nombre es requerido.'); return }
    setCreating(true); setModalError('')
    try {
      const pubRes = await api.publications.create({ title: title.trim(), description: '', category })
      const pubId: string = pubRes.data.id
      // Una primera página en blanco lista para editar
      await api.pages.add(pubId, { image_url: BLANK_PAGE_URL })
      navigate(`/publications/${pubId}/editor`)
    } catch (err: any) {
      setModalError(err.message ?? 'Error al crear.')
      setCreating(false)
    }
  }

  async function handleCreateFromPDF(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setModalError('El nombre es requerido.'); return }
    if (!pdfFile) { setModalError('Seleccioná un archivo PDF.'); return }
    const pdfjsLib = (window as any).pdfjsLib
    if (!pdfjsLib) { setModalError('pdf.js no está disponible. Recargá la página.'); return }
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
    setCreating(true); setModalError('')
    try {
      const pubRes = await api.publications.create({ title: title.trim(), description: '', category })
      const pubId: string = pubRes.data.id
      const arrayBuffer = await pdfFile.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      const total = pdf.numPages
      for (let pageNum = 1; pageNum <= total; pageNum++) {
        setPdfProgress(`Procesando página ${pageNum} de ${total}...`)
        const page = await pdf.getPage(pageNum)
        const viewport = page.getViewport({ scale: 1.5 })
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise
        const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.82))
        const pngFile = new File([blob], `pdf-page-${pageNum}.jpg`, { type: 'image/jpeg' })
        const up = await api.upload(pngFile)
        if (!up.success) throw new Error(`Error al subir página ${pageNum}`)
        await api.pages.add(pubId, { image_url: up.data.url })
      }
      navigate(`/publications/${pubId}/editor`)
    } catch (err: any) {
      setModalError(err.message ?? 'Error al importar el PDF.')
      setCreating(false); setPdfProgress('')
    }
  }

  // ── Aplicar plantilla → crea proyecto nuevo (en la carpeta seleccionada si la hay) ──
  async function handleApplyTemplate(tpl: any) {
    if (tpl.locked) { alert('Esta plantilla requiere un plan superior. Actualizá tu plan para acceder.'); return }
    const name = title.trim() || tpl.name
    setCreating(true); setModalError('')
    try {
      const r = await api.templates.apply(tpl.id, { title: name })
      const pubId = r.data.publication_id
      // Si hay una carpeta seleccionada, mover el nuevo proyecto a esa carpeta
      if (targetFolderId) {
        await api.folders.move(pubId, targetFolderId).catch(() => {})
      }
      navigate(`/publications/${pubId}/editor`)
    } catch (err: any) {
      setModalError(err.message ?? 'No se pudo aplicar la plantilla.')
      setCreating(false)
    }
  }

  // ── Acciones sobre publicaciones ──────────────────────────
  async function handleDelete(id: string) {
    if (!confirm('¿Mover a papelera?')) return
    await api.publications.delete(id)
    setAll((prev) => prev.filter((p) => p.id !== id))
    // Si la pestaña de papelera está abierta, la refrescamos desde el servidor
    if (tab === 'trash') loadTrash()
  }

  async function loadTrash() {
    const res = await api.publications.trash()
    setTrash(res.data ?? [])
  }

  async function handleRestore(id: string) {
    await api.publications.restore(id)
    setTrash((prev) => prev.filter((p) => p.id !== id))
    // Recarga la lista de activas para que aparezca la publicación restaurada
    const res = await api.publications.list()
    setAll(res.data ?? [])
  }

  async function handlePermanentDelete(id: string) {
    if (!confirm('¿Eliminar definitivamente? Esta acción es permanente e irreversible — no podrás recuperar este flipbook.')) return
    try {
      await api.publications.permanentDelete(id)
      setTrash((prev) => prev.filter((p) => p.id !== id))
    } catch (err: any) {
      alert('Error al eliminar: ' + (err.message ?? err))
    }
  }

  async function handlePublish(id: string) {
    const res = await api.publications.publish(id)
    setAll((prev) => prev.map((p) => (p.id === id ? res.data : p)))
  }

  async function createFolder() {
    if (!newFolderName.trim()) return
    const r = await api.folders.create(newFolderName.trim())
    setFolders((f) => [...f, r.data])
    setNewFolderName('')
    setShowFolderInput(false)
  }

  async function moveToFolder(pubId: string, folderId: string | null) {
    await api.folders.move(pubId, folderId)
    setAll((prev) => prev.map((p) => p.id === pubId ? { ...p, folder_id: folderId } : p))
    setFolders((prev) => prev.map((f) => ({
      ...f,
      pub_count: f.pub_count + (
        all.find((p) => p.id === pubId)?.folder_id === f.id ? -1 :
        f.id === folderId ? 1 : 0
      ),
    })))
  }

  const filtered = all.filter((p) => {
    if (search && !p.title.toLowerCase().includes(search.toLowerCase())) return false
    if (selectedFolder === 'none') return true
    if (selectedFolder === null) return !p.folder_id
    return p.folder_id === selectedFolder
  })

  if (loading) return <div style={s.loading}>Cargando...</div>

  return (
    <div style={{ ...s.page, padding: isMobile ? '1rem' : '2rem' }}>

      {/* ── Modal de creación ── */}
      {showModal && (
        <div style={s.overlay} onClick={(e) => e.target === e.currentTarget && closeModal()}>
          <div style={s.modal}>
            <div style={s.modalHeader}>
              <h2 style={s.modalTitle}>
                {mode === 'choose' ? 'Nuevo flipbook'
                  : mode === 'scratch' ? 'Empezar desde cero'
                  : mode === 'pdf' ? 'Importar PDF'
                  : mode === 'template' ? 'Elegí una plantilla'
                  : 'Cargar imágenes'}
              </h2>
              <button style={s.closeBtn} onClick={closeModal} disabled={creating}>✕</button>
            </div>

            {/* ── Paso 1: elegir cómo empezar ── */}
            {mode === 'choose' && (
              <div style={s.chooseWrap}>
                <button style={s.choiceCard} onClick={() => setMode('scratch')}>
                  <div style={s.choiceIcon}>🎨</div>
                  <div style={s.choiceTitle}>Empezar desde cero</div>
                  <div style={s.choiceSub}>Abrí el constructor con una página en blanco y diseñá a tu gusto.</div>
                </button>
                <button style={s.choiceCard} onClick={() => setMode('upload')}>
                  <div style={s.choiceIcon}>📤</div>
                  <div style={s.choiceTitle}>Cargar imágenes / archivo</div>
                  <div style={s.choiceSub}>Subí tus páginas en JPG, PNG, WEBP o SVG y se convierten en flipbook.</div>
                </button>
                <button style={s.choiceCard} onClick={() => setMode('template')}>
                  <div style={s.choiceIcon}>🗂️</div>
                  <div style={s.choiceTitle}>Usar una plantilla</div>
                  <div style={s.choiceSub}>
                    Partí de un diseño prearmado y personalizalo.
                    {targetFolderName && <> Se creará en la carpeta «{targetFolderName}».</>}
                  </div>
                </button>
                <button style={s.choiceCard} onClick={() => setMode('pdf')}>
                  <div style={s.choiceIcon}>📄</div>
                  <div style={s.choiceTitle}>Importar PDF</div>
                  <div style={s.choiceSub}>Cada página del PDF se convierte en una página del flipbook, lista para editar.</div>
                </button>
              </div>
            )}

            {/* ── Paso 2a: desde cero (solo nombre + categoría) ── */}
            {mode === 'scratch' && (
              <form onSubmit={handleCreateBlank} style={s.modalForm}>
                <div style={s.formField}>
                  <label style={s.formLabel}>Nombre del flipbook *</label>
                  <input
                    style={s.formInput}
                    required autoFocus
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
                {modalError && <div style={s.errorText}>{modalError}</div>}
                <div style={s.modalFooter}>
                  <button type="button" style={s.btnCancel} onClick={() => setMode('choose')} disabled={creating}>← Volver</button>
                  <button type="submit" style={{ ...s.btnCreate, opacity: creating ? 0.7 : 1 }} disabled={creating || !title.trim()}>
                    {creating ? 'Creando...' : 'Abrir constructor →'}
                  </button>
                </div>
              </form>
            )}

            {/* ── Paso 2d: elegir plantilla (se aplica a la carpeta seleccionada) ── */}
            {mode === 'template' && (
              <div style={s.modalForm}>
                <div style={s.formField}>
                  <label style={s.formLabel}>Nombre del flipbook (opcional)</label>
                  <input
                    style={s.formInput}
                    placeholder="Si lo dejás vacío, se usa el nombre de la plantilla"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={creating}
                  />
                </div>
                {targetFolderName && (
                  <div style={{ fontSize: 12, color: '#4f46e5', fontWeight: 500 }}>
                    📁 Se creará dentro de la carpeta «{targetFolderName}».
                  </div>
                )}
                {templates.length === 0 ? (
                  <p style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', padding: '20px 0' }}>
                    No hay plantillas disponibles todavía.
                  </p>
                ) : (
                  <div style={s.tplGrid}>
                    {templates.map((t) => (
                      <button
                        key={t.id}
                        style={{ ...s.tplCard, ...(t.locked ? { opacity: 0.6 } : {}) }}
                        disabled={creating}
                        title={t.locked ? `${t.name} — Requiere plan superior` : `Usar ${t.name}`}
                        onClick={() => handleApplyTemplate(t)}
                      >
                        {t.cover_url
                          ? <img src={t.cover_url} alt={t.name} style={s.tplImg} />
                          : <div style={s.tplPlaceholder}>🗂️</div>}
                        {t.locked && <div style={s.tplLock}>🔒</div>}
                        <div style={s.tplName}>{t.name}</div>
                      </button>
                    ))}
                  </div>
                )}
                {modalError && <div style={s.errorText}>{modalError}</div>}
                <div style={s.modalFooter}>
                  <button type="button" style={s.btnCancel} onClick={() => setMode('choose')} disabled={creating}>← Volver</button>
                </div>
              </div>
            )}

            {/* ── Paso 2c: importar PDF ── */}
            {mode === 'pdf' && (
              <form onSubmit={handleCreateFromPDF} style={s.modalForm}>
                <div style={s.formField}>
                  <label style={s.formLabel}>Nombre del flipbook *</label>
                  <input
                    style={s.formInput}
                    required autoFocus
                    placeholder="Ej: Presentación Empresa 2025"
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
                <div style={s.formField}>
                  <label style={s.formLabel}>Archivo PDF *</label>
                  <div
                    style={{
                      border: '2px dashed #c7d2fe', borderRadius: 10, padding: '20px', textAlign: 'center',
                      cursor: 'pointer', background: pdfFile ? '#f0fdf4' : '#fafafe',
                    }}
                    onClick={() => pdfInputRef.current?.click()}
                  >
                    {pdfFile
                      ? <span style={{ color: '#059669', fontWeight: 600 }}>📄 {pdfFile.name} ({(pdfFile.size / 1024 / 1024).toFixed(1)} MB)</span>
                      : <span style={{ color: '#9ca3af' }}>Hacé clic para seleccionar un PDF (máx. 50 MB)</span>
                    }
                  </div>
                  <input
                    ref={pdfInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    style={{ display: 'none' }}
                    onChange={(e) => { setPdfFile(e.target.files?.[0] ?? null); e.target.value = '' }}
                  />
                </div>
                {pdfProgress && <div style={{ color: '#6366f1', fontSize: 13, margin: '8px 0' }}>{pdfProgress}</div>}
                {modalError && <div style={s.errorText}>{modalError}</div>}
                <div style={s.modalFooter}>
                  <button type="button" style={s.btnCancel} onClick={() => setMode('choose')} disabled={creating}>← Volver</button>
                  <button type="submit" style={{ ...s.btnCreate, opacity: creating ? 0.7 : 1 }} disabled={creating || !title.trim() || !pdfFile}>
                    {creating ? (pdfProgress || 'Procesando...') : 'Importar PDF →'}
                  </button>
                </div>
              </form>
            )}

            {/* ── Paso 2b: cargar imágenes ── */}
            {mode === 'upload' && (
            <>
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
              <div style={s.dropFormats}>JPG · PNG · WEBP · SVG &nbsp;·&nbsp; Múltiples archivos &nbsp;·&nbsp; Máx. 10 MB c/u</div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".jpg,.jpeg,.png,.webp,.svg"
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
                <button type="button" style={s.btnCancel} onClick={() => setMode('choose')} disabled={creating}>← Volver</button>
                <button type="submit" style={{ ...s.btnCreate, opacity: creating ? 0.7 : 1 }} disabled={creating || !title.trim()}>
                  {creating ? 'Creando...' : 'Crear flipbook →'}
                </button>
              </div>
            </form>
            </>
            )}
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
          <button style={{ ...s.btnGhost, whiteSpace: 'nowrap' }} onClick={() => openModal('scratch')}>+ Crear desde cero</button>
          <button style={{ ...s.btnNew, whiteSpace: 'nowrap' }} onClick={() => openModal('choose')}>+ Subir</button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={s.tabs}>
        <button style={{ ...s.tabBtn, ...(tab === 'active' ? s.tabActive : {}) }} onClick={() => setTab('active')}>
          Mis archivos ({all.length})
        </button>
        <button style={{ ...s.tabBtn, ...(tab === 'trash' ? s.tabActive : {}) }} onClick={() => { setTab('trash'); loadTrash() }}>
          Papelera ({trash.length})
        </button>
      </div>

      {/* ── Panel de carpetas ── */}
      {tab === 'active' && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', padding: '0 0 0.75rem' }}>
          {(['none', null] as const).concat(folders.map((f: any) => f.id)).map((v, i) => {
            const label = v === 'none' ? 'Todas' : v === null ? 'Sin carpeta' : `📁 ${folders.find((f: any) => f.id === v)?.name} (${folders.find((f: any) => f.id === v)?.pub_count ?? 0})`
            const active = selectedFolder === v
            return (
              <button key={i} onClick={() => setSelectedFolder(v as any)} style={{ padding: '4px 12px', borderRadius: 20, border: '1px solid #d1d5db', background: active ? '#4f46e5' : '#fff', color: active ? '#fff' : '#374151', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500, transition: 'all .15s' }}>
                {label}
              </button>
            )
          })}
          {showFolderInput ? (
            <span style={{ display: 'flex', gap: 4 }}>
              <input
                autoFocus
                style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: '0.8rem' }}
                placeholder="Nombre de carpeta"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') createFolder(); if (e.key === 'Escape') setShowFolderInput(false) }}
              />
              <button onClick={createFolder} style={{ padding: '3px 8px', borderRadius: 6, background: '#4f46e5', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.8rem' }}>OK</button>
              <button onClick={() => setShowFolderInput(false)} style={{ padding: '3px 8px', borderRadius: 6, background: '#f3f4f6', color: '#374151', border: 'none', cursor: 'pointer', fontSize: '0.8rem' }}>✕</button>
            </span>
          ) : (
            <button onClick={() => setShowFolderInput(true)} style={{ padding: '4px 12px', borderRadius: 20, border: '1px dashed #9ca3af', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontSize: '0.8rem' }}>+ Nueva carpeta</button>
          )}
        </div>
      )}

      {/* ── Contenido ── */}
      {tab === 'active' && (
        <>
          {filtered.length === 0 ? (
            <div style={s.emptyState}>
              <div style={{ fontSize: 56, marginBottom: 16, opacity: 0.4 }}>📂</div>
              <div style={s.emptyTitle}>{search ? 'Sin resultados' : 'Aún no hay archivos'}</div>
              <div style={s.emptySub}>{search ? 'Probá con otro término.' : 'Subí tus imágenes para crear tu primer flipbook.'}</div>
              {!search && (
                <button style={{ ...s.btnNew, marginTop: 20, padding: '12px 28px', fontSize: 15 }} onClick={() => openModal('choose')}>
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
                  onMoveFolder={(fid) => moveToFolder(pub.id, fid)}
                  onCoverChanged={(url) => setAll((prev) => prev.map((p) => p.id === pub.id ? { ...p, cover_image_url: url } : p))}
                  folders={folders}
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

function ProposeModal({ pub, onClose }: { pub: any; onClose: () => void }) {
  const [title, setTitle] = useState(pub.title ?? '')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState(pub.category ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setError('El título es requerido.'); return }
    setSaving(true); setError('')
    try {
      await api.proposals.create({ publication_id: pub.id, title: title.trim(), description: description.trim() || undefined, category: category.trim() || undefined })
      setSuccess(true)
    } catch (err: any) {
      setError(err.message ?? 'Error al enviar la propuesta.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={s.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={s.modal}>
        <div style={s.modalHeader}>
          <h2 style={s.modalTitle}>Proponer como plantilla</h2>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>
        {success ? (
          <div style={{ padding: '32px 24px', textAlign: 'center' as const }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#111827', marginBottom: 8 }}>¡Propuesta enviada!</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>El equipo de administración revisará tu publicación. Si es aprobada, aparecerá en el catálogo de plantillas para todos los usuarios.</div>
            <button style={s.btnCreate} onClick={onClose}>Cerrar</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={s.modalForm}>
            <div style={s.formField}>
              <label style={s.formLabel}>Nombre de la plantilla *</label>
              <input
                style={s.formInput}
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={saving}
                placeholder="Ej: Catálogo de ferretería"
              />
            </div>
            <div style={s.formField}>
              <label style={s.formLabel}>Descripción (opcional)</label>
              <textarea
                style={{ ...s.formInput, minHeight: 80, resize: 'vertical' as const }}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={saving}
                placeholder="Describí brevemente para qué sirve esta plantilla..."
              />
            </div>
            <div style={s.formField}>
              <label style={s.formLabel}>Categoría (opcional)</label>
              <input
                style={s.formInput}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={saving}
                placeholder="Ej: Catálogo, Menú, Portafolio..."
              />
            </div>
            {error && <div style={s.errorText}>{error}</div>}
            <div style={s.modalFooter}>
              <button type="button" style={s.btnCancel} onClick={onClose} disabled={saving}>Cancelar</button>
              <button type="submit" style={{ ...s.btnCreate, opacity: saving ? 0.7 : 1 }} disabled={saving}>
                {saving ? 'Enviando...' : 'Enviar propuesta'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function PubCard({ pub, isMobile, onDelete, onPublish, onMoveFolder, onCoverChanged, folders }: { pub: any; isMobile?: boolean; onDelete: () => void; onPublish: () => void; onMoveFolder: (folderId: string | null) => void; onCoverChanged: (url: string) => void; folders: any[] }) {
  const [hover, setHover] = useState(false)
  const [showPropose, setShowPropose] = useState(false)
  const [showCoverModal, setShowCoverModal] = useState(false)
  const isPublished = pub.status === 'published'

  return (
    <>
    {showPropose && <ProposeModal pub={pub} onClose={() => setShowPropose(false)} />}
    {showCoverModal && <CoverModal pubId={pub.id} currentCover={pub.cover_image_url} onClose={() => setShowCoverModal(false)} onConfirm={(url) => { onCoverChanged(url); setShowCoverModal(false) }} />}
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
          <select
            title="Mover a carpeta"
            value={pub.folder_id ?? ''}
            onChange={(e) => onMoveFolder(e.target.value || null)}
            onClick={(e) => e.stopPropagation()}
            style={{ fontSize: '0.7rem', border: '1px solid #e5e7eb', borderRadius: 6, padding: '2px 4px', background: '#f9fafb', color: '#374151', cursor: 'pointer' }}
          >
            <option value="">— Sin carpeta</option>
            {folders.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <button
            title="Cambiar portada"
            style={{ ...s.actionBtn, fontSize: 11 }}
            onClick={() => setShowCoverModal(true)}
          >🖼️</button>
          {isPublished && (
            <button
              title="Proponer como plantilla"
              style={{ ...s.actionBtn, color: '#f59e0b', fontWeight: 600 }}
              onClick={() => setShowPropose(true)}
            >⭐</button>
          )}
          <button style={{ ...s.actionBtn, color: '#ef4444', marginLeft: 'auto' }} onClick={onDelete}>🗑️</button>
        </div>
      </div>
    </div>
    </>
  )
}

function CoverModal({ pubId, currentCover, onClose, onConfirm }: { pubId: string; currentCover: string | null; onClose: () => void; onConfirm: (url: string) => void }) {
  const [pages, setPages] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(currentCover ?? null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.publications.get(pubId)
      .then((r) => setPages(r.data?.pages ?? []))
      .catch(() => setError('No se pudieron cargar las páginas.'))
      .finally(() => setLoading(false))
  }, [pubId])

  async function handleConfirm() {
    if (!selected) return
    setSaving(true); setError('')
    try {
      await api.publications.update(pubId, { cover_image_url: selected })
      onConfirm(selected)
    } catch (e: any) {
      setError(e.message ?? 'Error al guardar.')
      setSaving(false)
    }
  }

  return (
    <div style={s.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ ...s.modal, width: 560 }}>
        <div style={s.modalHeader}>
          <h2 style={s.modalTitle}>Cambiar portada</h2>
          <button style={s.closeBtn} onClick={onClose} disabled={saving}>✕</button>
        </div>
        <div style={{ padding: '16px 24px 24px' }}>
          {loading && <p style={{ color: '#9ca3af', textAlign: 'center' }}>Cargando páginas...</p>}
          {!loading && pages.length === 0 && !error && <p style={{ color: '#9ca3af', textAlign: 'center' }}>Sin páginas disponibles.</p>}
          {error && <div style={s.errorText}>{error}</div>}
          {!loading && pages.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 10, maxHeight: 360, overflowY: 'auto', marginBottom: 16 }}>
              {pages.map((page: any, i: number) => (
                <div
                  key={page.id ?? i}
                  onClick={() => setSelected(page.image_url)}
                  style={{
                    cursor: 'pointer',
                    borderRadius: 8,
                    border: selected === page.image_url ? '2.5px solid #4f46e5' : '2px solid #e5e7eb',
                    overflow: 'hidden',
                    background: '#f8fafc',
                    transition: 'border-color .15s',
                  }}
                >
                  {page.image_url
                    ? <img src={page.image_url} alt="" style={{ width: '100%', height: 80, objectFit: 'cover', display: 'block' }} />
                    : <div style={{ width: '100%', height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, opacity: 0.3 }}>📄</div>
                  }
                  <div style={{ fontSize: 10, color: '#6b7280', textAlign: 'center' as const, padding: '4px 2px' }}>Pág. {page.page_number ?? i + 1}</div>
                </div>
              ))}
            </div>
          )}
          <div style={s.modalFooter}>
            <button style={s.btnCancel} onClick={onClose} disabled={saving}>Cancelar</button>
            <button
              style={{ ...s.btnCreate, opacity: (!selected || saving) ? 0.7 : 1 }}
              disabled={!selected || saving}
              onClick={handleConfirm}
            >
              {saving ? 'Guardando...' : 'Confirmar portada'}
            </button>
          </div>
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
  btnGhost: { background: '#fff', color: '#4f46e5', border: '1.5px solid #4f46e5', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },

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

  chooseWrap:  { padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 12 },
  choiceCard:  { display: 'block', width: '100%', textAlign: 'left', background: '#fafafe', border: '1.5px solid #e5e7eb', borderRadius: 12, padding: '16px 18px', cursor: 'pointer', transition: 'border-color .15s, background .15s' },
  choiceIcon:  { fontSize: 28, marginBottom: 6 },
  choiceTitle: { fontSize: 15, fontWeight: 700, color: '#111827', marginBottom: 2 },
  choiceSub:   { fontSize: 12.5, color: '#6b7280', lineHeight: 1.4 },

  tplGrid:     { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10, maxHeight: 320, overflowY: 'auto', padding: '4px 2px' },
  tplCard:     { position: 'relative', background: '#fafafe', border: '1.5px solid #e5e7eb', borderRadius: 10, padding: 6, cursor: 'pointer', textAlign: 'center', overflow: 'hidden' },
  tplImg:      { width: '100%', height: 90, objectFit: 'cover', borderRadius: 6, display: 'block' },
  tplPlaceholder: { width: '100%', height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, background: '#eef2ff', borderRadius: 6 },
  tplLock:     { position: 'absolute', top: 10, right: 10, fontSize: 16 },
  tplName:     { fontSize: 11, fontWeight: 600, color: '#374151', marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },

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
