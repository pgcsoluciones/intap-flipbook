import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api } from '../lib/api'

function greeting(name: string) {
  const h = new Date().getHours()
  const saludo = h < 12 ? 'Buenos días' : h < 18 ? 'Buenas tardes' : 'Buenas noches'
  return `${saludo}, ${name}!`
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [user, setUser]   = useState<any>(null)
  const [pubs, setPubs]   = useState<any[]>([])
  const [usage, setUsage] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!localStorage.getItem('token')) { navigate('/login'); return }
    Promise.all([api.auth.me(), api.publications.list(), api.plan.usage()])
      .then(([u, p, us]) => { setUser(u.data); setPubs(p.data ?? []); setUsage(us.data) })
      .catch(() => { localStorage.removeItem('token'); navigate('/login') })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={s.loading}>Cargando...</div>

  const pubPct  = usage && !usage.publications.unlimited
    ? (usage.publications.used / usage.publications.max) * 100 : 0
  const storUnlimited = usage?.storage?.unlimited || usage?.storage?.max_mb === null
  const storPct = usage && !storUnlimited && usage.storage.max_mb > 0
    ? (usage.storage.used_mb / usage.storage.max_mb) * 100 : 0
  const showLimitWarning = pubPct > 80 || storPct > 80

  const firstName = user?.name ? user.name.split(' ')[0] : user?.email?.split('@')[0] ?? ''
  const recent = pubs.slice(0, 6)

  return (
    <div style={s.page}>

      {/* ── Banner de límite próximo ── */}
      {showLimitWarning && (
        <div style={{ ...s.banner, background: '#FFFBEB', borderColor: '#FDE68A' }}>
          <span style={{ color: '#92400E', fontSize: 'var(--text-sm)' }}>
            ⚠️ Estás cerca del límite de tu plan.{' '}
            <Link to="/plan" style={{ color: '#92400E', fontWeight: 600, textDecoration: 'underline' }}>
              Ver opciones de upgrade
            </Link>
          </span>
        </div>
      )}

      <div style={s.inner}>

        {/* ── Saludo ── */}
        <h1 style={s.greeting}>{greeting(firstName)}</h1>

        {/* ── Accesos rápidos ── */}
        <div style={s.quickRow}>
          <QuickCard
            icon="📤"
            title="Subir imágenes"
            desc="Crea un nuevo flipbook desde tus imágenes"
            cta="+ Subir imágenes"
            to="/publications/new"
            accent="var(--color-primary)"
          />
          <QuickCard
            icon="🎨"
            title="Usar plantilla"
            desc="Elegí un diseño profesional prediseñado"
            cta="Ver plantillas"
            to="/templates"
            accent="var(--color-accent)"
          />
          <QuickCard
            icon="💎"
            title="Mi plan"
            desc="Revisá tu uso y opciones de upgrade"
            cta="Ver mi plan"
            to="/plan"
            accent="var(--color-success)"
          />
        </div>

        {/* ── Uso del plan ── */}
        {usage && <UsageSection usage={usage} />}

        {/* ── Flipbooks recientes ── */}
        <section>
          <div style={s.sectionHeader}>
            <h2 style={s.sectionTitle}>Mis flipbooks recientes</h2>
            <Link to="/publications" style={s.seeAll}>Ver todos →</Link>
          </div>

          {recent.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-muted)' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
              <p style={{ marginBottom: 16 }}>Aún no tenés publicaciones.</p>
              <Link to="/publications/new">
                <button className="btn btn-primary">Crear mi primer flipbook</button>
              </Link>
            </div>
          ) : (
            <div style={s.pubGrid}>
              {recent.map((pub) => <PubCard key={pub.id} pub={pub} />)}
            </div>
          )}
        </section>

      </div>
    </div>
  )
}

/* ── Acceso rápido ── */
function QuickCard({ icon, title, desc, cta, to, accent }: {
  icon: string; title: string; desc: string; cta: string; to: string; accent: string
}) {
  return (
    <Link to={to} style={{ textDecoration: 'none', flex: 1, minWidth: 180 }}>
      <div className="card" style={{ ...s.quickCard, '--accent': accent } as any}>
        <div style={{ ...s.quickIcon, background: accent + '18', color: accent }}>{icon}</div>
        <div>
          <div style={s.quickTitle}>{title}</div>
          <div style={s.quickDesc}>{desc}</div>
        </div>
        <span style={{ ...s.quickCta, color: accent }}>{cta}</span>
      </div>
    </Link>
  )
}

/* ── Barras de uso ── */
function UsageSection({ usage }: { usage: any }) {
  const pubMax  = usage.publications.unlimited ? null : usage.publications.max
  const pubUsed = usage.publications.used
  const pubPct  = pubMax ? Math.min(100, (pubUsed / pubMax) * 100) : 0

  const storUsed = usage.storage.used_mb
  const storMax  = usage.storage.max_mb
  const storUnlimited = usage.storage.unlimited || storMax === null
  const storPct  = !storUnlimited && storMax > 0
    ? Math.min(100, (storUsed / storMax) * 100)
    : 0

  const pageMax = usage.features.max_pages_per_pub

  return (
    <div className="card" style={s.usageCard}>
      <h3 style={s.usageTitle}>Uso del plan</h3>
      <div style={s.usageGrid}>
        <UsageBar
          label="Publicaciones"
          value={pubMax ? `${pubUsed} / ${pubMax}` : `${pubUsed} (ilimitadas)`}
          pct={pubPct}
        />
        <UsageBar
          label="Almacenamiento"
          value={storUnlimited
            ? `${storUsed.toFixed(1)} MB / ilimitado`
            : `${storUsed.toFixed(1)} MB / ${storMax} MB`}
          pct={storPct}
        />
        <div style={s.usageStat}>
          <span style={s.usageLabel}>Páginas por flipbook</span>
          <span style={s.usageValue}>{pageMax ?? 'Ilimitadas'}</span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>máximo</span>
        </div>
      </div>
    </div>
  )
}

function UsageBar({ label, value, pct }: { label: string; value: string; pct: number }) {
  const fillClass = pct > 90 ? 'danger' : pct > 75 ? 'warning' : ''
  return (
    <div style={s.usageStat}>
      <span style={s.usageLabel}>{label}</span>
      <span style={s.usageValue}>{value}</span>
      <div className="progress-bar" style={{ marginTop: 6 }}>
        <div className={`progress-fill ${fillClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/* ── Tarjeta de publicación ── */
function PubCard({ pub }: { pub: any }) {
  const isPublished = pub.status === 'published'
  return (
    <div className="card" style={s.pubCard}>
      {pub.cover_image_url ? (
        <img src={pub.cover_image_url} alt={pub.title} style={s.pubCover} />
      ) : (
        <div style={s.pubCoverPlaceholder}>📄</div>
      )}
      <div style={s.pubBody}>
        <div style={s.pubTop}>
          <span style={s.pubTitle}>{pub.title}</span>
          <span className={`badge ${isPublished ? 'badge-success' : 'badge-warning'}`}>
            {isPublished ? 'Publicado' : 'Borrador'}
          </span>
        </div>
        <div style={s.pubMeta}>
          <span>📄 {pub.page_count ?? 0} páginas</span>
          <span>👁 {pub.views_count ?? 0} vistas</span>
        </div>
        <div style={s.pubActions}>
          <Link to={`/publications/${pub.id}/editor`}>
            <button className="btn btn-secondary btn-sm">Editar</button>
          </Link>
          <Link to={`/publications/${pub.id}/preview`}>
            <button className="btn btn-secondary btn-sm">Vista previa</button>
          </Link>
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page:    { minHeight: '100vh' },
  loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--color-muted)' },
  banner:  { padding: '12px 2rem', borderBottom: '1px solid', display: 'flex', alignItems: 'center' },
  inner:   { padding: '2rem', maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2rem' },
  greeting: { fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--color-text)', margin: 0 },

  quickRow:  { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' },
  quickCard: { display: 'flex', flexDirection: 'column', gap: 12, cursor: 'pointer', transition: 'box-shadow .15s', padding: 20 },
  quickIcon: { width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 },
  quickTitle: { fontWeight: 600, fontSize: 'var(--text-base)', marginBottom: 2 },
  quickDesc:  { fontSize: 'var(--text-sm)', color: 'var(--color-muted)' },
  quickCta:   { fontSize: 'var(--text-sm)', fontWeight: 600, marginTop: 'auto' },

  usageCard:  { padding: '20px 24px' },
  usageTitle: { fontWeight: 600, marginBottom: 16, fontSize: 'var(--text-base)' },
  usageGrid:  { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' },
  usageStat:  { display: 'flex', flexDirection: 'column', gap: 4 },
  usageLabel: { fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  usageValue: { fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)' },

  sectionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' },
  sectionTitle:  { fontSize: 'var(--text-lg)', fontWeight: 600, margin: 0 },
  seeAll:        { fontSize: 'var(--text-sm)', color: 'var(--color-primary)', fontWeight: 500 },

  pubGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' },
  pubCard: { padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  pubCover: { width: '100%', height: 160, objectFit: 'cover' as const, display: 'block' },
  pubCoverPlaceholder: { height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, background: 'var(--color-surface)' },
  pubBody:   { padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 },
  pubTop:    { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  pubTitle:  { fontWeight: 600, fontSize: 'var(--text-sm)', flex: 1, lineHeight: 1.3 },
  pubMeta:   { display: 'flex', gap: 12, fontSize: 'var(--text-xs)', color: 'var(--color-muted)' },
  pubActions:{ display: 'flex', gap: 8, marginTop: 4 },
}
