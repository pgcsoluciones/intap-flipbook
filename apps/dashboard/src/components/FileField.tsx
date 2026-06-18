import { useRef, useState } from 'react'
import { api } from '../lib/api'

/**
 * FileField — campo de subida de recursos reutilizable.
 *
 * Combina tres formas de aportar un archivo:
 *   1) Botón "Examinar" (abre el explorador de archivos del sistema).
 *   2) Arrastrar y soltar el archivo sobre la zona.
 *   3) Pegar una URL externa manualmente (campo de respaldo).
 *
 * Al elegir/soltar un archivo lo sube a R2 vía `api.upload` (POST /api/upload)
 * y devuelve la URL pública resultante mediante `onChange`.
 *
 * Términos:
 *  - R2: almacenamiento de objetos de Cloudflare (como un bucket de archivos).
 *  - "drag & drop": arrastrar un archivo desde el escritorio y soltarlo en la zona.
 */
interface Props {
  /** URL actual del recurso (puede venir vacía). */
  value: string
  /** Se llama con la nueva URL cuando se sube un archivo o se escribe a mano. */
  onChange: (url: string) => void
  /** Tipos MIME aceptados. Por defecto imágenes. */
  accept?: string
  /** Texto de ayuda bajo la zona (ej. "JPG, PNG, SVG · máx 10 MB"). */
  hint?: string
  /** Si el recurso es imagen muestra miniatura de vista previa. */
  preview?: boolean
}

export default function FileField({ value, onChange, accept = 'image/jpeg,image/png,image/webp,image/svg+xml', hint, preview = true }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')

  async function uploadFile(file: File) {
    setError('')
    setUploading(true)
    try {
      const res = await api.upload(file)
      if (res?.data?.url) onChange(res.data.url)
      else throw new Error('Respuesta de subida inválida')
    } catch (e: any) {
      setError(e?.message ?? 'Error al subir el archivo')
    } finally {
      setUploading(false)
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) uploadFile(f)
    e.target.value = ''
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) uploadFile(f)
  }

  const isImage = preview && value && /\.(jpe?g|png|webp|svg|gif)$/i.test(value)

  return (
    <div>
      <div
        style={{
          ...st.zone,
          ...(dragOver ? st.zoneOver : {}),
          ...(uploading ? { opacity: 0.7, cursor: 'wait' } : {}),
        }}
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <input ref={inputRef} type="file" accept={accept} style={{ display: 'none' }} onChange={onPick} />
        {isImage ? (
          <img src={value} alt="preview" style={st.thumb} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        ) : (
          <div style={st.icon}>⬆</div>
        )}
        <div style={st.zoneText}>
          {uploading
            ? 'Subiendo…'
            : <><strong style={{ color: '#4f46e5' }}>Examinar</strong> o arrastra y suelta aquí</>}
        </div>
        {hint && <div style={st.hint}>{hint}</div>}
      </div>

      {/* Campo URL de respaldo (recurso externo ya alojado) */}
      <input
        style={st.urlInput}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="…o pega una URL: https://…"
      />
      {error && <div style={st.error}>{error}</div>}
    </div>
  )
}

const st: Record<string, React.CSSProperties> = {
  zone: {
    border: '2px dashed #c7d2fe', borderRadius: 10, padding: '14px 12px', textAlign: 'center',
    cursor: 'pointer', background: '#f8fafc', transition: 'background .15s, border-color .15s',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
  },
  zoneOver: { background: '#eef2ff', borderColor: '#4f46e5' },
  icon: { fontSize: 22, color: '#818cf8', lineHeight: 1 },
  thumb: { maxWidth: 90, maxHeight: 60, objectFit: 'contain', borderRadius: 6 },
  zoneText: { fontSize: 12, color: '#6b7280' },
  hint: { fontSize: 11, color: '#9ca3af' },
  urlInput: {
    width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '7px 10px',
    fontSize: 12, outline: 'none', boxSizing: 'border-box', marginTop: 6, color: '#6b7280',
  },
  error: { fontSize: 11, color: '#dc2626', marginTop: 4 },
}
