import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api } from '../lib/api'

const CATEGORIES = [
  { value: 'catalogo',   label: 'Catálogo de productos' },
  { value: 'menu',       label: 'Menú de restaurante' },
  { value: 'portafolio', label: 'Portafolio / Brochure' },
  { value: 'revista',    label: 'Revista' },
  { value: 'folleto',    label: 'Folleto' },
  { value: 'otro',       label: 'Otro' },
]

export default function NewPublication() {
  const navigate = useNavigate()
  const [title, setTitle]       = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('catalogo')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await api.publications.create({ title, description, category })
      navigate(`/publications/${res.data.id}/editor`)
    } catch (err: any) {
      setError(err.message ?? 'Error al crear la publicación')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={s.page}>
      <div style={s.inner}>

        <div style={s.back}>
          <Link to="/publications" style={{ color: 'var(--color-primary)', fontSize: 'var(--text-sm)' }}>
            ← Volver a mis flipbooks
          </Link>
        </div>

        <h1 style={s.title}>Nuevo flipbook</h1>
        <p style={s.subtitle}>Completá los datos y luego subí las imágenes en el editor.</p>

        <div style={s.options}>
          {/* Opción A: desde imágenes */}
          <div className="card" style={s.optionCard}>
            <div style={s.optionIcon}>📤</div>
            <h3 style={s.optionTitle}>Subir imágenes</h3>
            <p style={s.optionDesc}>Cargá tus propias imágenes y convertirlas en un flipbook.</p>

            <form onSubmit={handleSubmit} style={s.form}>
              <div style={s.field}>
                <label style={s.label}>Nombre del flipbook *</label>
                <input
                  className="input"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ej: Catálogo Temporada 2025"
                />
              </div>
              <div style={s.field}>
                <label style={s.label}>Descripción (opcional)</label>
                <textarea
                  className="input"
                  style={{ height: 72, resize: 'vertical' }}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Descripción breve..."
                />
              </div>
              <div style={s.field}>
                <label style={s.label}>Categoría</label>
                <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              {error && <p style={s.error}>{error}</p>}
              <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
                {loading ? 'Creando...' : 'Crear y agregar páginas →'}
              </button>
            </form>
          </div>

          {/* Opción B: desde plantilla */}
          <div className="card" style={{ ...s.optionCard, ...s.optionCardAlt }}>
            <div style={{ ...s.optionIcon, background: '#ECFEFF', color: 'var(--color-accent)' }}>🎨</div>
            <h3 style={s.optionTitle}>Usar plantilla</h3>
            <p style={s.optionDesc}>Elegí un diseño profesional y personalizalo con tus datos.</p>
            <Link to="/templates" style={{ marginTop: 'auto' }}>
              <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center' }}>
                Ver plantillas disponibles →
              </button>
            </Link>
          </div>
        </div>

      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page:    { minHeight: '100vh' },
  inner:   { padding: '2rem', maxWidth: 900, margin: '0 auto' },
  back:    { marginBottom: '1.5rem' },
  title:   { fontSize: 'var(--text-2xl)', fontWeight: 700, margin: '0 0 6px' },
  subtitle:{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginBottom: '2rem' },

  options: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', alignItems: 'start' },

  optionCard: { display: 'flex', flexDirection: 'column', gap: 12, padding: 24 },
  optionCardAlt: { background: 'var(--color-surface)' },
  optionIcon:  { width: 48, height: 48, borderRadius: 14, background: '#EFF6FF', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 },
  optionTitle: { fontSize: 'var(--text-lg)', fontWeight: 600, margin: 0 },
  optionDesc:  { fontSize: 'var(--text-sm)', color: 'var(--color-muted)', lineHeight: 1.5 },

  form:  { display: 'flex', flexDirection: 'column', gap: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-text)' },
  error: { color: 'var(--color-danger)', fontSize: 'var(--text-sm)' },
}
