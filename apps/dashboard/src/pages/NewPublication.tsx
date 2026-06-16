import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api } from '../lib/api'

export default function NewPublication() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('catalog')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await api.publications.create({ title, description, category })
      navigate(`/edit/${res.data.id}`)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <div style={styles.back}><Link to="/">← Volver</Link></div>
        <h2 style={styles.title}>Nueva publicación</h2>
        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>Título *</label>
          <input style={styles.input} required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Catálogo Temporada 2025" />

          <label style={styles.label}>Descripción</label>
          <textarea style={{ ...styles.input, height: 80, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descripción breve (opcional)" />

          <label style={styles.label}>Categoría</label>
          <select style={styles.input} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="catalog">Catálogo de productos</option>
            <option value="menu">Menú de restaurante</option>
            <option value="portfolio">Portfolio / Brochure</option>
          </select>

          {error && <p style={styles.error}>{error}</p>}
          <button style={styles.btn} type="submit" disabled={loading}>
            {loading ? 'Creando...' : 'Crear y agregar páginas'}
          </button>
        </form>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { minHeight: '100vh', background: '#f7f8fa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' },
  card: { background: '#fff', borderRadius: 12, padding: '2rem', width: '100%', maxWidth: 480, boxShadow: '0 4px 24px rgba(0,0,0,.08)' },
  back: { marginBottom: '1rem', fontSize: '0.875rem' },
  title: { margin: '0 0 1.5rem', fontWeight: 700 },
  form: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  label: { fontWeight: 500, fontSize: '0.875rem', color: '#444' },
  input: { padding: '0.75rem', borderRadius: 8, border: '1px solid #ddd', fontSize: '1rem', width: '100%', boxSizing: 'border-box' },
  error: { color: '#e53e3e', fontSize: '0.875rem' },
  btn: { marginTop: '0.5rem', padding: '0.75rem', borderRadius: 8, background: '#4f46e5', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: '1rem' },
}
