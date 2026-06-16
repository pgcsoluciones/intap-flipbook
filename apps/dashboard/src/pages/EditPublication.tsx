import React, { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
// @ts-ignore
import { fabric } from 'fabric'
import { api } from '../lib/api'

// ─── Herramientas de la barra lateral (icon rail) ─────────────────────────────
type ToolKey =
  | 'pages' | 'templates' | 'text' | 'image'
  | 'shapes' | 'buttons' | 'elements' | 'link' | 'widgets' | 'uploads'

const RAIL: { key: ToolKey; icon: string; label: string }[] = [
  { key: 'pages',     icon: '📄', label: 'Páginas' },
  { key: 'templates', icon: '🎨', label: 'Plantilla' },
  { key: 'text',      icon: 'T',  label: 'Texto' },
  { key: 'image',     icon: '🖼️', label: 'Imagen' },
  { key: 'shapes',    icon: '◇',  label: 'Formas' },
  { key: 'buttons',   icon: '🔘', label: 'Botones' },
  { key: 'elements',  icon: '✦',  label: 'Elementos' },
  { key: 'link',      icon: '🔗', label: 'Enlace' },
  { key: 'widgets',   icon: '🧩', label: 'Widgets' },
  { key: 'uploads',   icon: '⬆',  label: 'Cargas' },
]

// Paletas de color prediseñadas (panel derecho de configuración)
const COLOR_SCHEMES: { name: string; colors: string[] }[] = [
  { name: 'Azul cielo',     colors: ['#0EA5E9', '#38BDF8', '#7DD3FC', '#BAE6FD'] },
  { name: 'Verde helecho',  colors: ['#059669', '#10B981', '#34D399', '#A7F3D0'] },
  { name: 'Marrón cálido',  colors: ['#92400E', '#B45309', '#D97706', '#FCD34D'] },
  { name: 'Medianoche',     colors: ['#1E1B4B', '#312E81', '#4F46E5', '#818CF8'] },
]

// Estilos de texto prediseñados
const TEXT_PRESETS = [
  { label: 'Agregar Título',      sample: 'Título',     opts: { fontSize: 44, fontWeight: 'bold' as const } },
  { label: 'Agregar Subtítulo',   sample: 'Subtítulo',  opts: { fontSize: 28, fontWeight: 600 as any } },
  { label: 'Texto Principal',     sample: 'Cuerpo de texto', opts: { fontSize: 18, fontWeight: 'normal' as const } },
  { label: 'Texto pequeño',       sample: 'Pie de página',   opts: { fontSize: 13, fontWeight: 'normal' as const } },
]

// Botones prediseñados
const BUTTON_PRESETS = [
  'Configuración', 'Regístrate', 'Confirmar', 'Compartir', 'Comprar Ahora',
  'Cargar', 'Contáctanos', 'Aprender Más', 'Leer Más', 'Iniciar Sesión',
  'Reproducir', 'Buscar', 'Agregar al Carrito', 'Soporte',
]

// Widgets disponibles (algunos premium)
const WIDGETS = [
  { icon: '🖼️', label: 'Generar imágenes', premium: true },
  { icon: '🗺️', label: 'Mapa', premium: false },
  { icon: '▦',  label: 'Tabla', premium: false },
  { icon: '🔢', label: 'Paginación', premium: false },
  { icon: '🔗', label: 'Incrustar terceros', premium: true },
  { icon: '📱', label: 'Código QR', premium: false },
  { icon: '📑', label: 'TOC automático', premium: true },
  { icon: '👍', label: 'Me gusta', premium: false },
  { icon: '❓', label: 'Cuestionario', premium: true },
]

export default function EditPublication() {
  const { id } = useParams<{ id: string }>()
  const [pub, setPub]       = useState<any>(null)
  const [pages, setPages]   = useState<any[]>([])
  const [activePage, setActivePage] = useState<any>(null)
  const [uploading, setUploading]   = useState(false)
  const [saving, setSaving]         = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [selected, setSelected] = useState<any>(null)
  const [zoom, setZoom]   = useState(100)
  const [msg, setMsg]     = useState('')

  const [activeTool, setActiveTool] = useState<ToolKey>('pages')
  const [panelOpen, setPanelOpen]   = useState(true)
  const [templates, setTemplates]   = useState<any[]>([])
  const [tplQuery, setTplQuery]     = useState('')
  const [bgColor, setBgColor]       = useState('#ffffff')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<any>(null)
  const pageIdRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!id) return
    api.publications.get(id).then((res) => {
      setPub(res.data)
      const ps = res.data.pages ?? []
      setPages(ps)
      if (ps.length > 0) setActivePage(ps[0])
    })
    api.templates.list().then((r) => setTemplates(r.data ?? [])).catch(() => {})
  }, [id])

  // ── Inicialización del canvas Fabric.js por página ──
  useEffect(() => {
    if (!activePage || !canvasRef.current) return

    if (fabricRef.current && pageIdRef.current && pageIdRef.current !== activePage.id) {
      persistCanvas(pageIdRef.current, fabricRef.current)
    }
    pageIdRef.current = activePage.id
    if (fabricRef.current) { fabricRef.current.dispose(); fabricRef.current = null }

    const W = 580
    const H = Math.round(W * 1.414)
    const canvas = new fabric.Canvas(canvasRef.current, { width: W, height: H, backgroundColor: bgColor })
    fabricRef.current = canvas

    fabric.Image.fromURL(activePage.image_url, (img: any) => {
      img.scaleToWidth(W)
      img.scaleToHeight(H)
      img.set({ selectable: false, evented: false })
      canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas))
    })

    if (activePage.canvas_json) {
      canvas.loadFromJSON(activePage.canvas_json, () => canvas.renderAll())
    }

    canvas.on('selection:created', (e: any) => setSelected(e.selected?.[0] ?? null))
    canvas.on('selection:updated', (e: any) => setSelected(e.selected?.[0] ?? null))
    canvas.on('selection:cleared', () => setSelected(null))

    return () => {
      if (fabricRef.current) {
        persistCanvas(activePage.id, fabricRef.current)
        fabricRef.current.dispose()
        fabricRef.current = null
      }
    }
  }, [activePage?.id])

  async function persistCanvas(pageId: string, canvas: any) {
    try { await api.pages.saveCanvas(pageId, JSON.stringify(canvas.toJSON())) } catch {}
  }

  async function saveCurrentCanvas() {
    const canvas = fabricRef.current
    if (!canvas || !pageIdRef.current) return
    setSaving(true)
    try {
      const json = JSON.stringify(canvas.toJSON())
      await api.pages.saveCanvas(pageIdRef.current, json)
      setPages((prev) => prev.map((p) => p.id === pageIdRef.current ? { ...p, canvas_json: json } : p))
      flash('Página guardada')
    } finally { setSaving(false) }
  }

  function flash(text: string) { setMsg(text); setTimeout(() => setMsg(''), 2200) }

  // ── Elementos del canvas ──
  function addText(opts: any = {}) {
    const c = fabricRef.current; if (!c) return
    const t = new fabric.Textbox(opts.sample ?? 'Texto aquí', {
      left: 60, top: 60, width: 240, fontSize: 24, fill: '#111827',
      fontFamily: 'Inter, sans-serif', ...opts,
    })
    c.add(t); c.setActiveObject(t)
  }
  function addRect() {
    const c = fabricRef.current; if (!c) return
    const r = new fabric.Rect({ left: 80, top: 80, width: 160, height: 80, fill: 'rgba(79,70,229,0.85)', rx: 8, ry: 8 })
    c.add(r); c.setActiveObject(r)
  }
  function addCircle() {
    const c = fabricRef.current; if (!c) return
    const o = new fabric.Circle({ radius: 60, fill: 'rgba(79,70,229,0.85)', left: 100, top: 100 })
    c.add(o); c.setActiveObject(o)
  }
  function addTriangle() {
    const c = fabricRef.current; if (!c) return
    const t = new fabric.Triangle({ width: 120, height: 100, fill: 'rgba(16,185,129,0.85)', left: 100, top: 100 })
    c.add(t); c.setActiveObject(t)
  }
  function addLine() {
    const c = fabricRef.current; if (!c) return
    const l = new fabric.Line([0, 0, 250, 0], { stroke: '#111827', strokeWidth: 3, left: 80, top: 200 })
    c.add(l); c.setActiveObject(l)
  }
  function addEllipse() {
    const c = fabricRef.current; if (!c) return
    const e = new fabric.Ellipse({ rx: 90, ry: 55, fill: 'rgba(6,182,212,0.85)', left: 90, top: 110 })
    c.add(e); c.setActiveObject(e)
  }
  function addButton(label: string) {
    const c = fabricRef.current; if (!c) return
    const btn = new fabric.Group([
      new fabric.Rect({ width: 180, height: 46, fill: '#4F46E5', rx: 23, ry: 23, originX: 'center', originY: 'center' }),
      new fabric.Text(label, { fill: '#fff', fontSize: 15, fontFamily: 'Inter, sans-serif', fontWeight: 'bold', originX: 'center', originY: 'center' }),
    ], { left: 100, top: 120, data: { type: 'link', url: 'https://' } })
    c.add(btn); c.setActiveObject(btn)
    flash('Edita la URL del botón en Propiedades')
  }
  function addLinkZone() {
    const c = fabricRef.current; if (!c) return
    const zone = new fabric.Rect({
      left: 80, top: 80, width: 180, height: 100,
      fill: 'rgba(79,70,229,0.15)', stroke: '#4F46E5', strokeDashArray: [6, 4], strokeWidth: 2,
      data: { type: 'link', url: 'https://' },
    })
    c.add(zone); c.setActiveObject(zone)
    flash('Zona clicable: define la URL en Propiedades')
  }

  // ── Imágenes / páginas ──
  async function handleUpload(file: File) {
    setUploading(true)
    try {
      const up = await api.upload(file)
      if (!up.success) throw new Error('Upload falló')
      const res = await api.pages.add(id!, { image_url: up.data.url })
      setPages((prev) => { const next = [...prev, res.data]; setActivePage(res.data); return next })
    } finally { setUploading(false) }
  }
  async function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    e.target.value = ''
    for (const file of files) await handleUpload(file)
  }
  async function handleDeletePage(pageId: string) {
    if (!confirm('¿Eliminar esta página?')) return
    await api.pages.delete(pageId)
    setPages((prev) => {
      const next = prev.filter((p) => p.id !== pageId)
      if (activePage?.id === pageId) setActivePage(next[0] ?? null)
      return next
    })
  }

  // ── Drag & drop ──
  const dragRef = useRef<number | null>(null)
  function onDragStart(i: number) { dragRef.current = i }
  function onDropReorder(i: number) {
    if (dragRef.current === null || dragRef.current === i) return
    const next = [...pages]
    const [moved] = next.splice(dragRef.current, 1)
    next.splice(i, 0, moved)
    setPages(next)
    api.pages.reorder(id!, next.map((p) => p.id))
    dragRef.current = null
  }
  const [fileDrag, setFileDrag] = useState(false)
  function onFileDragOver(e: React.DragEvent) {
    if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) { e.preventDefault(); setFileDrag(true) }
  }
  function onFileDragLeave() { setFileDrag(false) }
  async function onFileDrop(e: React.DragEvent) {
    e.preventDefault(); setFileDrag(false)
    const files = Array.from(e.dataTransfer.files).filter((f) => ['image/jpeg', 'image/png', 'image/webp'].includes(f.type))
    for (const file of files) await handleUpload(file)
  }

  function applyBgColor(color: string) {
    setBgColor(color)
    const c = fabricRef.current
    if (c) { c.setBackgroundColor(color, c.renderAll.bind(c)) }
  }

  async function handlePublish() {
    setPublishing(true)
    await saveCurrentCanvas()
    try {
      const res = await api.publications.publish(id!)
      setPub(res.data)
      flash('¡Publicado!')
    } catch (e: any) { flash(e.message) }
    finally { setPublishing(false) }
  }

  function deleteSelected() {
    const c = fabricRef.current
    const o = c?.getActiveObject()
    if (o) { c!.remove(o); setSelected(null) }
  }

  function selectTool(key: ToolKey) {
    if (key === activeTool && panelOpen) { setPanelOpen(false); return }
    setActiveTool(key); setPanelOpen(true)
  }

  const activePageIndex = activePage ? pages.findIndex((p) => p.id === activePage.id) : -1
  const filteredTpls = templates.filter((t) => t.name?.toLowerCase().includes(tplQuery.toLowerCase()))

  if (!pub) return <div style={s.loading}>Cargando editor...</div>

  return (
    <div style={s.root}>
      {/* ── Barra superior ── */}
      <div style={s.topBar}>
        <div style={s.topLeft}>
          <Link to="/publications" style={s.backLink}>&#8592; Mis flipbooks</Link>
          <span style={s.pubTitle}>{pub.title}</span>
        </div>
        <div style={s.topCenter}>
          {activePage && pages.length > 0 && (
            <span style={s.breadcrumb}>{activePageIndex + 1} / {pages.length}</span>
          )}
        </div>
        <div style={s.topRight}>
          {msg && <span style={s.msg}>{msg}</span>}
          <Link to={`/publications/${id}/preview`}>
            <button style={s.btnOutlineWhite}>Vista previa</button>
          </Link>
          <button
            style={{ ...s.btnPublish, background: pub.status === 'published' ? '#16a34a' : '#4f46e5' }}
            onClick={handlePublish}
            disabled={publishing}
          >
            {publishing ? 'Publicando...' : pub.status === 'published' ? '✓ Publicado' : 'Publicar'}
          </button>
        </div>
      </div>

      <div style={s.body}>
        {/* ── Icon rail ── */}
        <nav style={s.rail}>
          {RAIL.map((t) => (
            <button
              key={t.key}
              onClick={() => selectTool(t.key)}
              title={t.label}
              style={{ ...s.railBtn, ...(activeTool === t.key && panelOpen ? s.railBtnActive : {}) }}
            >
              <span style={s.railIcon}>{t.icon}</span>
              <span style={s.railLabel}>{t.label}</span>
            </button>
          ))}
        </nav>

        {/* ── Panel contextual ── */}
        {panelOpen && (
          <aside style={s.panel}>
            <ContextPanel
              tool={activeTool}
              pages={pages}
              activePage={activePage}
              setActivePage={setActivePage}
              onDragStart={onDragStart}
              onDropReorder={onDropReorder}
              handleDeletePage={handleDeletePage}
              fileInputRef={fileInputRef}
              uploading={uploading}
              fileDrag={fileDrag}
              onFileDragOver={onFileDragOver}
              onFileDragLeave={onFileDragLeave}
              onFileDrop={onFileDrop}
              templates={filteredTpls}
              tplQuery={tplQuery}
              setTplQuery={setTplQuery}
              addText={addText}
              addRect={addRect}
              addCircle={addCircle}
              addTriangle={addTriangle}
              addLine={addLine}
              addEllipse={addEllipse}
              addButton={addButton}
              addLinkZone={addLinkZone}
            />
          </aside>
        )}

        {/* ── Canvas central ── */}
        <main style={s.center}>
          <div style={s.toolbar}>
            <button style={s.toolBtn} title="Eliminar selección" onClick={deleteSelected}>🗑</button>
            <div style={s.toolSep} />
            <div style={{ flex: 1 }} />
            <div style={s.zoomGroup}>
              {[50, 75, 100, 125].map((z) => (
                <button key={z} style={{ ...s.zoomBtn, ...(zoom === z ? s.zoomActive : {}) }} onClick={() => setZoom(z)}>
                  {z}%
                </button>
              ))}
            </div>
            <div style={s.toolSep} />
            <button style={s.savePgBtn} onClick={saveCurrentCanvas} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar página'}
            </button>
          </div>

          <div style={s.canvasWrap}>
            {activePage ? (
              <div style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
                <canvas ref={canvasRef} />
              </div>
            ) : (
              <div
                style={{ ...s.canvasEmpty, ...(fileDrag ? { background: 'rgba(79,70,229,0.08)' } : {}) }}
                onDragOver={onFileDragOver} onDragLeave={onFileDragLeave} onDrop={onFileDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <div style={{ fontSize: 52, marginBottom: 16, opacity: 0.4 }}>📷</div>
                <p style={{ color: '#374151', fontSize: 15, fontWeight: 600, textAlign: 'center', maxWidth: 280 }}>
                  Arrastra imágenes aquí o haz clic para subir
                </p>
                <p style={{ color: '#9ca3af', fontSize: 13, marginTop: 8 }}>JPG, PNG o WEBP · múltiples archivos</p>
              </div>
            )}
          </div>
        </main>

        {/* ── Panel derecho: propiedades o configuración de página ── */}
        <aside style={s.right}>
          {selected ? (
            <>
              <div style={s.rightHeader}>Propiedades</div>
              <PropsPanel obj={selected} canvas={fabricRef.current} />
            </>
          ) : (
            <PageConfig bgColor={bgColor} applyBgColor={applyBgColor} />
          )}
        </aside>
      </div>

      {/* input oculto multi-archivo (compartido) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />
    </div>
  )
}

// ─── Panel contextual según herramienta ──────────────────────────────────────
function ContextPanel(p: any) {
  switch (p.tool) {
    case 'pages':
      return (
        <>
          <PanelTitle title="Páginas" count={p.pages.length} />
          <div
            style={{ ...cp.thumbList, ...(p.fileDrag ? { outline: '2px dashed #818cf8' } : {}) }}
            onDragOver={p.onFileDragOver} onDragLeave={p.onFileDragLeave} onDrop={p.onFileDrop}
          >
            {p.pages.map((page: any, i: number) => (
              <div
                key={page.id}
                draggable
                onDragStart={() => p.onDragStart(i)}
                onDragOver={(e: React.DragEvent) => e.preventDefault()}
                onDrop={() => p.onDropReorder(i)}
                onClick={() => p.setActivePage(page)}
                style={{ ...cp.thumbItem, borderColor: p.activePage?.id === page.id ? '#4F46E5' : 'transparent' }}
              >
                <img src={page.image_url} alt={`p${i + 1}`} style={cp.thumbImg} />
                <div style={cp.thumbNum}>{i + 1}</div>
                <button style={cp.thumbDel} onClick={(e: React.MouseEvent) => { e.stopPropagation(); p.handleDeletePage(page.id) }}>✕</button>
              </div>
            ))}
          </div>
          <button style={cp.primaryBtn} onClick={() => p.fileInputRef.current?.click()} disabled={p.uploading}>
            {p.uploading ? 'Subiendo...' : '+ Agregar páginas'}
          </button>
        </>
      )

    case 'templates':
      return (
        <>
          <PanelTitle title="Plantillas" />
          <input
            placeholder="Buscar plantilla..."
            value={p.tplQuery}
            onChange={(e: any) => p.setTplQuery(e.target.value)}
            style={cp.search}
          />
          {p.templates.length === 0 ? (
            <p style={cp.empty}>No hay plantillas disponibles todavía.</p>
          ) : (
            <div style={cp.tplGrid}>
              {p.templates.map((t: any) => (
                <div key={t.id} style={cp.tplCard} title={t.name}>
                  {t.cover_url
                    ? <img src={t.cover_url} alt={t.name} style={cp.tplImg} />
                    : <div style={cp.tplPlaceholder}>🎨</div>}
                  <div style={cp.tplName}>{t.name}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )

    case 'text':
      return (
        <>
          <PanelTitle title="Texto" />
          <div style={cp.stack}>
            {TEXT_PRESETS.map((preset) => (
              <button key={preset.label} style={cp.listBtn} onClick={() => p.addText(preset.opts)}>
                <span style={{ fontSize: Math.min(preset.opts.fontSize as number, 22), fontWeight: preset.opts.fontWeight as any }}>Ag</span>
                {preset.label}
              </button>
            ))}
          </div>
        </>
      )

    case 'image':
    case 'uploads':
      return (
        <>
          <PanelTitle title={p.tool === 'image' ? 'Imagen' : 'Cargas'} />
          <button style={cp.primaryBtn} onClick={() => p.fileInputRef.current?.click()} disabled={p.uploading}>
            {p.uploading ? 'Subiendo...' : '⬆ Subir imágenes'}
          </button>
          <p style={cp.hint}>Cada imagen subida se agrega como una nueva página del flipbook.</p>
        </>
      )

    case 'shapes':
      return (
        <>
          <PanelTitle title="Formas" />
          <div style={cp.shapeGrid}>
            <ShapeBtn icon="▭" label="Rectángulo" onClick={p.addRect} />
            <ShapeBtn icon="⬤" label="Círculo" onClick={p.addCircle} />
            <ShapeBtn icon="⬭" label="Elipse" onClick={p.addEllipse} />
            <ShapeBtn icon="▲" label="Triángulo" onClick={p.addTriangle} />
            <ShapeBtn icon="─" label="Línea" onClick={p.addLine} />
          </div>
        </>
      )

    case 'buttons':
      return (
        <>
          <PanelTitle title="Botones" />
          <div style={cp.btnGrid}>
            {BUTTON_PRESETS.map((label) => (
              <button key={label} style={cp.presetBtn} onClick={() => p.addButton(label)}>{label}</button>
            ))}
          </div>
        </>
      )

    case 'elements':
      return (
        <>
          <PanelTitle title="Elementos" />
          <div style={cp.shapeGrid}>
            <ShapeBtn icon="★" label="Estrella" onClick={p.addTriangle} />
            <ShapeBtn icon="●" label="Punto" onClick={p.addCircle} />
            <ShapeBtn icon="▬" label="Barra" onClick={p.addRect} />
          </div>
          <p style={cp.hint}>Biblioteca de elementos SVG. El Super Admin puede agregar más desde Recursos.</p>
        </>
      )

    case 'link':
      return (
        <>
          <PanelTitle title="Enlace" />
          <button style={cp.primaryBtn} onClick={p.addLinkZone}>+ Zona clicable</button>
          <p style={cp.hint}>Crea un área invisible sobre la página que abre una URL al hacer clic en el viewer.</p>
        </>
      )

    case 'widgets':
      return (
        <>
          <PanelTitle title="Widgets" />
          <div style={cp.shapeGrid}>
            {WIDGETS.map((w) => (
              <div key={w.label} style={{ ...cp.widgetCard, opacity: w.premium ? 0.6 : 1 }} title={w.premium ? 'Función premium' : ''}>
                <span style={{ fontSize: 22 }}>{w.icon}</span>
                <span style={cp.widgetLabel}>{w.label}</span>
                {w.premium && <span style={cp.crown}>👑</span>}
              </div>
            ))}
          </div>
          <p style={cp.hint}>Los widgets se integran en próximas fases.</p>
        </>
      )

    default:
      return null
  }
}

function PanelTitle({ title, count }: { title: string; count?: number }) {
  return (
    <div style={cp.title}>
      <span>{title}</span>
      {count !== undefined && <span style={cp.titleCount}>{count}</span>}
    </div>
  )
}

function ShapeBtn({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  const [hover, setHover] = React.useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...cp.shapeBtn, background: hover ? '#f1f5f9' : '#fff' }}
    >
      <span style={{ fontSize: 24 }}>{icon}</span>
      <span style={cp.shapeLabel}>{label}</span>
    </button>
  )
}

// ─── Configuración de página (panel derecho cuando no hay selección) ──────────
function PageConfig({ bgColor, applyBgColor }: { bgColor: string; applyBgColor: (c: string) => void }) {
  return (
    <div style={{ padding: 16, overflowY: 'auto' }}>
      <div style={s.rightHeader}>Configuración de página</div>

      <CfgGroup label="Tamaño de página">
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={cfg.sizeBox}><span style={cfg.sizeLabel}>A</span> 580</div>
          <div style={cfg.sizeBox}><span style={cfg.sizeLabel}>A</span> 820</div>
        </div>
      </CfgGroup>

      <CfgGroup label="Esquemas de color">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {COLOR_SCHEMES.map((sc) => (
            <div key={sc.name} style={cfg.scheme}>
              <div style={{ display: 'flex', gap: 3 }}>
                {sc.colors.map((c) => (
                  <span key={c} onClick={() => applyBgColor(c)} style={{ ...cfg.swatch, background: c }} />
                ))}
              </div>
              <span style={cfg.schemeName}>{sc.name}</span>
            </div>
          ))}
        </div>
      </CfgGroup>

      <CfgGroup label="Fondo">
        <input
          type="color"
          value={bgColor}
          onChange={(e) => applyBgColor(e.target.value)}
          style={{ width: '100%', height: 36, border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer' }}
        />
      </CfgGroup>
    </div>
  )
}

function CfgGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={cfg.groupLabel}>{label}</div>
      {children}
    </div>
  )
}

// ─── Panel de propiedades del elemento seleccionado ───────────────────────────
function PropsPanel({ obj, canvas }: { obj: any; canvas: any }) {
  const update = (props: any) => { obj.set(props); canvas?.renderAll() }
  const isText = obj instanceof fabric.Textbox || obj instanceof fabric.Text
  const fill = typeof obj.fill === 'string' ? obj.fill : '#000000'
  const isLink = (obj as any).data?.type === 'link'

  return (
    <div style={s.props}>
      <PropGroup label="Posición">
        <div style={{ display: 'grid', gridTemplateColumns: '16px 1fr 16px 1fr', gap: 4, alignItems: 'center' }}>
          <span style={s.axisLabel}>X</span>
          <input style={s.propInput} type="number" defaultValue={Math.round(obj.left ?? 0)} onChange={(e) => update({ left: +e.target.value })} />
          <span style={s.axisLabel}>Y</span>
          <input style={s.propInput} type="number" defaultValue={Math.round(obj.top ?? 0)} onChange={(e) => update({ top: +e.target.value })} />
        </div>
      </PropGroup>

      <PropGroup label="Opacidad">
        <input type="range" min={0} max={1} step={0.05} defaultValue={obj.opacity ?? 1} onChange={(e) => update({ opacity: +e.target.value })} style={{ width: '100%' }} />
      </PropGroup>

      <PropGroup label="Color">
        <input type="color" defaultValue={fill.startsWith('#') ? fill : '#4f46e5'} onChange={(e) => update({ fill: e.target.value })} style={{ width: '100%', height: 34, border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer' }} />
      </PropGroup>

      {isText && (
        <>
          <PropGroup label="Texto">
            <textarea style={{ ...s.propInput, height: 60, resize: 'vertical' } as any} defaultValue={(obj as any).text ?? ''} onChange={(e) => { (obj as any).set('text', e.target.value); canvas?.renderAll() }} />
          </PropGroup>
          <PropGroup label="Tamaño de fuente">
            <input style={s.propInput} type="number" min={8} max={120} defaultValue={(obj as any).fontSize ?? 24} onChange={(e) => update({ fontSize: +e.target.value })} />
          </PropGroup>
          <PropGroup label="Negrita">
            <input type="checkbox" defaultChecked={(obj as any).fontWeight === 'bold'} onChange={(e) => update({ fontWeight: e.target.checked ? 'bold' : 'normal' })} />
          </PropGroup>
        </>
      )}

      {isLink && (
        <PropGroup label="URL del enlace">
          <input style={s.propInput} defaultValue={(obj as any).data?.url ?? ''} onChange={(e) => { (obj as any).data = { ...((obj as any).data ?? {}), url: e.target.value } }} />
        </PropGroup>
      )}

      <button style={s.deleteBtn} onClick={() => { canvas?.remove(obj); canvas?.renderAll() }}>Eliminar elemento</button>
    </div>
  )
}

function PropGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 8, borderBottom: '1px solid #f3f4f6' }}>
      <span style={s.propLabel}>{label}</span>
      {children}
    </div>
  )
}

// ─── Estilos ──────────────────────────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  root:    { display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', fontFamily: 'Inter, system-ui, sans-serif' },
  loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#6b7280', fontSize: 15 },

  topBar:   { display: 'flex', alignItems: 'center', height: 52, padding: '0 16px', background: '#1e1b4b', flexShrink: 0 },
  topLeft:  { display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  topCenter:{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 120, flexShrink: 0 },
  topRight: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 },
  backLink: { color: 'rgba(255,255,255,0.7)', fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 },
  pubTitle: { fontWeight: 700, fontSize: 14, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  breadcrumb: { fontSize: 13, color: 'rgba(255,255,255,0.65)', fontWeight: 500 },
  msg:       { fontSize: 12, color: '#86efac', fontWeight: 500, whiteSpace: 'nowrap' },
  btnOutlineWhite: { background: 'transparent', border: '1px solid rgba(255,255,255,0.4)', color: '#fff', borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500 },
  btnPublish: { border: 'none', color: '#fff', borderRadius: 6, padding: '6px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600 },

  body: { display: 'flex', flex: 1, overflow: 'hidden' },

  rail:    { width: 64, minWidth: 64, background: '#1a1827', display: 'flex', flexDirection: 'column', padding: '6px 0', overflowY: 'auto' },
  railBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', padding: '10px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, borderLeft: '3px solid transparent' },
  railBtnActive: { color: '#fff', background: 'rgba(129,140,248,0.15)', borderLeftColor: '#818cf8' },
  railIcon: { fontSize: 18, lineHeight: 1 },
  railLabel:{ fontSize: 9, fontWeight: 500 },

  panel: { width: 264, minWidth: 264, background: '#fff', borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', padding: 12, overflowY: 'auto' },

  center:    { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#e8eaed' },
  toolbar:   { display: 'flex', alignItems: 'center', gap: 4, padding: '0 12px', height: 44, background: '#fff', borderBottom: '1px solid #e5e7eb', flexShrink: 0 },
  toolBtn:   { background: 'none', border: '1px solid transparent', borderRadius: 8, width: 36, height: 36, cursor: 'pointer', fontSize: 15, color: '#374151' },
  toolSep:   { width: 1, height: 20, background: '#e5e7eb', margin: '0 6px' },
  zoomGroup: { display: 'flex', gap: 2 },
  zoomBtn:   { background: 'none', border: '1px solid transparent', borderRadius: 12, padding: '3px 9px', fontSize: 11, cursor: 'pointer', color: '#6b7280', fontWeight: 500 },
  zoomActive:{ background: '#f3f4f6', borderColor: '#e5e7eb', color: '#111827', fontWeight: 600 },
  savePgBtn: { background: '#f3f4f6', border: '1px solid #e5e7eb', color: '#374151', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 500 },
  canvasWrap:  { flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: 32, alignItems: 'flex-start' },
  canvasEmpty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%', cursor: 'pointer', borderRadius: 12, transition: 'background 0.2s' },

  right:      { width: 280, minWidth: 280, background: '#fff', borderLeft: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  rightHeader:{ fontSize: 13, fontWeight: 700, color: '#111827', padding: '14px 0 10px', borderBottom: '1px solid #f3f4f6', marginBottom: 4 },

  props:     { padding: '8px 16px 16px', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' },
  propLabel: { fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  propInput: { border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box' as const },
  axisLabel: { fontSize: 11, color: '#9ca3af', textAlign: 'center' as const },
  deleteBtn: { background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', width: '100%', fontSize: 13, marginTop: 8 },
}

const cp: Record<string, React.CSSProperties> = {
  title:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 12 },
  titleCount: { fontSize: 11, color: '#6b7280', background: '#f3f4f6', borderRadius: 10, padding: '1px 7px' },
  thumbList:  { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12, borderRadius: 8 },
  thumbItem:  { position: 'relative', cursor: 'pointer', borderRadius: 6, overflow: 'hidden', border: '2px solid transparent', transition: 'border-color .15s' },
  thumbImg:   { width: '100%', aspectRatio: '0.707', objectFit: 'cover' as const, display: 'block' },
  thumbNum:   { position: 'absolute', bottom: 4, left: 6, background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3 },
  thumbDel:   { position: 'absolute', top: 4, right: 4, background: 'rgba(239,68,68,0.9)', color: '#fff', border: 'none', borderRadius: 4, fontSize: 11, width: 20, height: 20, cursor: 'pointer', padding: 0 },
  primaryBtn: { width: '100%', background: '#4F46E5', color: '#fff', border: 'none', borderRadius: 8, padding: '10px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  search:     { width: '100%', boxSizing: 'border-box' as const, border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px', fontSize: 13, marginBottom: 12 },
  empty:      { fontSize: 12, color: '#9ca3af', textAlign: 'center' as const, padding: '20px 0' },
  hint:       { fontSize: 11, color: '#9ca3af', marginTop: 10, lineHeight: 1.5 },
  tplGrid:    { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  tplCard:    { border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', cursor: 'pointer' },
  tplImg:     { width: '100%', aspectRatio: '0.707', objectFit: 'cover' as const, display: 'block' },
  tplPlaceholder: { width: '100%', aspectRatio: '0.707', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, background: '#f8fafc' },
  tplName:    { fontSize: 11, padding: '6px 8px', color: '#374151', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },
  stack:      { display: 'flex', flexDirection: 'column', gap: 8 },
  listBtn:    { display: 'flex', alignItems: 'center', gap: 10, width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px', background: '#fff', cursor: 'pointer', fontSize: 13, color: '#374151', textAlign: 'left' as const },
  shapeGrid:  { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  shapeBtn:   { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, height: 72, border: '1px solid #e5e7eb', borderRadius: 8, cursor: 'pointer', color: '#374151' },
  shapeLabel: { fontSize: 11, color: '#6b7280' },
  btnGrid:    { display: 'flex', flexDirection: 'column', gap: 6 },
  presetBtn:  { width: '100%', background: '#4F46E5', color: '#fff', border: 'none', borderRadius: 23, padding: '8px', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  widgetCard: { position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, height: 72, border: '1px solid #e5e7eb', borderRadius: 8 },
  widgetLabel:{ fontSize: 10, color: '#6b7280', textAlign: 'center' as const, lineHeight: 1.2 },
  crown:      { position: 'absolute', top: 4, right: 4, fontSize: 11 },
}

const cfg: Record<string, React.CSSProperties> = {
  groupLabel: { fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 8 },
  sizeBox:    { flex: 1, border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 10px', fontSize: 13, color: '#374151', display: 'flex', alignItems: 'center', gap: 6 },
  sizeLabel:  { fontSize: 10, color: '#9ca3af', fontWeight: 700 },
  scheme:     { display: 'flex', alignItems: 'center', gap: 8, padding: 6, border: '1px solid #f3f4f6', borderRadius: 8 },
  swatch:     { width: 18, height: 18, borderRadius: 4, cursor: 'pointer', display: 'inline-block' },
  schemeName: { fontSize: 11, color: '#6b7280' },
}
