import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'

const CATEGORIES: Record<string, string> = {
  catalogo:   'Catálogo',
  menu:       'Menú',
  portafolio: 'Portafolio',
  revista:    'Revista',
  folleto:    'Folleto',
  otro:       'Otro',
  // legacy values
  catalog:   'Catálogo',
  portfolio: 'Portafolio',
}

const STATUS_OPTIONS = [
  { value: '', label: 'Todos los estados' },
  { value: 'published', label: 'Publicados' },
  { value: 'draft', label: 'Borradores' },
]

type Tab = 'active' | 'trash'

export default function Publications() {
  const navigate = useNavigate()
  const [all, setAll]         = useState<any[]>([])
  const [trash, setTrash]     = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab]         = useState<Tab>('active')
  const [search, setSearch]   = useState('')
  const [status, setStatus]   = useState('')
  const [category, setCategory] = useState('')

  useEffect(() => {
    if (!localStorage.getItem('token')) { navigate('/login'); return }
    api.publications.list()
      .then((res) => setAll(res.data ?? []))
      .catch(() => { localStorage.removeItem('token'); navigate('/login') })
      .finally(() => setLoading(false))
  }, [])

  async function handleDelete(id: string) {
    if (!confirm('¿Mover a papelera?')) return
    await api.publications.delete(id)
    const pub = all.find((p) => p.id === id)
    setAll((prev) => prev.filter((p) => p.id !== id))
    if (pub) setTrash((prev) => [{ ...pub, deleted: true }, ...prev])
  }

  async function handleRestore(id: string) {
    // El backend no tiene endpoint de restore aún — se elimina de la papelera local
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

  const filtered = all.filter((p) => {
    const matchSearch = !search || p.title.toLowerCase().includes(search.toLowerCase())
    const matchStatus = !status || p.status === status
    const matchCat    = !category || p.category === category
    return matchSearch && matchStatus && matchCat
  })

  const uniqueCategories = [...new Set(all.map((p) => p.category).filter(Boolean))]

  if (loading) return <div style={s.loading}>Cargando...</div>

  return (
    <div style={s.page}>
      <div style={s.inner}>

        {/* ── Header ── */}
        <div style={s.topBar}>
          <div>
            <h1 style={s.pageTitle}>Mis Flipbooks</h1>
            <p style={s.pageSubtitle}>{all.length} publicación{all.length !== 1 ? 'es' : ''}</p>
          </div>
          <Link to="/publications/new">
            <button className="btn btn-primary">+ Nuevo flipbook</button>
          </Link>
        </div>

        {/* ── Tabs ── */}
        <div style={s.tabs}>
          <button style={{ ...s.tab, ...(tab === 'active' ? s.tabActive : {}) }} onClick={() => setTab('active')}>
            Publicaciones ({all.length})
          </button>
          <button style={{ ...s.tab, ...(tab === 'trash' ? s.tabActive : {}) }} onClick={() => setTab('trash')}>
            Papelera ({trash.length})
          </button>
        </div>

        {tab === 'active' && (
          <>
            {/* ── Barra de búsqueda y filtros ── */}
            <div style={s.filterBar}>
              <input
                className="input"
                style={{ maxWidth: 280 }}
                placeholder="Buscar por nombre..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className="input"
                style={{ width: 'auto' }}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <select
                className="input"
                style={{ width: 'auto' }}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">Todas las categorías</option>
                {uniqueCategories.map((c) => (
                  <option key={c} value={c}>{CATEGORIES[c] ?? c}</option>
                ))}
              </select>
              {(search || status || category) && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => { setSearch(''); setStatus(''); setCategory('') }}
                >
                  Limpiar filtros
                </button>
              )}
            </div>

            {/* ── Grid ── */}
            {filtered.length === 0 ? (
              <div className="card" style={s.empty}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
                <p>{search || status || category ? 'No hay resultados para los filtros aplicados.' : 'No tenés publicaciones aún.'}</p>
                {!search && !status && !category && (
                  <Link to="/publications/new" style={{ marginTop: 12 }}>
                    <button className="btn btn-primary">Crear mi primer flipbook</button>
                  </Link>
                )}
              </div>
            ) : (
              <div style={s.grid}>
                {filtered.map((pub) => (
                  <PubCard
                    key={pub.id}
                    pub={pub}
                    onDelete={() => handleDelete(pub.id)}
                    onPublish={() => handlePublish(pub.id)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'trash' && (
          <div>
            {trash.length === 0 ? (
              <div className="card" style={s.empty}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🗑️</div>
                <p>La papelera está vacía.</p>
              </div>
            ) : (
              <div style={s.grid}>
                {trash.map((pub) => (
                  <TrashCard
                    key={pub.id}
                    pub={pub}
                    onRestore={() => handleRestore(pub.id)}
                    onDelete={() => handlePermanentDelete(pub.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Botón flotante ── */}
      <Link to="/publications/new" style={s.fab} title="Nuevo flipbook">+</Link>
    </div>
  )
}

function PubCard({ pub, onDelete, onPublish }: { pub: any; onDelete: () => void; onPublish: () => void }) {
  const isPublished = pub.status === 'published'
  const catLabel = CATEGORIES[pub.category ?? ''] ?? pub.category ?? '—'

  return (
    <div className="card" style={s.card}>
      {pub.cover_image_url ? (
        <img src={pub.cover_image_url} alt={pub.title} style={s.cover} />
      ) : (
        <div style={s.coverPlaceholder}>📄</div>
      )}
      <div style={s.cardBody}>
        <div style={s.cardTop}>
          <span style={s.cardTitle}>{pub.title}</span>
          <span className={`badge ${isPublished ? 'badge-success' : 'badge-warning'}`}>
            {isPublished ? 'Publicado' : 'Borrador'}
          </span>
        </div>
        <div style={s.cardMeta}>
          {pub.category && <span className="badge badge-free">{catLabel}</span>}
          <span style={{ color: 'var(--color-muted)', fontSize: 'var(--text-xs)' }}>
            📄 {pub.page_count ?? 0} páginas · 👁 {pub.views_count ?? 0} vistas
          </span>
        </div>
        <div style={s.cardDate}>
          {new Date(pub.created_at).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
        </div>
        <div style={s.cardActions}>
          <Link to={`/publications/${pub.id}/editor`}>
            <button className="btn btn-secondary btn-sm">Editar</button>
          </Link>
          <Link to={`/publications/${pub.id}/preview`}>
            <button className="btn btn-secondary btn-sm">Vista previa</button>
          </Link>
          <Link to={`/publications/${pub.id}/settings`}>
            <button className="btn btn-secondary btn-sm">⚙️</button>
          </Link>
          {!isPublished && (
            <button className="btn btn-sm" style={{ background: 'var(--color-success)', color: '#fff' }} onClick={onPublish}>
              Publicar
            </button>
          )}
          <button className="btn btn-sm" style={{ color: 'var(--color-danger)', marginLeft: 'auto' }} onClick={onDelete}>
            🗑️
          </button>
        </div>
      </div>
    </div>
  )
}

function TrashCard({ pub, onRestore, onDelete }: { pub: any; onRestore: () => void; onDelete: () => void }) {
  return (
    <div className="card" style={{ ...s.card, opacity: 0.8 }}>
      {pub.cover_image_url
        ? <img src={pub.cover_image_url} alt={pub.title} style={{ ...s.cover, filter: 'grayscale(60%)' }} />
        : <div style={s.coverPlaceholder}>📄</div>
      }
      <div style={s.cardBody}>
        <span style={s.cardTitle}>{pub.title}</span>
        <div style={s.cardActions}>
          <button className="btn btn-secondary btn-sm" onClick={onRestore}>↩ Restaurar</button>
          <button className="btn btn-danger btn-sm" onClick={onDelete}>Eliminar definitivo</button>
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page:    { minHeight: '100vh', position: 'relative' },
  loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--color-muted)' },
  inner:   { padding: '2rem', maxWidth: 1200, margin: '0 auto' },
  topBar:  { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem' },
  pageTitle:    { fontSize: 'var(--text-2xl)', fontWeight: 700, margin: 0 },
  pageSubtitle: { fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginTop: 4 },

  tabs:      { display: 'flex', gap: 4, borderBottom: '2px solid var(--color-border)', marginBottom: '1.5rem' },
  tab:       { background: 'none', border: 'none', padding: '10px 16px', fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-muted)', cursor: 'pointer', borderBottom: '2px solid transparent', marginBottom: -2, transition: 'color .15s' },
  tabActive: { color: 'var(--color-primary)', borderBottomColor: 'var(--color-primary)' },

  filterBar: { display: 'flex', gap: 10, marginBottom: '1.5rem', flexWrap: 'wrap' as const, alignItems: 'center' },

  grid:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' },
  card:  { padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  cover: { width: '100%', height: 160, objectFit: 'cover' as const, display: 'block' },
  coverPlaceholder: { height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, background: 'var(--color-surface)' },
  cardBody:    { padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 },
  cardTop:     { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  cardTitle:   { fontWeight: 600, fontSize: 'var(--text-sm)', flex: 1, lineHeight: 1.3 },
  cardMeta:    { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const },
  cardDate:    { fontSize: 'var(--text-xs)', color: 'var(--color-muted)' },
  cardActions: { display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginTop: 4 },

  empty: { textAlign: 'center', padding: '3rem', color: 'var(--color-muted)', display: 'flex', flexDirection: 'column', alignItems: 'center' },

  fab: {
    position: 'fixed',
    bottom: 32,
    right: 32,
    width: 52,
    height: 52,
    borderRadius: '50%',
    background: 'var(--color-primary)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 28,
    boxShadow: '0 4px 16px rgba(79,70,229,.4)',
    textDecoration: 'none',
    zIndex: 50,
    transition: 'background .15s, transform .15s',
  },
}
