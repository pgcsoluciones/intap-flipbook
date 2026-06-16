import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api } from '../lib/api'
import PlanBadge from '../components/PlanBadge'

export default function Dashboard() {
  const navigate = useNavigate()
  const [user, setUser] = useState<any>(null)
  const [pubs, setPubs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!localStorage.getItem('token')) { navigate('/login'); return }
    Promise.all([api.auth.me(), api.publications.list()])
      .then(([u, p]) => { setUser(u.data); setPubs(p.data) })
      .catch(() => { localStorage.removeItem('token'); navigate('/login') })
      .finally(() => setLoading(false))
  }, [])

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar esta publicación?')) return
    await api.publications.delete(id)
    setPubs((prev) => prev.filter((p) => p.id !== id))
  }

  async function handlePublish(id: string) {
    const res = await api.publications.publish(id)
    setPubs((prev) => prev.map((p) => (p.id === id ? res.data : p)))
  }

  function logout() { localStorage.removeItem('token'); navigate('/login') }

  if (loading) return <div style={styles.center}>Cargando...</div>

  return (
    <div style={styles.layout}>
      <header style={styles.header}>
        <span style={styles.logo}>📖 Intap Flipbook</span>
        <div style={styles.headerRight}>
          <PlanBadge plan={user?.plan_id} />
          <span style={{ fontSize: '0.875rem', color: '#666' }}>{user?.email}</span>
          <button style={styles.btnOutline} onClick={logout}>Salir</button>
        </div>
      </header>

      <main style={styles.main}>
        <div style={styles.topBar}>
          <h2 style={{ margin: 0 }}>Mis publicaciones</h2>
          <Link to="/new"><button style={styles.btnPrimary}>+ Nueva publicación</button></Link>
        </div>

        {pubs.length === 0 ? (
          <div style={styles.empty}>
            <p>Aún no tienes publicaciones.</p>
            <Link to="/new"><button style={styles.btnPrimary}>Crear la primera</button></Link>
          </div>
        ) : (
          <div style={styles.grid}>
            {pubs.map((pub) => (
              <div key={pub.id} style={styles.card}>
                {pub.cover_image_url ? (
                  <img src={pub.cover_image_url} alt={pub.title} style={styles.cover} />
                ) : (
                  <div style={styles.coverPlaceholder}>📄</div>
                )}
                <div style={styles.cardBody}>
                  <h3 style={styles.cardTitle}>{pub.title}</h3>
                  <p style={styles.cardMeta}>
                    {pub.page_count ?? 0} páginas ·{' '}
                    <span style={{ color: pub.status === 'published' ? '#38a169' : '#dd6b20' }}>
                      {pub.status === 'published' ? 'Publicado' : 'Borrador'}
                    </span>
                  </p>
                  <div style={styles.cardActions}>
                    <Link to={`/edit/${pub.id}`}><button style={styles.btnSm}>Editar</button></Link>
                    <Link to={`/preview/${pub.id}`}><button style={styles.btnSm}>Vista previa</button></Link>
                    {pub.status === 'draft' && (
                      <button style={{ ...styles.btnSm, background: '#38a169', color: '#fff' }} onClick={() => handlePublish(pub.id)}>
                        Publicar
                      </button>
                    )}
                    <button style={{ ...styles.btnSm, background: '#e53e3e', color: '#fff' }} onClick={() => handleDelete(pub.id)}>
                      Eliminar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  layout: { minHeight: '100vh', background: '#f7f8fa', fontFamily: 'system-ui, sans-serif' },
  header: { background: '#fff', borderBottom: '1px solid #eee', padding: '0 2rem', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 },
  logo: { fontWeight: 700, fontSize: '1.1rem' },
  headerRight: { display: 'flex', alignItems: 'center', gap: '1rem' },
  main: { maxWidth: 1100, margin: '0 auto', padding: '2rem' },
  topBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1.5rem' },
  card: { background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,.06)' },
  cover: { width: '100%', height: 160, objectFit: 'cover' },
  coverPlaceholder: { height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '3rem', background: '#f0f2f5' },
  cardBody: { padding: '1rem' },
  cardTitle: { margin: '0 0 0.25rem', fontSize: '1rem', fontWeight: 600 },
  cardMeta: { color: '#666', fontSize: '0.8rem', margin: '0 0 0.75rem' },
  cardActions: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' },
  btnPrimary: { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '0.6rem 1.2rem', fontWeight: 600, cursor: 'pointer' },
  btnOutline: { background: 'none', border: '1px solid #ddd', borderRadius: 8, padding: '0.4rem 0.8rem', cursor: 'pointer' },
  btnSm: { padding: '0.3rem 0.7rem', borderRadius: 6, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: '0.8rem' },
  center: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' },
  empty: { textAlign: 'center', padding: '4rem', color: '#666' },
}
