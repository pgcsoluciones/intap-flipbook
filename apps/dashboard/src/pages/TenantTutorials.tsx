import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE } from '../lib/api'

function authH() {
  const t = localStorage.getItem('token')
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

type Tutorial = {
  id: number
  title: string
  category: string
  type: 'video' | 'guide'
  thumbnail_url: string
  url: string
  content: string
  active: boolean
}

const CATEGORIES = ['Todos', 'Primeros pasos', 'Editor', 'Publicar y compartir', 'Planes y pagos']

const TYPE_LABEL: Record<string, string> = { video: 'Video', guide: 'Guía' }
const TYPE_COLOR: Record<string, string> = { video: '#dc2626', guide: '#059669' }

// TODO: reemplazar con datos reales cuando GET /api/tutorials esté implementado
const MOCK_TUTORIALS: Tutorial[] = [
  { id: 1, title: 'Cómo crear tu primer flipbook', category: 'Primeros pasos', type: 'video', thumbnail_url: '', url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', content: '', active: true },
  { id: 2, title: 'Agregar y ordenar páginas', category: 'Editor', type: 'guide', thumbnail_url: '', url: '', content: 'Para agregar páginas a tu flipbook, accedé al editor y hacé click en "Subir imágenes". Podés reordenar las páginas arrastrándolas o usando los botones ↑ ↓.', active: true },
  { id: 3, title: 'Publicar y compartir tu flipbook', category: 'Publicar y compartir', type: 'video', thumbnail_url: '', url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', content: '', active: true },
]

export default function TenantTutorials() {
  const navigate = useNavigate()
  const [tutorials, setTutorials] = useState<Tutorial[]>([])
  const [category, setCategory]   = useState('Todos')
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState<Tutorial | null>(null)

  useEffect(() => {
    if (!localStorage.getItem('token')) { navigate('/login'); return }
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const r = await fetch(`${API_BASE}/api/tutorials`, { headers: authH() })
      if (r.ok) {
        const d = await r.json()
        setTutorials(d.data ?? [])
      } else {
        setTutorials(MOCK_TUTORIALS)
      }
    } catch {
      setTutorials(MOCK_TUTORIALS)
    } finally {
      setLoading(false)
    }
  }

  async function markViewed(id: number) {
    try {
      await fetch(`${API_BASE}/api/tutorials/${id}/view`, { method: 'POST', headers: authH() })
    } catch {
      // Si falla, se ignora silenciosamente
    }
  }

  function openTutorial(tpl: Tutorial) {
    setSelected(tpl)
    markViewed(tpl.id)
  }

  const filtered = category === 'Todos'
    ? tutorials
    : tutorials.filter((t) => t.category === category)

  if (loading) return <div style={s.loading}>Cargando tutoriales...</div>

  return (
    <div style={s.page}>
      <div style={s.inner}>
        <div style={s.pageHeader}>
          <h1 style={s.h1}>Tutoriales</h1>
          <p style={s.sub}>Aprendé a sacarle el máximo partido a tu flipbook</p>
        </div>

        <div style={s.filterRow}>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              style={{ ...s.filterBtn, ...(category === cat ? s.filterBtnActive : {}) }}
            >
              {cat}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div style={s.empty}>
            <div style={s.emptyIcon}>🎓</div>
            <p>Próximamente encontrarás guías y videos aquí.</p>
          </div>
        ) : (
          <div style={s.grid}>
            {filtered.map((tpl) => (
              <div key={tpl.id} style={s.card} onClick={() => openTutorial(tpl)}>
                <div style={s.thumb}>
                  {tpl.thumbnail_url ? (
                    <img src={tpl.thumbnail_url} alt={tpl.title} style={s.thumbImg} />
                  ) : (
                    <div style={s.thumbPlaceholder}>
                      {tpl.type === 'video' ? '▶️' : '📖'}
                    </div>
                  )}
                  <span style={{ ...s.typeBadge, background: TYPE_COLOR[tpl.type] }}>
                    {TYPE_LABEL[tpl.type]}
                  </span>
                </div>
                <div style={s.cardBody}>
                  <span style={s.catBadge}>{tpl.category}</span>
                  <p style={s.cardTitle}>{tpl.title}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div style={s.modalOverlay} onClick={() => setSelected(null)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h2 style={s.modalTitle}>{selected.title}</h2>
              <button onClick={() => setSelected(null)} style={s.closeBtn}>✕</button>
            </div>
            <span style={{ ...s.typeBadge, background: TYPE_COLOR[selected.type], marginBottom: 16, display: 'inline-block' }}>
              {TYPE_LABEL[selected.type]}
            </span>

            {selected.type === 'video' && selected.url ? (
              <div style={s.videoWrap}>
                <iframe
                  src={selected.url}
                  style={{ width: '100%', height: '100%', border: 'none', borderRadius: 8 }}
                  allowFullScreen
                  title={selected.title}
                />
              </div>
            ) : (
              <div style={s.guideContent}>
                {selected.content || 'Contenido próximamente disponible.'}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setSelected(null)} style={s.btnSecondary}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page:           { minHeight: '100vh', background: '#f8fafc' },
  loading:        { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#6b7280' },
  inner:          { maxWidth: 1100, margin: '0 auto', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' },
  pageHeader:     { display: 'flex', flexDirection: 'column', gap: 4 },
  h1:             { fontSize: '1.5rem', fontWeight: 800, color: '#111827', margin: 0 },
  sub:            { color: '#6b7280', fontSize: 14, margin: 0 },
  filterRow:      { display: 'flex', gap: 8, flexWrap: 'wrap' },
  filterBtn:      { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 20, padding: '5px 14px', fontSize: 13, cursor: 'pointer', color: '#374151', fontWeight: 500 },
  filterBtnActive:{ background: '#4f46e5', border: '1px solid #4f46e5', color: '#fff' },
  empty:          { textAlign: 'center', padding: '4rem', color: '#9ca3af', background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb' },
  emptyIcon:      { fontSize: 48, marginBottom: 12 },
  grid:           { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' },
  card:           { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', cursor: 'pointer', display: 'flex', flexDirection: 'column', transition: 'box-shadow .15s' },
  thumb:          { position: 'relative', height: 150, background: '#f3f4f6' },
  thumbImg:       { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  thumbPlaceholder: { height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 },
  typeBadge:      { position: 'absolute', top: 10, left: 10, fontSize: 10, color: '#fff', borderRadius: 10, padding: '2px 8px', fontWeight: 600 },
  cardBody:       { padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 },
  catBadge:       { fontSize: 11, color: '#6b7280', background: '#f3f4f6', borderRadius: 8, padding: '2px 8px', alignSelf: 'flex-start' },
  cardTitle:      { fontWeight: 600, fontSize: 14, color: '#111827', margin: 0, lineHeight: 1.4 },
  modalOverlay:   { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  modal:          { background: '#fff', borderRadius: 16, padding: '1.5rem', width: '90%', maxWidth: 640 },
  modalHeader:    { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8, gap: 12 },
  modalTitle:     { fontSize: '1.1rem', fontWeight: 700, color: '#111827', margin: 0, flex: 1 },
  closeBtn:       { background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', color: '#374151', fontSize: 16 },
  videoWrap:      { height: 320, background: '#000', borderRadius: 8, overflow: 'hidden' },
  guideContent:   { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '1rem', fontSize: 14, color: '#374151', lineHeight: 1.6, whiteSpace: 'pre-wrap' },
  btnSecondary:   { background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 18px', fontWeight: 600, cursor: 'pointer', fontSize: 14 },
}
