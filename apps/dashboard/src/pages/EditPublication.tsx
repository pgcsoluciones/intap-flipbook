import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
// @ts-ignore
import { fabric } from 'fabric'
import { api } from '../lib/api'

// ─── Iconos SVG monocromáticos (estilo línea, 20px, stroke uniforme) ──────────
// "stroke" = trazo. Todos comparten grosor 1.6 y currentColor para mantener
// consistencia visual en toda la barra de herramientas.
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const p: React.SVGProps<SVGSVGElement> = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
  }
  switch (name) {
    case 'pages':     return <svg {...p}><rect x="4" y="3" width="13" height="18" rx="2"/><path d="M20 7v12a2 2 0 0 1-2 2H8"/></svg>
    case 'templates': return <svg {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
    case 'text':      return <svg {...p}><path d="M5 5h14M12 5v14M9 19h6"/></svg>
    case 'image':     return <svg {...p}><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m3 17 5-4 4 3 3-3 6 5"/></svg>
    case 'shapes':    return <svg {...p}><circle cx="8" cy="8" r="4.5"/><rect x="12" y="12" width="8" height="8" rx="1.5"/></svg>
    case 'buttons':   return <svg {...p}><rect x="3" y="8" width="18" height="8" rx="4"/><path d="M8 12h8"/></svg>
    case 'elements':  return <svg {...p}><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"/></svg>
    case 'link':      return <svg {...p}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>
    case 'widgets':   return <svg {...p}><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg>
    case 'uploads':   return <svg {...p}><path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/></svg>
    case 'trash':     return <svg {...p}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13"/></svg>
    case 'duplicate': return <svg {...p}><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/></svg>
    case 'front':     return <svg {...p}><rect x="7" y="7" width="10" height="10" rx="1"/><path d="M3 12h2M19 12h2M12 3v2M12 19v2"/></svg>
    case 'back':      return <svg {...p}><rect x="4" y="4" width="10" height="10" rx="1"/><rect x="10" y="10" width="10" height="10" rx="1"/></svg>
    case 'chevron':   return <svg {...p}><path d="m9 6 6 6-6 6"/></svg>
    case 'plus':      return <svg {...p}><path d="M12 5v14M5 12h14"/></svg>
    case 'rect':      return <svg {...p}><rect x="4" y="6" width="16" height="12" rx="1.5"/></svg>
    case 'circle':    return <svg {...p}><circle cx="12" cy="12" r="8"/></svg>
    case 'triangle':  return <svg {...p}><path d="M12 4 21 20H3z"/></svg>
    case 'line':      return <svg {...p}><path d="M4 18 20 6"/></svg>
    case 'star':      return <svg {...p}><path d="M12 3l2.7 5.5 6 .9-4.3 4.2 1 6L12 17.8 6.6 19.6l1-6L3.3 9.4l6-.9z"/></svg>
    case 'arrow':     return <svg {...p}><path d="M4 12h14M13 6l6 6-6 6"/></svg>
    case 'badge':     return <svg {...p}><circle cx="12" cy="9" r="6"/><path d="m8 14-1 7 5-3 5 3-1-7"/></svg>
    default:          return <svg {...p}><circle cx="12" cy="12" r="8"/></svg>
  }
}

// ─── Herramientas de la barra lateral (icon rail) ─────────────────────────────
type ToolKey =
  | 'pages' | 'templates' | 'text' | 'image'
  | 'shapes' | 'buttons' | 'elements' | 'link' | 'widgets' | 'uploads'

const RAIL: { key: ToolKey; label: string }[] = [
  { key: 'pages',     label: 'Páginas' },
  { key: 'templates', label: 'Plantilla' },
  { key: 'text',      label: 'Texto' },
  { key: 'image',     label: 'Imagen' },
  { key: 'shapes',    label: 'Formas' },
  { key: 'buttons',   label: 'Botones' },
  { key: 'elements',  label: 'Elementos' },
  { key: 'link',      label: 'Enlace' },
  { key: 'widgets',   label: 'Widgets' },
  { key: 'uploads',   label: 'Cargas' },
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
  { label: 'Agregar Título',    sample: 'Título',          opts: { fontSize: 44, fontWeight: 'bold' as const } },
  { label: 'Agregar Subtítulo', sample: 'Subtítulo',       opts: { fontSize: 28, fontWeight: 600 as any } },
  { label: 'Texto Principal',   sample: 'Cuerpo de texto', opts: { fontSize: 18, fontWeight: 'normal' as const } },
  { label: 'Texto pequeño',     sample: 'Pie de página',   opts: { fontSize: 13, fontWeight: 'normal' as const } },
]

// Botones prediseñados con estilo coherente (relleno / contorno / texto)
const BUTTON_PRESETS: { label: string; variant: 'solid' | 'outline' | 'pill' }[] = [
  { label: 'Comprar Ahora',  variant: 'solid' },
  { label: 'Contáctanos',    variant: 'solid' },
  { label: 'Aprender Más',   variant: 'outline' },
  { label: 'Regístrate',     variant: 'pill' },
  { label: 'Iniciar Sesión', variant: 'outline' },
  { label: 'Reproducir',     variant: 'solid' },
]

// Tipos de acción de un botón (qué ocurre al hacer clic en el viewer)
type ActionType = 'link' | 'page' | 'call' | 'email' | 'popup_text' | 'popup_image' | 'show_hide'
const ACTION_TYPES: { type: ActionType; label: string; icon: string }[] = [
  { type: 'link',        label: 'Abrir Enlace',     icon: 'link' },
  { type: 'page',        label: 'Ir a Página',      icon: 'pages' },
  { type: 'call',        label: 'Llamar',           icon: 'badge' },
  { type: 'email',       label: 'Email',            icon: 'text' },
  { type: 'popup_text',  label: 'Texto emergente',  icon: 'text' },
  { type: 'popup_image', label: 'Imagen emergente', icon: 'image' },
  { type: 'show_hide',   label: 'Mostrar/Ocultar',  icon: 'elements' },
]

const WIDGETS = [
  { label: 'Mapa', premium: false },
  { label: 'Tabla', premium: false },
  { label: 'Código QR', premium: false },
  { label: 'Me gusta', premium: false },
  { label: 'Incrustar terceros', premium: true },
  { label: 'Cuestionario', premium: true },
]

export default function EditPublication() {
  const { id } = useParams<{ id: string }>()
  const [pub, setPub]       = useState<any>(null)
  const [pages, setPages]   = useState<any[]>([])
  const [activePage, setActivePage] = useState<any>(null)
  const [uploading, setUploading]   = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [selected, setSelected] = useState<any>(null)
  const [selectVersion, setSelectVersion] = useState(0) // fuerza refresco del panel de props
  const [zoom, setZoom]   = useState(100)

  // Estado de autoguardado: 'idle' | 'saving' | 'saved'
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')

  const [activeTool, setActiveTool] = useState<ToolKey>('pages')
  const [panelOpen, setPanelOpen]   = useState(true)
  const [templates, setTemplates]   = useState<any[]>([])
  const [tplQuery, setTplQuery]     = useState('')
  const [bgColor, setBgColor]       = useState('#ffffff')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<any>(null)
  const pageIdRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)      // para agregar PÁGINAS nuevas
  const imgInputRef  = useRef<HTMLInputElement>(null)      // para insertar imagen como ELEMENTO del canvas
  const autosaveTimer = useRef<any>(null)
  const savedFlashTimer = useRef<any>(null)

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

  // ── Autoguardado: guarda el canvas actual en segundo plano ──
  // Se llama tras cada cambio (debounce) y al cambiar de página.
  const persistCanvas = useCallback(async (pageId: string, canvas: any, flash = true) => {
    if (!pageId || !canvas) return
    setSaveState('saving')
    try {
      const json = JSON.stringify(canvas.toJSON(['data']))
      await api.pages.saveCanvas(pageId, json)
      setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, canvas_json: json } : p)))
      if (flash) {
        setSaveState('saved')
        clearTimeout(savedFlashTimer.current)
        savedFlashTimer.current = setTimeout(() => setSaveState('idle'), 1800)
      } else {
        setSaveState('idle')
      }
    } catch {
      setSaveState('idle')
    }
  }, [])

  // Programa un guardado diferido (1.2s tras el último cambio)
  const scheduleAutosave = useCallback(() => {
    if (!pageIdRef.current) return
    clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(() => {
      if (fabricRef.current && pageIdRef.current) persistCanvas(pageIdRef.current, fabricRef.current)
    }, 1200)
  }, [persistCanvas])

  // ── Inicialización del canvas Fabric.js por página ──
  useEffect(() => {
    if (!activePage || !canvasRef.current) return

    // Guarda la página anterior ANTES de cambiar (no perder trabajo)
    if (fabricRef.current && pageIdRef.current && pageIdRef.current !== activePage.id) {
      clearTimeout(autosaveTimer.current)
      persistCanvas(pageIdRef.current, fabricRef.current, false)
    }
    pageIdRef.current = activePage.id
    if (fabricRef.current) { fabricRef.current.dispose(); fabricRef.current = null }
    setSelected(null)

    const W = 580
    const H = Math.round(W * 1.414)
    const canvas = new fabric.Canvas(canvasRef.current, { width: W, height: H, backgroundColor: bgColor, preserveObjectStacking: true })
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

    const onSel = (e: any) => { setSelected(e.selected?.[0] ?? canvas.getActiveObject() ?? null); setSelectVersion((v) => v + 1) }
    canvas.on('selection:created', onSel)
    canvas.on('selection:updated', onSel)
    canvas.on('selection:cleared', () => setSelected(null))

    // Autoguardado en cada cambio del lienzo
    const onChange = () => scheduleAutosave()
    canvas.on('object:modified', onChange)
    canvas.on('object:added', onChange)
    canvas.on('object:removed', onChange)
    canvas.on('text:changed', onChange)

    return () => {
      if (fabricRef.current) {
        clearTimeout(autosaveTimer.current)
        persistCanvas(activePage.id, fabricRef.current, false)
        fabricRef.current.dispose()
        fabricRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage?.id])

  // Guarda al cerrar/recargar la pestaña
  useEffect(() => {
    const handler = () => {
      if (fabricRef.current && pageIdRef.current) {
        try {
          const json = JSON.stringify(fabricRef.current.toJSON(['data']))
          api.pages.saveCanvas(pageIdRef.current, json).catch(() => {})
        } catch {}
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  function refreshSelected() { setSelectVersion((v) => v + 1) }

  // ── Elementos del canvas ──
  function addText(opts: any = {}) {
    const c = fabricRef.current; if (!c) return
    const t = new fabric.Textbox(opts.sample ?? 'Texto aquí', {
      left: 60, top: 60, width: 240, fontSize: 24, fill: '#111827',
      fontFamily: 'Inter, sans-serif', data: { kind: 'text' }, ...opts,
    })
    c.add(t); c.setActiveObject(t); c.requestRenderAll()
  }
  function addShape(kind: 'rect' | 'circle' | 'ellipse' | 'triangle' | 'line' | 'star') {
    const c = fabricRef.current; if (!c) return
    let o: any
    const common = { left: 100, top: 100, fill: 'rgba(79,70,229,0.85)', data: { kind: 'shape' } }
    if (kind === 'rect') o = new fabric.Rect({ ...common, width: 160, height: 90, rx: 8, ry: 8 })
    else if (kind === 'circle') o = new fabric.Circle({ ...common, radius: 60 })
    else if (kind === 'ellipse') o = new fabric.Ellipse({ ...common, rx: 90, ry: 55 })
    else if (kind === 'triangle') o = new fabric.Triangle({ ...common, width: 120, height: 100 })
    else if (kind === 'line') o = new fabric.Line([0, 0, 250, 0], { ...common, stroke: '#111827', strokeWidth: 3, fill: '' })
    else {
      // estrella de 5 puntas
      const pts: { x: number; y: number }[] = []
      const spikes = 5, outer = 60, inner = 26
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? outer : inner
        const a = (Math.PI / spikes) * i - Math.PI / 2
        pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r })
      }
      o = new fabric.Polygon(pts, { ...common, fill: '#F59E0B' })
    }
    c.add(o); c.setActiveObject(o); c.requestRenderAll()
  }

  // Crea un botón con texto + estilo coherente y una acción por defecto (enlace)
  function addButton(preset: { label: string; variant: 'solid' | 'outline' | 'pill' }) {
    const c = fabricRef.current; if (!c) return
    const accent = '#4F46E5'
    const radius = preset.variant === 'pill' ? 23 : 8
    const isOutline = preset.variant === 'outline'
    const rect = new fabric.Rect({
      width: 180, height: 46,
      fill: isOutline ? 'rgba(255,255,255,0)' : accent,
      stroke: isOutline ? accent : '',
      strokeWidth: isOutline ? 2 : 0,
      rx: radius, ry: radius, originX: 'center', originY: 'center',
    })
    const txt = new fabric.Text(preset.label, {
      fill: isOutline ? accent : '#fff', fontSize: 15,
      fontFamily: 'Inter, sans-serif', fontWeight: 'bold',
      originX: 'center', originY: 'center',
    })
    const btn = new fabric.Group([rect, txt], {
      left: 110, top: 130,
      data: {
        kind: 'button',
        label: preset.label,
        bg: accent, textColor: isOutline ? accent : '#fff',
        variant: preset.variant,
        action: { type: 'link' as ActionType, url: 'https://' },
      },
    })
    c.add(btn); c.setActiveObject(btn); c.requestRenderAll()
    setActiveTool('buttons')
  }

  // Inserta la imagen como un objeto editable Fabric sobre el canvas actual (NO crea página nueva)
  async function addImageElement(file: File) {
    const c = fabricRef.current; if (!c) return
    setUploading(true)
    try {
      const up = await api.upload(file)
      if (!up.success) throw new Error('Upload falló')
      fabric.Image.fromURL(up.data.url, (img: any) => {
        // Escala la imagen para que no ocupe más del 60 % del ancho del canvas
        const maxW = c.getWidth() * 0.6
        if (img.width > maxW) img.scaleToWidth(maxW)
        img.set({ left: 60, top: 60, data: { kind: 'image', src: up.data.url } })
        c.add(img); c.setActiveObject(img); c.requestRenderAll()
        scheduleAutosave()
      })
    } finally { setUploading(false) }
  }
  async function handleImgInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    for (const file of files) await addImageElement(file)
  }

  function addLinkZone() {
    const c = fabricRef.current; if (!c) return
    const zone = new fabric.Rect({
      left: 80, top: 80, width: 180, height: 100,
      fill: 'rgba(79,70,229,0.15)', stroke: '#4F46E5', strokeDashArray: [6, 4], strokeWidth: 2,
      data: { kind: 'linkzone', action: { type: 'link' as ActionType, url: 'https://' } },
    })
    c.add(zone); c.setActiveObject(zone); c.requestRenderAll()
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

  function applyBgColor(color: string, all = false) {
    setBgColor(color)
    const c = fabricRef.current
    if (c) { c.setBackgroundColor(color, c.renderAll.bind(c)); scheduleAutosave() }
    if (all) {
      // Aplica a todas las páginas (solo visual local; cada página lo persiste al abrirse)
      setPages((prev) => prev.map((p) => ({ ...p, bg_color: color })))
    }
  }

  async function handlePublish() {
    setPublishing(true)
    if (fabricRef.current && pageIdRef.current) await persistCanvas(pageIdRef.current, fabricRef.current, false)
    try {
      const res = await api.publications.publish(id!)
      setPub(res.data)
    } finally { setPublishing(false) }
  }

  function deleteSelected() {
    const c = fabricRef.current
    const o = c?.getActiveObject()
    if (o) { c!.remove(o); setSelected(null) }
  }
  function duplicateSelected() {
    const c = fabricRef.current
    const o = c?.getActiveObject()
    if (!o) return
    o.clone((clone: any) => {
      clone.set({ left: (o.left ?? 0) + 20, top: (o.top ?? 0) + 20 })
      c!.add(clone); c!.setActiveObject(clone); c!.requestRenderAll()
    }, ['data'])
  }
  function bringToFront() { const o = fabricRef.current?.getActiveObject(); if (o) { o.bringToFront(); fabricRef.current.requestRenderAll(); scheduleAutosave() } }
  function sendToBack() { const o = fabricRef.current?.getActiveObject(); if (o) { o.sendToBack(); fabricRef.current.requestRenderAll(); scheduleAutosave() } }

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
          <span style={s.saveInd}>
            {saveState === 'saving' ? '⟳ Guardando…' : saveState === 'saved' ? '✓ Guardado' : 'Autoguardado activo'}
          </span>
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
          {RAIL.map((t) => {
            const active = activeTool === t.key && panelOpen
            return (
              <button
                key={t.key}
                onClick={() => selectTool(t.key)}
                title={t.label}
                style={{ ...s.railBtn, ...(active ? s.railBtnActive : {}) }}
              >
                <Icon name={t.key} />
                <span style={s.railLabel}>{t.label}</span>
              </button>
            )
          })}
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
              addShape={addShape}
              addButton={addButton}
              addLinkZone={addLinkZone}
              imgInputRef={imgInputRef}
              uploadingImg={uploading}
            />
          </aside>
        )}

        {/* ── Canvas central ── */}
        <main style={s.center}>
          <div style={s.toolbar}>
            <ToolbarBtn icon="trash"     title="Eliminar"          onClick={deleteSelected}   disabled={!selected} />
            <ToolbarBtn icon="duplicate" title="Duplicar"          onClick={duplicateSelected} disabled={!selected} />
            <div style={s.toolSep} />
            <ToolbarBtn icon="front"     title="Traer al frente"   onClick={bringToFront}     disabled={!selected} />
            <ToolbarBtn icon="back"      title="Enviar al fondo"   onClick={sendToBack}       disabled={!selected} />
            <div style={{ flex: 1 }} />
            <div style={s.zoomGroup}>
              {[50, 75, 100, 125].map((z) => (
                <button key={z} style={{ ...s.zoomBtn, ...(zoom === z ? s.zoomActive : {}) }} onClick={() => setZoom(z)}>
                  {z}%
                </button>
              ))}
            </div>
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
                <div style={{ marginBottom: 16, opacity: 0.35, color: '#374151' }}><Icon name="image" size={52} /></div>
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
            <PropsPanel
              key={selectVersion}
              obj={selected}
              canvas={fabricRef.current}
              pages={pages}
              onChange={() => { scheduleAutosave(); refreshSelected() }}
            />
          ) : (
            <PageConfig bgColor={bgColor} applyBgColor={applyBgColor} />
          )}
        </aside>
      </div>

      {/* Input para insertar imagen como elemento editable del canvas */}
      <input
        ref={imgInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        style={{ display: 'none' }}
        onChange={handleImgInputChange}
      />
      {/* Input para agregar páginas nuevas al flipbook */}
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

function ToolbarBtn({ icon, title, onClick, disabled }: { icon: string; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button style={{ ...s.toolBtn, opacity: disabled ? 0.35 : 1, cursor: disabled ? 'default' : 'pointer' }} title={title} onClick={onClick} disabled={disabled}>
      <Icon name={icon} size={18} />
    </button>
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
                    : <div style={cp.tplPlaceholder}><Icon name="templates" size={26} /></div>}
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
                <span style={{ fontSize: Math.min(preset.opts.fontSize as number, 22), fontWeight: preset.opts.fontWeight as any }}>Aa</span>
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
          {/* Insertar como elemento editable (NO crea página) */}
          <button style={cp.primaryBtn} onClick={() => p.imgInputRef.current?.click()} disabled={p.uploadingImg}>
            {p.uploadingImg ? 'Subiendo...' : 'Insertar imagen en la página'}
          </button>
          <p style={cp.hint}>La imagen se agrega como elemento editable sobre la página actual. Podés moverla, escalarla y asignarle una acción.</p>
          <div style={{ height: 1, background: '#f3f4f6', margin: '14px 0' }} />
          {/* Agregar como nueva página del flipbook */}
          <button style={{ ...cp.primaryBtn, background: '#64748b' }} onClick={() => p.fileInputRef.current?.click()} disabled={p.uploading}>
            {p.uploading ? 'Subiendo...' : '+ Agregar como nueva página'}
          </button>
          <p style={cp.hint}>Agrega la imagen como página nueva del flipbook (igual que en el panel Páginas).</p>
        </>
      )

    case 'shapes':
      return (
        <>
          <PanelTitle title="Formas" />
          <div style={cp.shapeGrid}>
            <ShapeBtn icon="rect"     label="Rectángulo" onClick={() => p.addShape('rect')} />
            <ShapeBtn icon="circle"   label="Círculo"    onClick={() => p.addShape('circle')} />
            <ShapeBtn icon="circle"   label="Elipse"     onClick={() => p.addShape('ellipse')} />
            <ShapeBtn icon="triangle" label="Triángulo"  onClick={() => p.addShape('triangle')} />
            <ShapeBtn icon="line"     label="Línea"      onClick={() => p.addShape('line')} />
            <ShapeBtn icon="star"     label="Estrella"   onClick={() => p.addShape('star')} />
          </div>
        </>
      )

    case 'buttons':
      return (
        <>
          <PanelTitle title="Botones" />
          <p style={cp.hint}>Agrega un botón y configura su acción y estilo en el panel derecho.</p>
          <div style={cp.btnList}>
            {BUTTON_PRESETS.map((b) => (
              <button
                key={b.label}
                style={{
                  ...cp.previewBtn,
                  ...(b.variant === 'outline'
                    ? { background: '#fff', color: '#4F46E5', border: '2px solid #4F46E5' }
                    : { background: '#4F46E5', color: '#fff', border: 'none' }),
                  borderRadius: b.variant === 'pill' ? 23 : 8,
                }}
                onClick={() => p.addButton(b)}
              >
                {b.label}
              </button>
            ))}
          </div>
        </>
      )

    case 'elements':
      return (
        <>
          <PanelTitle title="Elementos" />
          <div style={cp.shapeGrid}>
            <ShapeBtn icon="star"     label="Estrella" onClick={() => p.addShape('star')} />
            <ShapeBtn icon="circle"   label="Punto"    onClick={() => p.addShape('circle')} />
            <ShapeBtn icon="rect"     label="Barra"    onClick={() => p.addShape('rect')} />
            <ShapeBtn icon="triangle" label="Flecha"   onClick={() => p.addShape('triangle')} />
          </div>
          <p style={cp.hint}>Biblioteca de elementos. El Super Admin puede agregar más desde Recursos.</p>
        </>
      )

    case 'link':
      return (
        <>
          <PanelTitle title="Enlace" />
          <button style={cp.primaryBtn} onClick={p.addLinkZone}>+ Zona clicable</button>
          <p style={cp.hint}>Crea un área transparente sobre la página. Selecciónala y define su acción en el panel derecho (enlace, ir a página, llamar, etc.).</p>
        </>
      )

    case 'widgets':
      return (
        <>
          <PanelTitle title="Widgets" />
          <div style={cp.shapeGrid}>
            {WIDGETS.map((w) => (
              <div key={w.label} style={{ ...cp.widgetCard, opacity: w.premium ? 0.55 : 1 }} title={w.premium ? 'Función premium' : ''}>
                <Icon name="widgets" size={20} />
                <span style={cp.widgetLabel}>{w.label}</span>
                {w.premium && <span style={cp.crown}>★</span>}
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
      <Icon name={icon} size={24} />
      <span style={cp.shapeLabel}>{label}</span>
    </button>
  )
}

// ─── Configuración de página (panel derecho cuando no hay selección) ──────────
function PageConfig({ bgColor, applyBgColor }: { bgColor: string; applyBgColor: (c: string, all?: boolean) => void }) {
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
        <button style={cfg.applyAll} onClick={() => applyBgColor(bgColor, true)}>Aplicar a todas las páginas</button>
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
// Cambia según el tipo: texto, forma, botón, imagen o zona de enlace.
function PropsPanel({ obj, canvas, pages, onChange }: { obj: any; canvas: any; pages: any[]; onChange: () => void }) {
  const kind: string = (obj as any).data?.kind
    ?? (obj instanceof fabric.Textbox || obj instanceof fabric.Text ? 'text' : 'shape')

  const set = (props: any) => { obj.set(props); canvas?.requestRenderAll(); onChange() }
  const setData = (patch: any) => { (obj as any).data = { ...((obj as any).data ?? {}), ...patch }; onChange() }

  const fill = typeof obj.fill === 'string' ? obj.fill : '#4f46e5'
  const titleMap: Record<string, string> = { text: 'Texto', shape: 'Forma', button: 'Botón', linkzone: 'Zona de enlace', image: 'Imagen' }

  return (
    <div style={s.propsScroll}>
      <div style={s.rightHeader}>{titleMap[kind] ?? 'Elemento'}</div>
      <div style={s.props}>

        {/* Posición y tamaño — común a todos */}
        <PropGroup label="Posición">
          <div style={{ display: 'grid', gridTemplateColumns: '16px 1fr 16px 1fr', gap: 6, alignItems: 'center' }}>
            <span style={s.axisLabel}>X</span>
            <input style={s.propInput} type="number" defaultValue={Math.round(obj.left ?? 0)} onChange={(e) => set({ left: +e.target.value })} />
            <span style={s.axisLabel}>Y</span>
            <input style={s.propInput} type="number" defaultValue={Math.round(obj.top ?? 0)} onChange={(e) => set({ top: +e.target.value })} />
          </div>
        </PropGroup>

        <PropGroup label="Opacidad">
          <input type="range" min={0} max={1} step={0.05} defaultValue={obj.opacity ?? 1} onChange={(e) => set({ opacity: +e.target.value })} style={{ width: '100%' }} />
        </PropGroup>

        {/* ── TEXTO ── */}
        {kind === 'text' && (
          <>
            <PropGroup label="Contenido">
              <textarea style={{ ...s.propInput, height: 64, resize: 'vertical' } as any} defaultValue={(obj as any).text ?? ''} onChange={(e) => { (obj as any).set('text', e.target.value); canvas?.requestRenderAll(); onChange() }} />
            </PropGroup>
            <PropGroup label="Tamaño de fuente">
              <input style={s.propInput} type="number" min={8} max={160} defaultValue={(obj as any).fontSize ?? 24} onChange={(e) => set({ fontSize: +e.target.value })} />
            </PropGroup>
            <PropGroup label="Estilo">
              <div style={{ display: 'flex', gap: 6 }}>
                <StyleToggle active={(obj as any).fontWeight === 'bold'} onClick={() => set({ fontWeight: (obj as any).fontWeight === 'bold' ? 'normal' : 'bold' })} label="B" bold />
                <StyleToggle active={(obj as any).fontStyle === 'italic'} onClick={() => set({ fontStyle: (obj as any).fontStyle === 'italic' ? 'normal' : 'italic' })} label="I" italic />
                <StyleToggle active={(obj as any).underline} onClick={() => set({ underline: !(obj as any).underline })} label="U" underline />
              </div>
            </PropGroup>
            <PropGroup label="Alineación">
              <div style={{ display: 'flex', gap: 6 }}>
                {['left', 'center', 'right'].map((a) => (
                  <button key={a} style={{ ...s.alignBtn, ...((obj as any).textAlign === a ? s.alignActive : {}) }} onClick={() => set({ textAlign: a })}>
                    {a === 'left' ? '⟸' : a === 'center' ? '≡' : '⟹'}
                  </button>
                ))}
              </div>
            </PropGroup>
            <PropGroup label="Color de texto">
              <input type="color" defaultValue={fill.startsWith('#') ? fill : '#111827'} onChange={(e) => set({ fill: e.target.value })} style={s.colorInput} />
            </PropGroup>
          </>
        )}

        {/* ── FORMA ── */}
        {kind === 'shape' && (
          <>
            <PropGroup label="Color de relleno">
              <input type="color" defaultValue={fill.startsWith('#') ? fill : '#4f46e5'} onChange={(e) => set({ fill: e.target.value })} style={s.colorInput} />
            </PropGroup>
            <PropGroup label="Borde">
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="color" defaultValue={(typeof obj.stroke === 'string' && obj.stroke) || '#111827'} onChange={(e) => set({ stroke: e.target.value })} style={{ ...s.colorInput, width: 48 }} />
                <input style={s.propInput} type="number" min={0} max={20} defaultValue={obj.strokeWidth ?? 0} onChange={(e) => set({ strokeWidth: +e.target.value })} placeholder="Grosor" />
              </div>
            </PropGroup>
          </>
        )}

        {/* ── BOTÓN: estilo visual + acción ── */}
        {kind === 'button' && (
          <ButtonProps obj={obj} canvas={canvas} pages={pages} setData={setData} onChange={onChange} />
        )}

        {/* ── IMAGEN: sugerencia de uso ── */}
        {kind === 'image' && (
          <PropGroup label="Imagen">
            <p style={cp.hint}>Usa las esquinas para redimensionar y rotar. Asigna una acción abajo.</p>
          </PropGroup>
        )}

        {/* ── ACCIÓN: disponible para TODOS los elementos que no sean botón
            (el botón ya incluye su propio ActionEditor dentro de ButtonProps) ── */}
        {kind !== 'button' && (
          <>
            <div style={s.actionDivider}>Acción al hacer clic</div>
            <ActionEditor data={(obj as any).data ?? {}} pages={pages} setData={setData} />
          </>
        )}

        <button style={s.deleteBtn} onClick={() => { canvas?.remove(obj); canvas?.requestRenderAll(); onChange() }}>Eliminar elemento</button>
      </div>
    </div>
  )
}

// Propiedades específicas del botón: estilo + acción
function ButtonProps({ obj, canvas, pages, setData, onChange }: { obj: any; canvas: any; pages: any[]; setData: (p: any) => void; onChange: () => void }) {
  const data = (obj as any).data ?? {}
  // Reaplica estilo al grupo (rect + text internos)
  function restyle(patch: any) {
    const next = { ...data, ...patch }
    ;(obj as any).data = next
    const objs = obj.getObjects?.() ?? []
    const rect = objs.find((o: any) => o.type === 'rect')
    const txt = objs.find((o: any) => o.type === 'text' || o.type === 'i-text')
    if (rect) {
      const outline = next.variant === 'outline'
      rect.set({
        fill: outline ? 'rgba(255,255,255,0)' : next.bg,
        stroke: outline ? next.bg : '',
        strokeWidth: outline ? 2 : 0,
        rx: next.variant === 'pill' ? 23 : 8,
        ry: next.variant === 'pill' ? 23 : 8,
      })
    }
    if (txt) {
      txt.set({ text: next.label, fill: next.variant === 'outline' ? next.bg : (next.textColor || '#fff') })
    }
    obj.addWithUpdate?.()
    canvas?.requestRenderAll()
    onChange()
  }

  return (
    <>
      <PropGroup label="Texto del botón">
        <input style={s.propInput} defaultValue={data.label ?? ''} onChange={(e) => restyle({ label: e.target.value })} />
      </PropGroup>
      <PropGroup label="Estilo">
        <div style={{ display: 'flex', gap: 6 }}>
          {(['solid', 'outline', 'pill'] as const).map((v) => (
            <button key={v} style={{ ...s.alignBtn, flex: 1, fontSize: 11, ...(data.variant === v ? s.alignActive : {}) }} onClick={() => restyle({ variant: v })}>
              {v === 'solid' ? 'Relleno' : v === 'outline' ? 'Contorno' : 'Píldora'}
            </button>
          ))}
        </div>
      </PropGroup>
      <PropGroup label="Color del botón">
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <span style={s.miniLabel}>Fondo</span>
            <input type="color" defaultValue={data.bg ?? '#4f46e5'} onChange={(e) => restyle({ bg: e.target.value })} style={s.colorInput} />
          </div>
          <div style={{ flex: 1 }}>
            <span style={s.miniLabel}>Texto</span>
            <input type="color" defaultValue={data.textColor ?? '#ffffff'} onChange={(e) => restyle({ textColor: e.target.value })} style={s.colorInput} />
          </div>
        </div>
      </PropGroup>

      <div style={s.actionDivider}>Acción al hacer clic</div>
      <ActionEditor data={data} pages={pages} setData={setData} />
    </>
  )
}

// Editor de acción reutilizable (botones y zonas de enlace)
function ActionEditor({ data, pages, setData }: { data: any; pages: any[]; setData: (p: any) => void }) {
  const action = data.action ?? { type: 'link' }
  const setAction = (patch: any) => setData({ action: { ...action, ...patch } })

  return (
    <>
      <PropGroup label="Tipo de acción">
        <select style={s.propInput} value={action.type} onChange={(e) => setAction({ type: e.target.value })}>
          {ACTION_TYPES.map((a) => <option key={a.type} value={a.type}>{a.label}</option>)}
        </select>
      </PropGroup>

      {action.type === 'link' && (
        <>
          <PropGroup label="URL">
            <input style={s.propInput} placeholder="https://..." defaultValue={action.url ?? 'https://'} onChange={(e) => setAction({ url: e.target.value })} />
          </PropGroup>
          <PropGroup label="Abrir en">
            <select style={s.propInput} value={action.target ?? '_blank'} onChange={(e) => setAction({ target: e.target.value })}>
              <option value="_blank">Nueva pestaña</option>
              <option value="_self">Misma pestaña</option>
            </select>
          </PropGroup>
        </>
      )}

      {action.type === 'page' && (
        <PropGroup label="Ir a la página">
          <select style={s.propInput} value={action.page ?? 1} onChange={(e) => setAction({ page: +e.target.value })}>
            {pages.map((_: any, i: number) => <option key={i} value={i + 1}>Página {i + 1}</option>)}
          </select>
        </PropGroup>
      )}

      {action.type === 'call' && (
        <PropGroup label="Número de teléfono">
          <input style={s.propInput} placeholder="+1 809 000 0000" defaultValue={action.phone ?? ''} onChange={(e) => setAction({ phone: e.target.value })} />
        </PropGroup>
      )}

      {action.type === 'email' && (
        <>
          <PropGroup label="Correo">
            <input style={s.propInput} placeholder="correo@dominio.com" defaultValue={action.email ?? ''} onChange={(e) => setAction({ email: e.target.value })} />
          </PropGroup>
          <PropGroup label="Asunto (opcional)">
            <input style={s.propInput} defaultValue={action.subject ?? ''} onChange={(e) => setAction({ subject: e.target.value })} />
          </PropGroup>
        </>
      )}

      {action.type === 'popup_text' && (
        <PropGroup label="Texto a mostrar">
          <textarea style={{ ...s.propInput, height: 80, resize: 'vertical' } as any} defaultValue={action.text ?? ''} onChange={(e) => setAction({ text: e.target.value })} />
        </PropGroup>
      )}

      {action.type === 'popup_image' && (
        <PropGroup label="URL de imagen">
          <input style={s.propInput} placeholder="https://..." defaultValue={action.image ?? ''} onChange={(e) => setAction({ image: e.target.value })} />
        </PropGroup>
      )}

      {action.type === 'show_hide' && (
        <PropGroup label="ID del elemento a mostrar/ocultar">
          <input style={s.propInput} placeholder="ej: oferta1" defaultValue={action.target ?? ''} onChange={(e) => setAction({ target: e.target.value })} />
        </PropGroup>
      )}
    </>
  )
}

function StyleToggle({ active, onClick, label, bold, italic, underline }: any) {
  return (
    <button
      onClick={onClick}
      style={{
        ...s.alignBtn, flex: 1,
        fontWeight: bold ? 700 : 500, fontStyle: italic ? 'italic' : 'normal', textDecoration: underline ? 'underline' : 'none',
        ...(active ? s.alignActive : {}),
      }}
    >{label}</button>
  )
}

function PropGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 10, borderBottom: '1px solid #f3f4f6' }}>
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
  saveInd:   { fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: 500, whiteSpace: 'nowrap', minWidth: 96, textAlign: 'right' as const },
  btnOutlineWhite: { background: 'transparent', border: '1px solid rgba(255,255,255,0.4)', color: '#fff', borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500 },
  btnPublish: { border: 'none', color: '#fff', borderRadius: 6, padding: '6px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600 },

  body: { display: 'flex', flex: 1, overflow: 'hidden' },

  rail:    { width: 68, minWidth: 68, background: '#1a1827', display: 'flex', flexDirection: 'column', padding: '6px 0', overflowY: 'auto' },
  railBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', padding: '11px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, borderLeft: '3px solid transparent', transition: 'color .15s, background .15s' },
  railBtnActive: { color: '#fff', background: 'rgba(129,140,248,0.18)', borderLeftColor: '#818cf8' },
  railLabel:{ fontSize: 9.5, fontWeight: 500 },

  panel: { width: 268, minWidth: 268, background: '#fff', borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', padding: 14, overflowY: 'auto' },

  center:    { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#e8eaed' },
  toolbar:   { display: 'flex', alignItems: 'center', gap: 4, padding: '0 12px', height: 44, background: '#fff', borderBottom: '1px solid #e5e7eb', flexShrink: 0 },
  toolBtn:   { background: 'none', border: '1px solid transparent', borderRadius: 8, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151' },
  toolSep:   { width: 1, height: 20, background: '#e5e7eb', margin: '0 6px' },
  zoomGroup: { display: 'flex', gap: 2 },
  zoomBtn:   { background: 'none', border: '1px solid transparent', borderRadius: 12, padding: '3px 9px', fontSize: 11, cursor: 'pointer', color: '#6b7280', fontWeight: 500 },
  zoomActive:{ background: '#f3f4f6', borderColor: '#e5e7eb', color: '#111827', fontWeight: 600 },
  canvasWrap:  { flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: 32, alignItems: 'flex-start' },
  canvasEmpty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%', cursor: 'pointer', borderRadius: 12, transition: 'background 0.2s' },

  right:      { width: 288, minWidth: 288, background: '#fff', borderLeft: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  rightHeader:{ fontSize: 13, fontWeight: 700, color: '#111827', padding: '14px 16px 10px', borderBottom: '1px solid #f3f4f6' },

  propsScroll: { display: 'flex', flexDirection: 'column', overflowY: 'auto', height: '100%' },
  props:     { padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 14 },
  propLabel: { fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  miniLabel: { fontSize: 10, color: '#9ca3af', display: 'block', marginBottom: 4 },
  propInput: { border: '1px solid #e5e7eb', borderRadius: 6, padding: '7px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box' as const, background: '#fff' },
  colorInput:{ width: '100%', height: 34, border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', padding: 2, boxSizing: 'border-box' as const },
  axisLabel: { fontSize: 11, color: '#9ca3af', textAlign: 'center' as const },
  alignBtn:  { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '7px 0', fontSize: 14, cursor: 'pointer', color: '#374151', flex: 1 },
  alignActive: { background: '#eef2ff', borderColor: '#4f46e5', color: '#4f46e5' },
  actionDivider: { fontSize: 12, fontWeight: 700, color: '#4f46e5', borderTop: '1px solid #e5e7eb', paddingTop: 12, marginTop: 2 },
  deleteBtn: { background: '#fff', color: '#ef4444', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 12px', cursor: 'pointer', width: '100%', fontSize: 13, fontWeight: 500, marginTop: 4 },
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
  hint:       { fontSize: 11, color: '#9ca3af', marginTop: 10, marginBottom: 4, lineHeight: 1.5 },
  tplGrid:    { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  tplCard:    { border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', cursor: 'pointer' },
  tplImg:     { width: '100%', aspectRatio: '0.707', objectFit: 'cover' as const, display: 'block' },
  tplPlaceholder: { width: '100%', aspectRatio: '0.707', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', color: '#94a3b8' },
  tplName:    { fontSize: 11, padding: '6px 8px', color: '#374151', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },
  stack:      { display: 'flex', flexDirection: 'column', gap: 8 },
  listBtn:    { display: 'flex', alignItems: 'center', gap: 10, width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px', background: '#fff', cursor: 'pointer', fontSize: 13, color: '#374151', textAlign: 'left' as const },
  shapeGrid:  { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  shapeBtn:   { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, height: 72, border: '1px solid #e5e7eb', borderRadius: 8, cursor: 'pointer', color: '#374151' },
  shapeLabel: { fontSize: 11, color: '#6b7280' },
  btnList:    { display: 'flex', flexDirection: 'column', gap: 8 },
  previewBtn: { width: '100%', padding: '10px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  widgetCard: { position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, height: 72, border: '1px solid #e5e7eb', borderRadius: 8, color: '#475569' },
  widgetLabel:{ fontSize: 10, color: '#6b7280', textAlign: 'center' as const, lineHeight: 1.2 },
  crown:      { position: 'absolute', top: 4, right: 5, fontSize: 11, color: '#f59e0b' },
}

const cfg: Record<string, React.CSSProperties> = {
  groupLabel: { fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 8 },
  sizeBox:    { flex: 1, border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 10px', fontSize: 13, color: '#374151', display: 'flex', alignItems: 'center', gap: 6 },
  sizeLabel:  { fontSize: 10, color: '#9ca3af', fontWeight: 700 },
  scheme:     { display: 'flex', alignItems: 'center', gap: 8, padding: 6, border: '1px solid #f3f4f6', borderRadius: 8 },
  swatch:     { width: 18, height: 18, borderRadius: 4, cursor: 'pointer', display: 'inline-block' },
  schemeName: { fontSize: 11, color: '#6b7280' },
  applyAll:   { width: '100%', marginTop: 8, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 6, padding: '7px', fontSize: 12, color: '#374151', cursor: 'pointer', fontWeight: 500 },
}
