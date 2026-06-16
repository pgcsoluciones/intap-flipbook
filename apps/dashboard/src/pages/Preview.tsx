import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../lib/api'

export default function Preview() {
  const { id } = useParams<{ id: string }>()
  const [pub, setPub] = useState<any>(null)
  const VIEWER_BASE = import.meta.env.VITE_VIEWER_BASE_URL ?? 'https://view.intapflipbook.com'

  useEffect(() => {
    if (id) api.publications.get(id).then((r) => setPub(r.data))
  }, [id])

  if (!pub) return <div style={{ textAlign: 'center', padding: '4rem' }}>Cargando...</div>

  const viewerUrl = pub.public_slug ? `${VIEWER_BASE}/view/${pub.public_slug}` : null

  return (
    <div style={styles.layout}>
      <header style={styles.header}>
        <Link to={`/edit/${id}`}>← Editar</Link>
        <span style={styles.title}>{pub.title}</span>
        <div />
      </header>

      <main style={styles.main}>
        {viewerUrl && (
          <div style={styles.linkBox}>
            <span style={styles.linkLabel}>Link público:</span>
            <a href={viewerUrl} target="_blank" rel="noopener noreferrer" style={styles.link}>
              {viewerUrl}
            </a>
            <button style={styles.copyBtn} onClick={() => navigator.clipboard.writeText(viewerUrl)}>
              Copiar
            </button>
          </div>
        )}

        {pub.status !== 'published' && (
          <p style={styles.warning}>Esta publicación está en borrador. Publícala para que sea visible.</p>
        )}

        {viewerUrl ? (
          <iframe
            src={viewerUrl}
            style={styles.iframe}
            title="Flipbook Preview"
            allow="autoplay"
          />
        ) : (
          <p style={{ textAlign: 'center', color: '#666' }}>Sin link público disponible.</p>
        )}
      </main>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  layout: { minHeight: '100vh', background: '#1a1a2e', fontFamily: 'system-ui, sans-serif', color: '#fff' },
  header: { background: 'rgba(255,255,255,.05)', borderBottom: '1px solid rgba(255,255,255,.1)', padding: '0 2rem', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontWeight: 600 },
  main: { maxWidth: 1000, margin: '0 auto', padding: '2rem' },
  linkBox: { background: 'rgba(255,255,255,.08)', borderRadius: 8, padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' },
  linkLabel: { fontSize: '0.875rem', color: '#aaa', whiteSpace: 'nowrap' },
  link: { color: '#818cf8', wordBreak: 'break-all', flex: 1 },
  copyBtn: { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 6, padding: '0.3rem 0.8rem', cursor: 'pointer', whiteSpace: 'nowrap' },
  warning: { background: '#744210', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.875rem' },
  iframe: { width: '100%', height: '75vh', border: 'none', borderRadius: 12 },
}
