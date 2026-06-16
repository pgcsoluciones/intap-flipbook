import { useState, useRef } from 'react'
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

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export default function NewPublication() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [files, setFiles]           = useState<File[]>([])
  const [previews, setPreviews]     = useState<string[]>([])
  const [title, setTitle]           = useState('')
  const [category, setCategory]     = useState('catalogo')
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [progress, setProgress]     = useState('')
  const [isDragOver, setIsDragOver] = useState(false)

  function addFiles(incoming: FileList | null) {
    if (!incoming) return
    const valid = Array.from(incoming).filter((f) => ACCEPTED_TYPES.includes(f.type))
    if (valid.length === 0) return
    setFiles((prev) => {
      const next = [...prev, ...valid]
      // Generate object-URL previews for new files
      valid.forEach((f) => {
        setPreviews((p) => [...p, URL.createObjectURL(f)])
      })
      return next
    })
  }

  function removeFile(idx: number) {
    URL.revokeObjectURL(previews[idx])
    setFiles((prev) => prev.filter((_, i) => i !== idx))
    setPreviews((prev) => prev.filter((_, i) => i !== idx))
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setIsDragOver(true)
  }

  function handleDragLeave() {
    setIsDragOver(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragOver(false)
    addFiles(e.dataTransfer.files)
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    addFiles(e.target.files)
    // Reset so the same file can be re-selected
    e.target.value = ''
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!title.trim()) {
      setError('El nombre del flipbook es requerido.')
      return
    }
    setLoading(true)
    try {
      const pubRes = await api.publications.create({ title: title.trim(), description: '', category })
      const pubId: string = pubRes.data.id

      for (let i = 0; i < files.length; i++) {
        setProgress(`Subiendo imagen ${i + 1} de ${files.length}...`)
        const uploadRes = await api.upload(files[i])
        await api.pages.add(pubId, { image_url: uploadRes.data.url })
      }

      navigate(`/publications/${pubId}/editor`)
    } catch (err: any) {
      setError(err.message ?? 'Ocurrió un error. Intentá de nuevo.')
      setLoading(false)
      setProgress('')
    }
  }

  const dropZoneStyle: React.CSSProperties = {
    width: 600,
    height: 260,
    background: isDragOver ? '#eef2ff' : '#ffffff',
    border: `2px dashed ${isDragOver ? '#4f46e5' : '#c7d2fe'}`,
    borderRadius: 16,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    cursor: 'pointer',
    transition: 'border-color 0.2s, background 0.2s',
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
  }

  return (
    <div style={s.page}>
      {/* Top bar */}
      <div style={s.topBar}>
        <span style={s.brand}>Intap Flipbook</span>
        <div style={s.topRight}>
          <Link to="/publications" style={s.backLink}>← Volver</Link>
          <Link to="/templates">
            <button style={s.templateBtn}>Ver plantillas</button>
          </Link>
        </div>
      </div>

      {/* Center area */}
      <div style={s.center}>
        <h1 style={s.title}>Nuevo Flipbook</h1>
        <p style={s.subtitle}>Subí tus imágenes para crear un flipbook interactivo</p>

        {/* Drop zone */}
        <div
          style={dropZoneStyle}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <span style={{ fontSize: 48, lineHeight: 1 }}>📤</span>
          <p style={s.dropText}>Arrastrá tus imágenes aquí</p>
          <p style={s.dropOr}>o</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
            style={s.selectBtn}
          >
            Seleccionar archivos
          </button>
          <p style={s.dropHint}>Formatos: JPG, PNG, WEBP · Máx. 10 MB por imagen</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.webp"
            style={{ display: 'none' }}
            onChange={handleFileInput}
          />
        </div>

        {/* Image previews */}
        {files.length > 0 && (
          <div style={s.previewSection}>
            <p style={s.previewCount}>{files.length} {files.length === 1 ? 'imagen seleccionada' : 'imágenes seleccionadas'}</p>
            <div style={s.previewRow}>
              {previews.map((src, idx) => (
                <div key={idx} style={s.previewItem}>
                  <img src={src} alt={`imagen ${idx + 1}`} style={s.previewImg} />
                  <button
                    type="button"
                    style={s.removeBtn}
                    onClick={() => removeFile(idx)}
                    title="Quitar imagen"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Form fields */}
        <form onSubmit={handleSubmit} style={s.form}>
          <div style={s.field}>
            <label style={s.label}>Nombre del flipbook *</label>
            <input
              className="input"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej: Catálogo Temporada 2025"
              style={s.input}
            />
          </div>
          <div style={s.field}>
            <label style={s.label}>Categoría</label>
            <select
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={s.input}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {error && <p style={s.error}>{error}</p>}
          {progress && <p style={s.progressMsg}>{progress}</p>}

          <button
            className="btn btn-primary"
            type="submit"
            disabled={loading || !title.trim()}
            style={s.submitBtn}
          >
            {loading ? (progress || 'Procesando...') : 'Crear flipbook →'}
          </button>
        </form>

        {/* Separator */}
        <div style={s.separator}>
          <span style={s.separatorLine} />
          <span style={s.separatorText}>o</span>
          <span style={s.separatorLine} />
        </div>

        {/* Template card */}
        <Link to="/templates" style={{ textDecoration: 'none' }}>
          <div style={s.templateCard}>
            <span style={{ fontSize: 22 }}>🎨</span>
            <div>
              <p style={s.templateCardTitle}>Usar una plantilla</p>
              <p style={s.templateCardSub}>Ver plantillas disponibles →</p>
            </div>
          </div>
        </Link>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f4f6f9',
    display: 'flex',
    flexDirection: 'column',
  },

  // Top bar
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 32px',
    height: 60,
    background: '#ffffff',
    borderBottom: '1px solid #e5e7eb',
    boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
  },
  brand: {
    fontWeight: 700,
    fontSize: 18,
    color: '#4f46e5',
    letterSpacing: '-0.3px',
  },
  topRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  backLink: {
    color: '#6b7280',
    fontSize: 14,
    textDecoration: 'none',
    fontWeight: 500,
  },
  templateBtn: {
    background: 'transparent',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    padding: '6px 14px',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    color: '#374151',
  },

  // Center
  center: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '48px 24px 64px',
    gap: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: 800,
    color: '#111827',
    margin: 0,
    letterSpacing: '-0.5px',
  },
  subtitle: {
    fontSize: 16,
    color: '#6b7280',
    margin: 0,
  },

  // Previews
  previewSection: {
    width: 600,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  previewCount: {
    fontSize: 14,
    color: '#4f46e5',
    fontWeight: 600,
    margin: 0,
  },
  previewRow: {
    display: 'flex',
    flexDirection: 'row',
    gap: 10,
    overflowX: 'auto',
    paddingBottom: 4,
  },
  previewItem: {
    position: 'relative',
    flexShrink: 0,
  },
  previewImg: {
    width: 80,
    height: 110,
    objectFit: 'cover',
    borderRadius: 8,
    display: 'block',
    border: '1px solid #e5e7eb',
  },
  removeBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: '#ef4444',
    color: '#ffffff',
    border: 'none',
    cursor: 'pointer',
    fontSize: 10,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
    padding: 0,
  },

  // Form
  form: {
    width: 600,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: 600,
    color: '#374151',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
  },
  error: {
    color: '#dc2626',
    fontSize: 14,
    margin: 0,
    fontWeight: 500,
  },
  progressMsg: {
    color: '#4f46e5',
    fontSize: 14,
    margin: 0,
    fontWeight: 500,
  },
  submitBtn: {
    width: '100%',
    justifyContent: 'center',
    padding: '14px 0',
    fontSize: 16,
    fontWeight: 700,
    borderRadius: 10,
  },

  // Drop zone inner text
  dropText: {
    fontSize: 18,
    fontWeight: 600,
    color: '#374151',
    margin: 0,
  },
  dropOr: {
    fontSize: 14,
    color: '#9ca3af',
    margin: 0,
  },
  selectBtn: {
    padding: '10px 24px',
    fontSize: 15,
  },
  dropHint: {
    fontSize: 12,
    color: '#9ca3af',
    margin: 0,
    marginTop: 4,
  },

  // Separator
  separator: {
    width: 600,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  separatorLine: {
    flex: 1,
    height: 1,
    background: '#e5e7eb',
    display: 'block',
  },
  separatorText: {
    fontSize: 13,
    color: '#9ca3af',
    fontWeight: 500,
  },

  // Template link card
  templateCard: {
    width: 600,
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: '16px 20px',
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
    cursor: 'pointer',
    transition: 'box-shadow 0.15s',
  },
  templateCardTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: '#111827',
    margin: '0 0 2px',
  },
  templateCardSub: {
    fontSize: 13,
    color: '#4f46e5',
    margin: 0,
  },
}
