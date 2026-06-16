import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE } from '../lib/api'

function authH() {
  const t = localStorage.getItem('token')
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

type Template = {
  id: number
  name: string
  category: string
  cover_url: string
  min_plan: 'free' | 'basic' | 'pro'
  active: boolean
}

const PLAN_ORDER: Record<string, number> = { free: 0, basic: 1, pro: 2 }
const PLAN_COLOR: Record<string, string> = { free: '#6b7280', basic: '#4f46e5', pro: '#7c3aed' }
const PLAN_LABEL: Record<string, string> = { free: 'Free', basic: 'Basic', pro: 'Pro' }

const CATEGORIES = ['Todos', 'Catálogo', 'Menú', 'Portafolio', 'Revista', 'Folleto', 'Otro']

// TODO: reemplazar con datos reales cuando GET /api/templates esté implementado
const MOCK_TEMPLATES: Template[] = [
  { id: 1, name: 'Catálogo Primavera', category: 'Catálogo', cover_url: '', min_plan: 'free', active: true },
  { id: 2, name: 'Menú Restaurante', category: 'Menú', cover_url: '', min_plan: 'basic', active: true },
  { id: 3, name: 'Portafolio Creativo', category: 'Portafolio', cover_url: '', min_plan: 'pro', active: true },
]

export default function TenantTemplates() {
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<Template[]>([])
  const [userPlan, setUserPlan]   = useState<string>('free')
  const [category, setCategory]   = useState('Todos')
  const [loading, setLoading]     = useState(true)
  const [preview, setPreview]     = useState<Template | null>(null)

  useEffect(() => {
    if (!localStorage.getItem('token')) { navigate('/login'); return }
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const [tr, ur] = await Promise.all([
        fetch(`${API_BASE}/api/templates`, { headers: authH() }),
        fetch(`${API_BASE}/auth/me`, { headers: authH() }),
      ])
      if (tr.ok) {
        const td = await tr.json()
        setTemplates(td.data ?? [])
      } else {
        setTemplates(MOCK_TEMPLATES)
      }
      if (ur.ok) {
        const ud = await ur.json()
        setUserPlan(ud.data?.plan_id ?? 'free')
      }
    } catch {
      setTemplates(MOCK_TEMPLATES)
    } finally {
      setLoading(false)
    }
  }

  const filtered = category === 'Todos'
    ? templates
    : templates.filter((t) => t.category.toLowerCase() === category.toLowerCase())

  function isLocked(tpl: Template) {
    return PLAN_ORDER[tpl.min_plan] > PLAN_ORDER[userPlan]
  }

  function handleUse(tpl: Template) {
    if (isLocked(tpl)) return
    alert('Próximamente')
  }

  if (loading) return <div style={s.loading}>Cargando plantillas...</div>

  return (
    <div style={s.page}>
      <div style={s.inner}>
        <div style={s.pageHeader}>
          <h1 style={s.h1}>Plantillas</h1>
          <p style={s.sub}>Elegí un diseño profesional para empezar rápido</p>
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
            <div style={s.emptyIcon}>🎨</div>
            <p>El administrador aún no ha cargado plantillas.</p>
          </div>
        ) : (
          <div style={s.grid}>
            {filtered.map((tpl) => {
              const locked = isLocked(tpl)
              return (
                <div key={tpl.id} style={{ ...s.card, opacity: locked ? 0.8 : 1 }}>
                  <div style={s.thumb}>
                    {tpl.cover_url ? (
                      <img src={tpl.cover_url} alt={tpl.name} style={s.thumbImg} />
                    ) : (
                      <div style={s.thumbPlaceholder}>📄</div>
                    )}
                    {locked && (
                      <div style={s.lockOverlay}>
                        <div style={s.lockBadge}>
                          🔒 Disponible en plan {PLAN_LABEL[tpl.min_plan]}
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={s.cardBody}>
                    <div style={s.cardTop}>
                      <span style={s.cardName}>{tpl.name}</span>
                      <span style={{ ...s.planBadge, background: PLAN_COLOR[tpl.min_plan] }}>
                        {PLAN_LABEL[tpl.min_plan]}
                      </span>
                    </div>
                    <span style={s.catBadge}>{tpl.category}</span>
                    <button
                      onClick={() => locked ? undefined : setPreview(tpl)}
                      disabled={locked}
                      style={{ ...s.useBtn, ...(locked ? s.useBtnLocked : {}) }}
                    >
                      {locked ? `Requiere plan ${PLAN_LABEL[tpl.min_plan]}` : 'Ver plantilla'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {preview && (
        <div style={s.modalOverlay} onClick={() => setPreview(null)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={s.modalTitle}>{preview.name}</h2>
            <div style={s.modalThumb}>
              {preview.cover_url ? (
                <img src={preview.cover_url} alt={preview.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }} />
              ) : (
                <div style={{ ...s.thumbPlaceholder, height: 260, fontSize: 60, borderRadius: 8 }}>📄</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button onClick={() => setPreview(null)} style={s.btnSecondary}>Cerrar</button>
              <button onClick={() => { handleUse(preview); setPreview(null) }} style={s.btnPrimary}>
                Usar esta plantilla
              </button>
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
  card:           { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  thumb:          { position: 'relative', height: 160, background: '#f3f4f6' },
  thumbImg:       { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  thumbPlaceholder: { height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 },
  lockOverlay:    { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  lockBadge:      { background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 12, padding: '6px 12px', borderRadius: 20, fontWeight: 600 },
  cardBody:       { padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 },
  cardTop:        { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardName:       { fontWeight: 600, fontSize: 14, color: '#111827', flex: 1 },
  planBadge:      { fontSize: 10, color: '#fff', borderRadius: 10, padding: '2px 8px', fontWeight: 600 },
  catBadge:       { fontSize: 11, color: '#6b7280', background: '#f3f4f6', borderRadius: 8, padding: '2px 8px', alignSelf: 'flex-start' },
  useBtn:         { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontWeight: 600, cursor: 'pointer', fontSize: 13, marginTop: 4 },
  useBtnLocked:   { background: '#e5e7eb', color: '#9ca3af', cursor: 'not-allowed' },
  modalOverlay:   { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  modal:          { background: '#fff', borderRadius: 16, padding: '2rem', width: '90%', maxWidth: 520 },
  modalTitle:     { fontSize: '1.2rem', fontWeight: 700, color: '#111827', margin: '0 0 1rem' },
  modalThumb:     { height: 260, background: '#f3f4f6', borderRadius: 8, overflow: 'hidden' },
  btnPrimary:     { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontWeight: 600, cursor: 'pointer', fontSize: 14 },
  btnSecondary:   { background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 18px', fontWeight: 600, cursor: 'pointer', fontSize: 14 },
}
