import React, { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
// @ts-ignore
import { fabric } from 'fabric'
import { api } from '../lib/api'
import ImageUploader from '../components/ImageUploader'

type Tool = 'select' | 'text' | 'rect' | 'link'

export default function EditPublication() {
  const { id } = useParams<{ id: string }>()
  const [pub, setPub]       = useState<any>(null)
  const [pages, setPages]   = useState<any[]>([])
  const [activePage, setActivePage] = useState<any>(null)
  const [uploading, setUploading]   = useState(false)
  const [saving, setSaving]         = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [tool, setTool]   = useState<Tool>('select')
  const [selected, setSelected] = useState<any>(null)
  const [zoom, setZoom]   = useState(100)
  const [msg, setMsg]     = useState('')
  const [rightTab, setRightTab] = useState<'props' | 'elements'>('elements')

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
  }, [id])

  useEffect(() => {
    if (!activePage || !canvasRef.current) return

    if (fabricRef.current && pageIdRef.current && pageIdRef.current !== activePage.id) {
      persistCanvas(pageIdRef.current, fabricRef.current)
    }

    pageIdRef.current = activePage.id

    if (fabricRef.current) { fabricRef.current.dispose(); fabricRef.current = null }

    const W = 580
    const H = Math.round(W * 1.414)

    const canvas = new fabric.Canvas(canvasRef.current, { width: W, height: H })
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

    canvas.on('selection:created', (e: any) => {
      setSelected(e.selected?.[0] ?? null)
      setRightTab('props')
    })
    canvas.on('selection:updated', (e: any) => {
      setSelected(e.selected?.[0] ?? null)
      setRightTab('props')
    })
    canvas.on('selection:cleared', () => {
      setSelected(null)
      setRightTab('elements')
    })

    return () => {
      if (fabricRef.current) {
        persistCanvas(activePage.id, fabricRef.current)
        fabricRef.current.dispose()
        fabricRef.current = null
      }
    }
  }, [activePage?.id])

  useEffect(() => {
    const c = fabricRef.current
    if (!c) return
    c.selection = tool === 'select'
    c.defaultCursor = tool === 'select' ? 'default' : 'crosshair'
  }, [tool])

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
      flash('Pagina guardada')
    } finally { setSaving(false) }
  }

  function flash(text: string) { setMsg(text); setTimeout(() => setMsg(''), 2200) }

  function addText() {
    const c = fabricRef.current; if (!c) return
    const t = new fabric.Textbox('Texto aqui', { left: 60, top: 60, width: 200, fontSize: 24, fill: '#ffffff', fontFamily: 'Inter, sans-serif', fontWeight: 'bold' })
    c.add(t); c.setActiveObject(t); setTool('select')
  }

  function addRect() {
    const c = fabricRef.current; if (!c) return
    const r = new fabric.Rect({ left: 80, top: 80, width: 160, height: 60, fill: 'rgba(79,70,229,0.85)', rx: 8, ry: 8 })
    c.add(r); c.setActiveObject(r); setTool('select')
  }

  function addCircle() {
    const c = fabricRef.current; if (!c) return
    const circle = new fabric.Circle({ radius: 60, fill: 'rgba(79,70,229,0.85)', left: 100, top: 100 })
    c.add(circle); c.setActiveObject(circle); setTool('select')
  }

  function addTriangle() {
    const c = fabricRef.current; if (!c) return
    const tri = new fabric.Triangle({ width: 120, height: 100, fill: 'rgba(16,185,129,0.85)', left: 100, top: 100 })
    c.add(tri); c.setActiveObject(tri); setTool('select')
  }

  function addLine() {
    const c = fabricRef.current; if (!c) return
    const line = new fabric.Line([0, 0, 250, 0], { stroke: '#ffffff', strokeWidth: 3, left: 80, top: 200 })
    c.add(line); c.setActiveObject(line); setTool('select')
  }

  function addLink() {
    const c = fabricRef.current; if (!c) return
    const btn = new fabric.Group([
      new fabric.Rect({ width: 180, height: 44, fill: '#4F46E5', rx: 8, ry: 8, originX: 'center', originY: 'center' }),
      new fabric.Text('Ver mas', { fill: '#fff', fontSize: 16, fontFamily: 'Inter, sans-serif', fontWeight: 'bold', originX: 'center', originY: 'center' }),
    ], { left: 100, top: 120, data: { type: 'link', url: 'https://' } })
    c.add(btn); c.setActiveObject(btn); setTool('select')
    flash('Edita la URL en propiedades')
  }

  async function handleUpload(file: File) {
    setUploading(true)
    try {
      const up = await api.upload(file)
      if (!up.success) throw new Error('Upload fallo')
      const res = await api.pages.add(id!, { image_url: up.data.url })
      setPages((prev) => { const next = [...prev, res.data]; setActivePage(res.data); return next })
    } finally { setUploading(false) }
  }

  async function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    await handleUpload(file)
    e.target.value = ''
  }

  async function handleDeletePage(pageId: string) {
    if (!confirm('Eliminar esta pagina?')) return
    await api.pages.delete(pageId)
    setPages((prev) => {
      const next = prev.filter((p) => p.id !== pageId)
      if (activePage?.id === pageId) setActivePage(next[0] ?? null)
      return next
    })
  }

  const dragRef = useRef<number | null>(null)
  function onDragStart(i: number) { dragRef.current = i }
  function onDrop(i: number) {
    if (dragRef.current === null || dragRef.current === i) return
    const next = [...pages]
    const [moved] = next.splice(dragRef.current, 1)
    next.splice(i, 0, moved)
    setPages(next)
    api.pages.reorder(id!, next.map((p) => p.id))
    dragRef.current = null
  }

  async function handlePublish() {
    setPublishing(true)
    await saveCurrentCanvas()
    try {
      const res = await api.publications.publish(id!)
      setPub(res.data)
      flash('Publicado!')
    } catch (e: any) { flash(e.message) }
    finally { setPublishing(false) }
  }

  const activePageIndex = activePage ? pages.findIndex((p) => p.id === activePage.id) : -1

  if (!pub) return <div style={s.loading}>Cargando editor...</div>

  return (
    <div style={s.root}>

      {/* Top bar */}
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
            style={{
              ...s.btnPublish,
              background: pub.status === 'published' ? '#16a34a' : '#4f46e5',
            }}
            onClick={handlePublish}
            disabled={publishing}
          >
            {publishing ? 'Publicando...' : pub.status === 'published' ? '✓ Publicado' : 'Publicar'}
          </button>
        </div>
      </div>

      {/* 3-column layout */}
      <div style={s.columns}>

        {/* Left sidebar — page thumbnails */}
        <aside style={s.left}>
          <div style={s.leftHeader}>
            <span style={s.leftHeaderLabel}>PAGINAS</span>
            <span style={s.leftHeaderCount}>{pages.length}</span>
          </div>
          <div style={s.thumbList}>
            {pages.map((page, i) => (
              <div
                key={page.id}
                draggable
                onDragStart={() => onDragStart(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(i)}
                onClick={() => setActivePage(page)}
                style={{
                  ...s.thumbItem,
                  borderLeft: activePage?.id === page.id ? '3px solid #818cf8' : '3px solid transparent',
                  background: activePage?.id === page.id ? 'rgba(129,140,248,0.08)' : 'transparent',
                }}
              >
                <img src={page.image_url} alt={`p${i + 1}`} style={s.thumbImg} />
                <div style={s.thumbNum}>{i + 1}</div>
                <button
                  style={s.thumbDel}
                  onClick={(e) => { e.stopPropagation(); handleDeletePage(page.id) }}
                  title="Eliminar"
                >&#10005;</button>
              </div>
            ))}
          </div>
          <div style={s.leftBottom}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={handleFileInputChange}
            />
            <button
              style={s.addPageBtn}
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? 'Subiendo...' : '+ Nueva pagina'}
            </button>
          </div>
        </aside>

        {/* Center — canvas */}
        <main style={s.center}>
          {/* Toolbar */}
          <div style={s.toolbar}>
            <div style={s.toolGroup}>
              {([
                { key: 'select', icon: '↖', label: 'Seleccionar' },
                { key: 'text',   icon: 'T',       label: 'Texto',      action: addText },
                { key: 'rect',   icon: '▭',  label: 'Forma',      action: addRect },
                { key: 'link',   icon: '🔗', label: 'Boton/Link', action: addLink },
              ] as { key: Tool; icon: string; label: string; action?: () => void }[]).map((t) => (
                <button
                  key={t.key}
                  title={t.label}
                  style={{ ...s.toolBtn, ...(tool === t.key ? s.toolBtnActive : {}) }}
                  onClick={() => { setTool(t.key); t.action?.() }}
                >
                  {t.icon}
                </button>
              ))}
              <div style={s.toolSep} />
              <button
                title="Eliminar seleccion"
                style={s.toolBtn}
                onClick={() => {
                  const c = fabricRef.current
                  const o = c?.getActiveObject()
                  if (o) { c!.remove(o); setSelected(null) }
                }}
              >
                &#128465;
              </button>
            </div>
            <div style={{ flex: 1 }} />
            <div style={s.zoomGroup}>
              {[50, 75, 100, 125].map((z) => (
                <button
                  key={z}
                  style={{ ...s.zoomBtn, ...(zoom === z ? s.zoomActive : {}) }}
                  onClick={() => setZoom(z)}
                >
                  {z}%
                </button>
              ))}
            </div>
            <div style={s.toolSep} />
            <button style={s.savePgBtn} onClick={saveCurrentCanvas} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar pagina'}
            </button>
          </div>

          {/* Canvas area */}
          <div style={s.canvasWrap}>
            {activePage ? (
              <div style={{
                transform: `scale(${zoom / 100})`,
                transformOrigin: 'top center',
                boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
                borderRadius: 2,
              }}>
                <canvas ref={canvasRef} />
              </div>
            ) : (
              <div style={s.canvasEmpty}>
                <div style={{ fontSize: 52, marginBottom: 16, opacity: 0.4 }}>&#128196;</div>
                <p style={{ color: '#6b7280', fontSize: 15, textAlign: 'center', maxWidth: 260, lineHeight: 1.6 }}>
                  Agrega paginas desde el panel izquierdo para comenzar.
                </p>
              </div>
            )}
          </div>
        </main>

        {/* Right sidebar — props / elements */}
        <aside style={s.right}>
          {/* Tab header */}
          <div style={s.tabHeader}>
            <button
              style={{ ...s.tabBtn, ...(rightTab === 'elements' ? s.tabBtnActive : {}) }}
              onClick={() => setRightTab('elements')}
            >
              Elementos
            </button>
            <button
              style={{ ...s.tabBtn, ...(rightTab === 'props' ? s.tabBtnActive : {}) }}
              onClick={() => setRightTab('props')}
            >
              Propiedades
            </button>
          </div>

          {rightTab === 'props' ? (
            selected
              ? <PropsPanel obj={selected} canvas={fabricRef.current} />
              : <div style={s.rightEmpty}>Selecciona un elemento del canvas para editar sus propiedades.</div>
          ) : (
            <div style={{ overflowY: 'auto', flex: 1 }}>
              <ElemSection title="Texto">
                <ElemBtn icon="T" label="Texto" onClick={addText} />
              </ElemSection>
              <ElemSection title="Formas">
                <ElemBtn icon="▭" label="Rectángulo" onClick={addRect} />
                <ElemBtn icon="⬤" label="Círculo" onClick={addCircle} />
                <ElemBtn icon="▲" label="Triángulo" onClick={addTriangle} />
                <ElemBtn icon="─" label="Línea" onClick={addLine} />
              </ElemSection>
              <ElemSection title="Botones">
                <ElemBtn icon="🔗" label="Botón enlace" onClick={addLink} />
              </ElemSection>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function PropsPanel({ obj, canvas }: { obj: any; canvas: any }) {
  const update = (props: any) => { obj.set(props); canvas?.renderAll() }
  const isText = obj instanceof fabric.Textbox || obj instanceof fabric.Text
  const fill = typeof obj.fill === 'string' ? obj.fill : '#000000'
  const isLink = (obj as any).data?.type === 'link'

  return (
    <div style={s.props}>
      <PropGroup label="Posicion">
        <div style={{ display: 'grid', gridTemplateColumns: '16px 1fr 16px 1fr', gap: 4, alignItems: 'center' }}>
          <span style={s.axisLabel}>X</span>
          <input style={s.propInput} type="number"
            defaultValue={Math.round(obj.left ?? 0)} onChange={(e) => update({ left: +e.target.value })} />
          <span style={s.axisLabel}>Y</span>
          <input style={s.propInput} type="number"
            defaultValue={Math.round(obj.top ?? 0)} onChange={(e) => update({ top: +e.target.value })} />
        </div>
      </PropGroup>

      <PropGroup label="Opacidad">
        <input type="range" min={0} max={1} step={0.05} defaultValue={obj.opacity ?? 1}
          onChange={(e) => update({ opacity: +e.target.value })} style={{ width: '100%' }} />
      </PropGroup>

      <PropGroup label="Color">
        <input type="color" defaultValue={fill.startsWith('#') ? fill : '#4f46e5'}
          onChange={(e) => update({ fill: e.target.value })}
          style={{ width: '100%', height: 34, border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer' }} />
      </PropGroup>

      {isText && (
        <>
          <PropGroup label="Texto">
            <textarea style={{ ...s.propInput, height: 60, resize: 'vertical' } as any}
              defaultValue={(obj as any).text ?? ''}
              onChange={(e) => { (obj as any).set('text', e.target.value); canvas?.renderAll() }} />
          </PropGroup>
          <PropGroup label="Tamano de fuente">
            <input style={s.propInput} type="number" min={8} max={120}
              defaultValue={(obj as any).fontSize ?? 24}
              onChange={(e) => update({ fontSize: +e.target.value })} />
          </PropGroup>
          <PropGroup label="Negrita">
            <input type="checkbox" defaultChecked={(obj as any).fontWeight === 'bold'}
              onChange={(e) => update({ fontWeight: e.target.checked ? 'bold' : 'normal' })} />
          </PropGroup>
        </>
      )}

      {isLink && (
        <PropGroup label="URL del boton">
          <input style={s.propInput} defaultValue={(obj as any).data?.url ?? ''}
            onChange={(e) => { (obj as any).data = { ...((obj as any).data ?? {}), url: e.target.value } }} />
        </PropGroup>
      )}

      <button
        style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', width: '100%', fontSize: 13, marginTop: 8 }}
        onClick={() => { canvas?.remove(obj); canvas?.renderAll() }}
      >
        Eliminar elemento
      </button>
    </div>
  )
}

function ElemSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: '0.07em', marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 8 }}>
        {children}
      </div>
    </div>
  )
}

function ElemBtn({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  const [hover, setHover] = React.useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: 5, width: 76, height: 68, border: '1px solid #e5e7eb', borderRadius: 8, background: hover ? '#f9fafb' : 'none', cursor: 'pointer', transition: 'background 0.12s' }}
    >
      <span style={{ fontSize: 22, lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: 10, fontWeight: 500, color: '#6b7280', textAlign: 'center' as const, lineHeight: 1.2 }}>{label}</span>
    </button>
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

const s: Record<string, React.CSSProperties> = {
  root:    { display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', fontFamily: 'Inter, system-ui, sans-serif' },
  loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#6b7280', fontSize: 15 },

  // Top bar
  topBar:   { display: 'flex', alignItems: 'center', height: 52, padding: '0 16px', background: '#1e1b4b', flexShrink: 0, gap: 0 },
  topLeft:  { display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  topCenter:{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 120, flexShrink: 0 },
  topRight: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 },
  backLink: { color: 'rgba(255,255,255,0.7)', fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 },
  pubTitle: { fontWeight: 700, fontSize: 14, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  breadcrumb: { fontSize: 13, color: 'rgba(255,255,255,0.65)', fontWeight: 500 },
  msg:       { fontSize: 12, color: '#86efac', fontWeight: 500, whiteSpace: 'nowrap' },
  btnOutlineWhite: { background: 'transparent', border: '1px solid rgba(255,255,255,0.4)', color: '#fff', borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500 },
  btnPublish: { border: 'none', color: '#fff', borderRadius: 6, padding: '6px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600 },

  // Layout
  columns: { display: 'flex', flex: 1, overflow: 'hidden' },

  // Left sidebar
  left:        { width: 220, minWidth: 220, background: '#1a1827', display: 'flex', flexDirection: 'column' },
  leftHeader:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', flexShrink: 0 },
  leftHeaderLabel: { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.08em', textTransform: 'uppercase' as any },
  leftHeaderCount: { fontSize: 11, color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.08)', borderRadius: 10, padding: '1px 7px' },
  thumbList:   { flex: 1, overflowY: 'auto', padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 4 },
  thumbItem:   { position: 'relative', cursor: 'pointer', borderRadius: 4, overflow: 'hidden', transition: 'background 0.15s' },
  thumbImg:    { width: '100%', aspectRatio: '0.707', objectFit: 'cover', display: 'block' },
  thumbNum:    { position: 'absolute', bottom: 4, left: 6, background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3 },
  thumbDel:    { position: 'absolute', top: 4, right: 4, background: 'rgba(239,68,68,0.85)', color: '#fff', border: 'none', borderRadius: 4, fontSize: 11, width: 20, height: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 },
  leftBottom:  { padding: '10px 8px', flexShrink: 0 },
  addPageBtn:  { width: '100%', background: '#2d2b45', color: '#fff', border: '1px solid #3d3b55', borderRadius: 6, padding: '10px', cursor: 'pointer', fontSize: 13, fontWeight: 500, textAlign: 'center' as any },

  // Center
  center:    { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#e8eaed' },
  toolbar:   { display: 'flex', alignItems: 'center', gap: 4, padding: '0 12px', height: 44, background: '#fff', borderBottom: '1px solid #e5e7eb', flexShrink: 0 },
  toolGroup: { display: 'flex', alignItems: 'center', gap: 2 },
  toolBtn:   { background: 'none', border: '1px solid transparent', borderRadius: 8, width: 36, height: 36, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, color: '#374151' },
  toolBtnActive: { background: '#eef2ff', borderColor: '#818cf8', color: '#4f46e5' },
  toolSep:   { width: 1, height: 20, background: '#e5e7eb', margin: '0 6px' },
  zoomGroup: { display: 'flex', gap: 2 },
  zoomBtn:   { background: 'none', border: '1px solid transparent', borderRadius: 12, padding: '3px 9px', fontSize: 11, cursor: 'pointer', color: '#6b7280', fontWeight: 500 },
  zoomActive:{ background: '#f3f4f6', borderColor: '#e5e7eb', color: '#111827', fontWeight: 600 },
  savePgBtn: { background: '#f3f4f6', border: '1px solid #e5e7eb', color: '#374151', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 500 },
  canvasWrap:  { flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: 32, alignItems: 'flex-start' },
  canvasEmpty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%' },

  // Right sidebar
  right:      { width: 280, minWidth: 280, background: '#fff', borderLeft: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column' },
  tabHeader:  { display: 'flex', borderBottom: '1px solid #e5e7eb', flexShrink: 0 },
  tabBtn:     { flex: 1, background: 'none', border: 'none', borderBottom: '2px solid transparent', padding: '12px 0', fontSize: 13, cursor: 'pointer', color: '#6b7280', fontWeight: 500 },
  tabBtnActive: { color: '#4f46e5', borderBottomColor: '#4f46e5', fontWeight: 600 },
  rightEmpty: { padding: '32px 20px', color: '#9ca3af', fontSize: 13, textAlign: 'center', lineHeight: 1.6 },
  elementsPanel: { padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 16 },
  elemSectionTitle: { fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' as any, letterSpacing: '0.07em' },
  elemGrid:   { display: 'flex', gap: 10, flexWrap: 'wrap' as any },
  elemCard:   { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, width: 80, height: 70, border: '1px solid #e5e7eb', borderRadius: 8, background: 'none', cursor: 'pointer', fontSize: 13, color: '#374151', transition: 'background 0.12s' },
  elemIcon:   { fontSize: 20, lineHeight: 1 },
  elemLabel:  { fontSize: 11, fontWeight: 500, color: '#6b7280' },

  // Props panel
  props:     { padding: '16px', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' },
  propLabel: { fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' as any, letterSpacing: '0.05em' },
  propInput: { border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box' as any },
  axisLabel: { fontSize: 11, color: '#9ca3af', textAlign: 'center' },
}
