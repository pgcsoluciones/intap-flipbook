import { useEffect, useState, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../lib/api'
import ImageUploader from '../components/ImageUploader'
import PageGrid from '../components/PageGrid'

export default function EditPublication() {
  const { id } = useParams<{ id: string }>()
  const [pub, setPub] = useState<any>(null)
  const [pages, setPages] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!id) return
    api.publications.get(id).then((res) => {
      setPub(res.data)
      setPages(res.data.pages ?? [])
    })
  }, [id])

  async function saveDetails() {
    if (!id || !titleRef.current) return
    setSaving(true)
    try {
      const res = await api.publications.update(id, { title: titleRef.current.value })
      setPub(res.data)
      setMsg('Guardado ✓')
      setTimeout(() => setMsg(''), 2000)
    } finally {
      setSaving(false)
    }
  }

  async function handleUpload(file: File) {
    setUploading(true)
    try {
      const up = await api.upload(file)
      if (!up.success) throw new Error('Upload failed')
      const res = await api.pages.add(id!, { image_url: up.data.url })
      setPages((prev) => [...prev, res.data])
    } finally {
      setUploading(false)
    }
  }

  async function handleDeletePage(pageId: string) {
    await api.pages.delete(pageId)
    setPages((prev) => prev.filter((p) => p.id !== pageId))
  }

  async function handleReorder(newOrder: any[]) {
    setPages(newOrder)
    await api.pages.reorder(id!, newOrder.map((p) => p.id))
  }

  if (!pub) return <div style={{ textAlign: 'center', padding: '4rem' }}>Cargando...</div>

  return (
    <div style={styles.layout}>
      <header style={styles.header}>
        <Link to="/">← Panel</Link>
        <span style={styles.headerTitle}>Editar: {pub.title}</span>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          {msg && <span style={{ color: '#38a169', fontSize: '0.875rem' }}>{msg}</span>}
          <Link to={`/preview/${id}`}><button style={styles.btnOutline}>Vista previa</button></Link>
        </div>
      </header>

      <main style={styles.main}>
        <section style={styles.section}>
          <h3 style={styles.sectionTitle}>Detalles</h3>
          <div style={styles.row}>
            <input ref={titleRef} defaultValue={pub.title} style={styles.input} placeholder="Título" />
            <button style={styles.btnPrimary} onClick={saveDetails} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </section>

        <section style={styles.section}>
          <h3 style={styles.sectionTitle}>Páginas ({pages.length})</h3>
          <ImageUploader onUpload={handleUpload} uploading={uploading} />
          <PageGrid pages={pages} onDelete={handleDeletePage} onReorder={handleReorder} />
        </section>
      </main>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  layout: { minHeight: '100vh', background: '#f7f8fa', fontFamily: 'system-ui, sans-serif' },
  header: { background: '#fff', borderBottom: '1px solid #eee', padding: '0 2rem', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 },
  headerTitle: { fontWeight: 600 },
  main: { maxWidth: 900, margin: '0 auto', padding: '2rem' },
  section: { background: '#fff', borderRadius: 12, padding: '1.5rem', marginBottom: '1.5rem', boxShadow: '0 2px 8px rgba(0,0,0,.05)' },
  sectionTitle: { margin: '0 0 1rem', fontWeight: 600 },
  row: { display: 'flex', gap: '0.75rem' },
  input: { flex: 1, padding: '0.75rem', borderRadius: 8, border: '1px solid #ddd', fontSize: '1rem' },
  btnPrimary: { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '0.75rem 1.2rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
  btnOutline: { background: 'none', border: '1px solid #ddd', borderRadius: 8, padding: '0.4rem 0.8rem', cursor: 'pointer' },
}
