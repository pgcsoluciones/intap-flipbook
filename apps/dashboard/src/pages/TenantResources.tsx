import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE } from '../lib/api'

function authH() {
  const t = localStorage.getItem('token')
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

type Resource = {
  id: number
  name: string
  type: 'icon' | 'background' | 'shape' | 'button'
  preview_url: string
  min_plan: 'free' | 'basic' | 'pro'
  active: boolean
}

const PLAN_ORDER: Record<string, number> = { free: 0, basic: 1, pro: 2 }
const PLAN_COLOR: Record<string, string> = { free: '#6b7280', basic: '#4f46e5', pro: '#7c3aed' }
const PLAN_LABEL: Record<string, string> = { free: 'Free', basic: 'Basic', pro: 'Pro' }

const TABS: { key: Resource['type']; label: string }[] = [
  { key: 'icon',       label: 'Íconos' },
  { key: 'background', label: 'Fondos' },
  { key: 'shape',      label: 'Formas' },
  { key: 'button',     label: 'Botones' },
]

// TODO: reemplazar con datos reales cuando GET /api/resources esté implementado
const MOCK_RESOURCES: Resource[] = [
  { id: 1, name: 'Ícono Estrella', type: 'icon', preview_url: '', min_plan: 'free', active: true },
  { id: 2, name: 'Fondo Madera', type: 'background', preview_url: '', min_plan: 'basic', active: true },
  { id: 3, name: 'Forma Círculo', type: 'shape', preview_url: '', min_plan: 'free', active: true },
  { id: 4, name: 'Botón Primario', type: 'button', preview_url: '', min_plan: 'pro', active: true },
]

export default function TenantResources() {
  const navigate = useNavigate()
  const [resources, setResources] = useState<Resource[]>([])
  const [userPlan, setUserPlan]   = useState<string>('free')
  const [activeTab, setActiveTab] = useState<Resource['type']>('icon')
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    if (!localStorage.getItem('token')) { navigate('/login'); return }
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const [rr, ur] = await Promise.all([
        fetch(`${API_BASE}/api/resources`, { headers: authH() }),
        fetch(`${API_BASE}/auth/me`, { headers: authH() }),
      ])
      if (rr.ok) {
        const rd = await rr.json()
        setResources(rd.data ?? [])
      } else {
        setResources(MOCK_RESOURCES)
      }
      if (ur.ok) {
        const ud = await ur.json()
        setUserPlan(ud.data?.plan_id ?? 'free')
      }
    } catch {
      setResources(MOCK_RESOURCES)
    } finally {
      setLoading(false)
    }
  }

  const filtered = resources.filter((r) => r.type === activeTab)

  function isLocked(res: Resource) {
    return PLAN_ORDER[res.min_plan] > PLAN_ORDER[userPlan]
  }

  if (loading) return <div style={s.loading}>Cargando recursos...</div>

  return (
    <div style={s.page}>
      <div style={s.inner}>
        <div style={s.pageHeader}>
          <h1 style={s.h1}>Recursos del editor</h1>
          <p style={s.sub}>Elementos disponibles para enriquecer tus flipbooks</p>
        </div>

        <div style={s.tabBar}>
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{ ...s.tab, ...(activeTab === tab.key ? s.tabActive : {}) }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div style={s.empty}>
            <div style={s.emptyIcon}>🗂️</div>
            <p>El administrador aún no ha cargado recursos.</p>
          </div>
        ) : (
          <div style={s.grid}>
            {filtered.map((res) => {
              const locked = isLocked(res)
              return (
                <div key={res.id} style={{ ...s.card, opacity: locked ? 0.8 : 1 }}>
                  <div style={s.preview}>
                    {res.preview_url ? (
                      <img src={res.preview_url} alt={res.name} style={s.previewImg} />
                    ) : (
                      <div style={s.previewPlaceholder}>
                        {res.type === 'icon' ? '⭐' : res.type === 'background' ? '🖼️' : res.type === 'shape' ? '🔷' : '🔲'}
                      </div>
                    )}
                    {locked && (
                      <div style={s.lockOverlay}>
                        <span style={s.lockIcon}>🔒</span>
                      </div>
                    )}
                  </div>
                  <div style={s.cardBody}>
                    <span style={s.cardName}>{res.name}</span>
                    <div style={s.cardMeta}>
                      <span style={{ ...s.planBadge, background: PLAN_COLOR[res.min_plan] }}>
                        {PLAN_LABEL[res.min_plan]}
                      </span>
                      {locked && (
                        <span style={s.lockedLabel}>Requiere {PLAN_LABEL[res.min_plan]}</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page:             { minHeight: '100vh', background: '#f8fafc' },
  loading:          { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#6b7280' },
  inner:            { maxWidth: 1100, margin: '0 auto', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' },
  pageHeader:       { display: 'flex', flexDirection: 'column', gap: 4 },
  h1:               { fontSize: '1.5rem', fontWeight: 800, color: '#111827', margin: 0 },
  sub:              { color: '#6b7280', fontSize: 14, margin: 0 },
  tabBar:           { display: 'flex', gap: 0, background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', padding: 4, alignSelf: 'flex-start' },
  tab:              { border: 'none', background: 'transparent', borderRadius: 8, padding: '7px 18px', fontSize: 13, cursor: 'pointer', color: '#6b7280', fontWeight: 500 },
  tabActive:        { background: '#4f46e5', color: '#fff', fontWeight: 600 },
  empty:            { textAlign: 'center', padding: '4rem', color: '#9ca3af', background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb' },
  emptyIcon:        { fontSize: 48, marginBottom: 12 },
  grid:             { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1rem' },
  card:             { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  preview:          { position: 'relative', height: 120, background: '#f9fafb' },
  previewImg:       { width: '100%', height: '100%', objectFit: 'contain', display: 'block', padding: 8 },
  previewPlaceholder: { height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36 },
  lockOverlay:      { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  lockIcon:         { fontSize: 24 },
  cardBody:         { padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 },
  cardName:         { fontWeight: 600, fontSize: 13, color: '#111827' },
  cardMeta:         { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  planBadge:        { fontSize: 10, color: '#fff', borderRadius: 10, padding: '2px 7px', fontWeight: 600 },
  lockedLabel:      { fontSize: 10, color: '#9ca3af' },
}
