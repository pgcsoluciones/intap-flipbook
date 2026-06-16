import { useRef, useState } from 'react'

interface Props {
  onUpload: (file: File) => Promise<void>
  uploading: boolean
  compact?: boolean
}

export default function ImageUploader({ onUpload, uploading, compact }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  async function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter((f) =>
      ['image/jpeg', 'image/png', 'image/webp'].includes(f.type),
    )
    if (arr.length === 0) return
    setProgress({ done: 0, total: arr.length })
    for (let i = 0; i < arr.length; i++) {
      await onUpload(arr[i])
      setProgress({ done: i + 1, total: arr.length })
    }
    setProgress(null)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) { handleFiles(e.target.files); e.target.value = '' }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files)
  }

  const busy = uploading || !!progress

  return (
    <div
      style={{ ...styles.zone, ...(compact ? styles.zoneCompact : {}), opacity: busy ? 0.8 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}
      onClick={() => !busy && inputRef.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        style={{ display: 'none' }}
        onChange={handleChange}
      />
      {progress ? (
        <>
          {!compact && <p style={styles.icon}>⏳</p>}
          <p style={styles.text}>{compact ? `${progress.done}/${progress.total}` : `Subiendo ${progress.done} de ${progress.total} imágenes...`}</p>
          <div style={styles.barBg}>
            <div style={{ ...styles.barFill, width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        </>
      ) : compact ? (
        <p style={{ margin: 0, color: '#4f46e5', fontSize: '0.8rem', fontWeight: 500 }}>+ Agregar página</p>
      ) : (
        <>
          <p style={styles.icon}>📷</p>
          <p style={styles.text}>Arrastra imágenes aquí o haz clic para seleccionar</p>
          <p style={styles.hint}>JPG, PNG, WEBP — máx. 10 MB por imagen — puedes seleccionar varias</p>
          <p style={styles.hint}>💡 La primera imagen subida será la <strong>portada</strong> del flipbook</p>
        </>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  zone: { border: '2px dashed #c7d2fe', borderRadius: 12, padding: '2rem', textAlign: 'center', marginBottom: '1rem', transition: 'background .15s' },
  zoneCompact: { padding: '0.5rem', borderRadius: 8, marginBottom: 0 },
  icon: { fontSize: '2rem', margin: '0 0 0.5rem' },
  text: { color: '#4f46e5', fontWeight: 500, margin: '0 0 0.25rem' },
  hint: { color: '#999', fontSize: '0.8rem', margin: 0 },
  barBg: { height: 6, background: '#e0e7ff', borderRadius: 4, marginTop: '0.75rem', overflow: 'hidden' },
  barFill: { height: '100%', background: '#4f46e5', borderRadius: 4, transition: 'width .2s' },
}
