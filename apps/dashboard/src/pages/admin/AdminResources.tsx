import { useState } from 'react'
import AdminResourcesTemplates from './AdminResourcesTemplates'
import AdminResourcesElements from './AdminResourcesElements'
import AdminResourcesTutorials from './AdminResourcesTutorials'

type Tab = 'templates' | 'elements' | 'tutorials'

const TABS: { key: Tab; label: string }[] = [
  { key: 'templates', label: 'Plantillas' },
  { key: 'elements',  label: 'Elementos' },
  { key: 'tutorials', label: 'Tutoriales' },
]

const TAB_SUBTITLES: Record<Tab, string> = {
  templates: 'Plantillas prediseñadas para nuevas publicaciones',
  elements:  'Iconos, fondos, formas y botones para el canvas del editor',
  tutorials: 'Guias y videos de ayuda para los usuarios',
}

export default function AdminResources() {
  const [tab, setTab] = useState<Tab>('templates')

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>Recursos</h1>
          <p style={s.sub}>{TAB_SUBTITLES[tab]}</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={s.tabBar}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{ ...s.tabBtn, ...(tab === t.key ? s.tabBtnActive : {}) }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Sub-componente activo */}
      <div style={s.content}>
        {tab === 'templates' && <AdminResourcesTemplates />}
        {tab === 'elements'  && <AdminResourcesElements />}
        {tab === 'tutorials' && <AdminResourcesTutorials />}
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page:       { padding: '2rem 1.5rem' },
  header:     { marginBottom: '1.25rem' },
  h1:         { fontSize: '1.5rem', fontWeight: 800, color: '#111827', margin: 0 },
  sub:        { color: '#6b7280', fontSize: 13, margin: '4px 0 0' },
  tabBar:     { display: 'flex', gap: 4, marginBottom: '1.5rem', borderBottom: '2px solid #e5e7eb', paddingBottom: 0 },
  tabBtn:     {
    background: 'none', border: 'none', borderRadius: 0, padding: '8px 18px',
    cursor: 'pointer', fontSize: 14, fontWeight: 500, color: '#6b7280',
    borderBottom: '2px solid transparent', marginBottom: -2, transition: 'color 0.15s',
  },
  tabBtnActive: { color: '#4f46e5', borderBottom: '2px solid #4f46e5', fontWeight: 700 },
  content:    { paddingTop: 4 },
}
