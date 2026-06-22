import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../lib/api'

const VIEWER_BASE = import.meta.env.VITE_VIEWER_BASE_URL ?? 'https://intap-flipbook-viewer.pages.dev'

const CATEGORY_LABELS: Record<string, string> = {
  catalogo:   'Catálogo de productos',
  menu:       'Menú de restaurante',
  portafolio: 'Portafolio',
  revista:    'Revista / Magazine',
  folleto:    'Folleto / Brochure',
  otro:       'Otro',
}

export default function PublicFeed() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>()
  const [pubs, setPubs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tenantSlug) return
    api.public.feed(tenantSlug)
      .then((r) => setPubs(r.data ?? []))
      .catch(() => setPubs([]))
      .finally(() => setLoading(false))
  }, [tenantSlug])

  if (loading) {
    return (
      <div style={styles.center}>
        <p style={{ color: '#6b7280' }}>Cargando...</p>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Flipbooks publicados</h1>
        {tenantSlug && <p style={styles.subtitle}>@{tenantSlug}</p>}
      </div>

      {pubs.length === 0 ? (
        <div style={styles.center}>
          <p style={styles.empty}>Este perfil no tiene publicaciones disponibles</p>
        </div>
      ) : (
        <div style={styles.grid}>
          {pubs.map((pub) => (
            <a
              key={pub.id}
              href={`${VIEWER_BASE}/${pub.public_slug}`}
              target="_blank"
              rel="noopener noreferrer"
              style={styles.card}
            >
              <div style={styles.cover}>
                {pub.cover_image_url ? (
                  <img
                    src={pub.cover_image_url}
                    alt={pub.title}
                    style={styles.coverImg}
                    loading="lazy"
                  />
                ) : (
                  <div style={styles.coverPlaceholder}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <path d="M3 9h18M9 21V9" />
                    </svg>
                  </div>
                )}
              </div>
              <div style={styles.cardBody}>
                <p style={styles.cardTitle}>{pub.title}</p>
                {pub.category && (
                  <span style={styles.categoryBadge}>
                    {CATEGORY_LABELS[pub.category] ?? pub.category}
                  </span>
                )}
                {pub.views_count > 0 && (
                  <p style={styles.views}>{pub.views_count} vista{pub.views_count !== 1 ? 's' : ''}</p>
                )}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page:              { fontFamily: 'Inter, system-ui, sans-serif', minHeight: '100vh', background: '#f8fafc', paddingBottom: '3rem' },
  header:            { background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '2rem 1.5rem', textAlign: 'center' },
  title:             { fontSize: '1.5rem', fontWeight: 700, color: '#111827', margin: '0 0 0.25rem' },
  subtitle:          { fontSize: '0.9rem', color: '#6b7280', margin: 0 },
  center:            { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' },
  empty:             { color: '#9ca3af', fontSize: '1rem', textAlign: 'center' },
  grid:              { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1.25rem', maxWidth: 1100, margin: '2rem auto', padding: '0 1.5rem' },
  card:              { background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #e5e7eb', textDecoration: 'none', color: 'inherit', transition: 'box-shadow .15s', display: 'block' },
  cover:             { width: '100%', aspectRatio: '3/4', background: '#f3f4f6', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  coverImg:          { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  coverPlaceholder:  { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' },
  cardBody:          { padding: '0.75rem 1rem' },
  cardTitle:         { fontSize: '0.9rem', fontWeight: 600, color: '#111827', margin: '0 0 0.4rem', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  categoryBadge:     { fontSize: '0.7rem', background: '#ede9fe', color: '#6d28d9', borderRadius: 12, padding: '2px 8px', fontWeight: 500 },
  views:             { fontSize: '0.75rem', color: '#9ca3af', margin: '0.4rem 0 0' },
}
