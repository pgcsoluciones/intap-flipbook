import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
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
  const [selected, setSelected] = useState<fabric.Object | null>(null)
  const [zoom, setZoom]   = useState(100)
  const [msg, setMsg]     = useState('')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<fabric.Canvas | null>(null)
  const pageIdRef = useRef<string | null>(null)

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
    }, { crossOrigin: 'anonymous' })

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

  useEffect(() => {
    const c = fabricRef.current
    if (!c) return
    c.selection = tool === 'select'
    c.defaultCursor = tool === 'select' ? 'default' : 'crosshair'
  }, [tool])

  async function persistCanvas(pageId: string, canvas: fabric.Canvas) {
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
      flash('Página guardada ✓')
    } finally { setSaving(false) }
  }

  function flash(text: string) { setMsg(text); setTimeout(() => setMsg(''), 2200) }

  function addText() {
    const c = fabricRef.current; if (!c) return
    const t = new fabric.Textbox('Texto aquí', { left: 60, top: 60, width: 200, fontSize: 24, fill: '#ffffff', fontFamily: 'Inter, sans-serif', fontWeight: 'bold' })
    c.add(t); c.setActiveObject(t); setTool('select')
  }

  function addRect() {
    const c = fabricRef.current; if (!c) return
    const r = new fabric.Rect({ left: 80, top: 80, width: 160, height: 60, fill: 'rgba(79,70,229,0.85)', rx: 8, ry: 8 })
    c.add(r); c.setActiveObject(r); setTool('select')
  }

  function addLink() {
    const c = fabricRef.current; if (!c) return
    const btn = new fabric.Group([
      new fabric.Rect({ width: 180, height: 44, fill: '#4F46E5', rx: 8, ry: 8, originX: 'center', originY: 'center' }),
      new fabric.Text('Ver más', { fill: '#fff', fontSize: 16, fontFamily: 'Inter, sans-serif', fontWeight: 'bold', originX: 'center', originY: 'center' }),
    ], { left: 100, top: 120, data: { type: 'link', url: 'https://' } })
    c.add(btn); c.setActiveObject(btn); setTool('select')
    flash('Editá la URL en propiedades →')
  }

  async function handleUpload(file: File) {
    setUploading(true)
    try {
      const up = await api.upload(file)
      if (!up.success) throw new Error('Upload falló')
      const res = await api.pages.add(id!, { image_url: up.data.url })
      setPages((prev) => { const next = [...prev, res.data]; setActivePage(res.data); return next })
    } finally { setUploading(false) }
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
      flash('¡Publicado! ✓')
    } catch (e: any) { flash(e.message) }
    finally { setPublishing(false) }
  }

  if (!pub) return <div style={s.loading}>Cargando editor...</div>

  return (
    <div style={s.root}>

      {/* Barra superior */}
      <div style={s.topBar}>
        <Link to="/publications" style={s.backLink}>← Mis flipbooks</Link>
        <span style={s.pubTitle}>{pub.title}</span>
        <div style={s.topRight}>
          {msg && <span style={s.msg}>{msg}</span>}
          <Link to={`/publications/${id}/preview`}>
            <button className="btn btn-secondary btn-sm">Vista previa</button>
          </Link>
          <button
            className="btn btn-sm"
            style={{ background: pub.status === 'published' ? 'var(--color-success)' : 'var(--color-primary)', color: '#fff' }}
            onClick={handlePublish}
            disabled={publishing}
          >
            {publishing ? 'Publicando...' : pub.status === 'published' ? '✓ Publicado' : 'Publicar'}
          </button>
        </div>
      </div>

      {/* Layout 3 columnas */}
      <div style={s.columns}>

        {/* Columna izquierda — miniaturas */}
        <aside style={s.left}>
          <div style={s.leftHeader}>Páginas ({pages.length})</div>
          <div style={s.thumbList}>
            {pages.map((page, i) => (
              <div
                key={page.id}
                draggable
                onDragStart={() => onDragStart(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(i)}
                onClick={() => setActivePage(page)}
                style={{ ...s.thumbItem, outline: activePage?.id === page.id ? '2px solid var(--color-primary)' : '2px solid transparent' }}
              >
                <img src={page.image_url} alt={`p${i + 1}`} style={s.thumbImg} />
                <div style={s.thumbNum}>{i + 1}</div>
                <button
                  style={s.thumbDel}
                  onClick={(e) => { e.stopPropagation(); handleDeletePage(page.id) }}
                  title="Eliminar"
                >✕</button>
              </div>
            ))}
          </div>
          <div style={{ padding: 10, borderTop: '1px solid var(--color-border)' }}>
            <ImageUploader onUpload={handleUpload} uploading={uploading} compact />
          </div>
        </aside>

        {/* Columna central — canvas */}
        <main style={s.center}>
          {/* Toolbar */}
          <div style={s.toolbar}>
            {([
              { key: 'select', icon: '↖', label: 'Seleccionar' },
              { key: 'text',   icon: 'T',  label: 'Texto',       action: addText },
              { key: 'rect',   icon: '▭',  label: 'Forma',       action: addRect },
              { key: 'link',   icon: '🔗', label: 'Botón/Link',  action: addLink },
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
            <button title="Eliminar selección" style={s.toolBtn}
              onClick={() => { const c = fabricRef.current; const o = c?.getActiveObject(); if (o) { c!.remove(o); setSelected(null) } }}>
              🗑
            </button>
          </div>

          {/* Canvas area */}
          <div style={s.canvasWrap}>
            {activePage ? (
              <div style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center', boxShadow: '0 4px 24px rgba(0,0,0,.2)', borderRadius: 2 }}>
                <canvas ref={canvasRef} />
              </div>
            ) : (
              <div style={s.canvasEmpty}>
                <div style={{ fontSize: 48 }}>📄</div>
                <p>Subí imágenes desde el panel izquierdo para comenzar.</p>
              </div>
            )}
          </div>

          {/* Barra inferior */}
          <div style={s.bottomBar}>
            <div style={s.zoomGroup}>
              {[50, 75, 100, 125].map((z) => (
                <button key={z} style={{ ...s.zoomBtn, ...(zoom === z ? s.zoomActive : {}) }} onClick={() => setZoom(z)}>{z}%</button>
              ))}
            </div>
            <span style={s.pageIndicator}>
              {activePage ? `${pages.findIndex((p) => p.id === activePage.id) + 1} / ${pages.length}` : '—'}
            </span>
            <button className="btn btn-secondary btn-sm" onClick={saveCurrentCanvas} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar página'}
            </button>
          </div>
        </main>

        {/* Columna derecha — propiedades */}
        <aside style={s.right}>
          <div style={s.rightHeader}>Propiedades</div>
          {selected
            ? <PropsPanel obj={selected} canvas={fabricRef.current} />
            : <div style={s.rightEmpty}>Seleccioná un elemento del canvas para editar sus propiedades.</div>
          }
        </aside>
      </div>
    </div>
  )
}

function PropsPanel({ obj, canvas }: { obj: fabric.Object; canvas: fabric.Canvas | null }) {
  const update = (props: any) => { obj.set(props); canvas?.renderAll() }
  const isText = obj instanceof fabric.Textbox || obj instanceof fabric.Text
  const fill = typeof obj.fill === 'string' ? obj.fill : '#000000'
  const isLink = (obj as any).data?.type === 'link'

  return (
    <div style={s.props}>
      <PropGroup label="Posición">
        <div style={{ display: 'grid', gridTemplateColumns: '16px 1fr 16px 1fr', gap: 4, alignItems: 'center' }}>
          <span style={s.axisLabel}>X</span>
          <input className="input" style={{ padding: '4px 6px', fontSize: 12 }} type="number"
            defaultValue={Math.round(obj.left ?? 0)} onChange={(e) => update({ left: +e.target.value })} />
          <span style={s.axisLabel}>Y</span>
          <input className="input" style={{ padding: '4px 6px', fontSize: 12 }} type="number"
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
          style={{ width: '100%', height: 34, border: '1px solid var(--color-border)', borderRadius: 6, cursor: 'pointer' }} />
      </PropGroup>

      {isText && (
        <>
          <PropGroup label="Texto">
            <textarea className="input" style={{ height: 60, resize: 'vertical' }}
              defaultValue={(obj as fabric.Textbox).text ?? ''}
              onChange={(e) => { (obj as any).set('text', e.target.value); canvas?.renderAll() }} />
          </PropGroup>
          <PropGroup label="Tamaño de fuente">
            <input className="input" type="number" min={8} max={120}
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
        <PropGroup label="URL del botón">
          <input className="input" defaultValue={(obj as any).data?.url ?? ''}
            onChange={(e) => { (obj as any).data = { ...((obj as any).data ?? {}), url: e.target.value } }} />
        </PropGroup>
      )}

      <button className="btn btn-danger btn-sm" style={{ width: '100%', justifyContent: 'center' }}
        onClick={() => { canvas?.remove(obj); canvas?.renderAll() }}>
        Eliminar elemento
      </button>
    </div>
  )
}

function PropGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={s.propLabel}>{label}</span>
      {children}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  root:    { display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' },
  loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--color-muted)' },
  topBar:  { display: 'flex', alignItems: 'center', gap: 16, padding: '10px 20px', background: '#fff', borderBottom: '1px solid var(--color-border)', flexShrink: 0 },
  backLink:{ color: 'var(--color-primary)', fontSize: 'var(--text-sm)', whiteSpace: 'nowrap' },
  pubTitle:{ fontWeight: 600, fontSize: 'var(--text-sm)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  topRight:{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  msg:     { fontSize: 'var(--text-xs)', color: 'var(--color-success)', fontWeight: 500 },
  columns: { display: 'flex', flex: 1, overflow: 'hidden' },
  left:    { width: 190, minWidth: 190, background: '#fff', borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column' },
  leftHeader: { padding: '10px 12px', borderBottom: '1px solid var(--color-border)', fontWeight: 600, fontSize: 'var(--text-sm)', flexShrink: 0 },
  thumbList:  { flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 },
  thumbItem:  { position: 'relative', cursor: 'pointer', borderRadius: 6, overflow: 'hidden' },
  thumbImg:   { width: '100%', aspectRatio: '0.707', objectFit: 'cover', display: 'block' },
  thumbNum:   { position: 'absolute', bottom: 4, left: 6, background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3 },
  thumbDel:   { position: 'absolute', top: 3, right: 3, background: 'rgba(239,68,68,.85)', color: '#fff', border: 'none', borderRadius: 4, fontSize: 10, width: 18, height: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 },
  center:  { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#dde1e7' },
  toolbar: { display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', background: '#fff', borderBottom: '1px solid var(--color-border)', flexShrink: 0 },
  toolBtn: { background: 'none', border: '1px solid transparent', borderRadius: 6, width: 34, height: 34, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 },
  toolBtnActive: { background: '#EEF2FF', borderColor: 'var(--color-primary)', color: 'var(--color-primary)' },
  toolSep: { width: 1, height: 20, background: 'var(--color-border)', margin: '0 4px' },
  canvasWrap:  { flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: 24 },
  canvasEmpty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--color-muted)', textAlign: 'center' },
  bottomBar: { display: 'flex', alignItems: 'center', gap: 16, padding: '8px 16px', background: '#fff', borderTop: '1px solid var(--color-border)', flexShrink: 0 },
  zoomGroup: { display: 'flex', gap: 2 },
  zoomBtn:   { background: 'none', border: '1px solid transparent', borderRadius: 4, padding: '3px 7px', fontSize: 11, cursor: 'pointer', color: 'var(--color-muted)' },
  zoomActive:{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', fontWeight: 600 },
  pageIndicator: { flex: 1, textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--color-muted)' },
  right:      { width: 250, minWidth: 250, background: '#fff', borderLeft: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column' },
  rightHeader:{ padding: '10px 16px', borderBottom: '1px solid var(--color-border)', fontWeight: 600, fontSize: 'var(--text-sm)', flexShrink: 0 },
  rightEmpty: { padding: 16, color: 'var(--color-muted)', fontSize: 'var(--text-sm)', textAlign: 'center', marginTop: 32, lineHeight: 1.5 },
  props:      { padding: 14, display: 'flex', flexDirection: 'column', gap: 14 },
  propLabel:  { fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' },
  axisLabel:  { fontSize: 11, color: 'var(--color-muted)', textAlign: 'center' },
}
