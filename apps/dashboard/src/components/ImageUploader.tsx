import { useRef } from 'react'

interface Props {
  onUpload: (file: File) => void
  uploading: boolean
}

export default function ImageUploader({ onUpload, uploading }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) { onUpload(file); e.target.value = '' }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) onUpload(file)
  }

  return (
    <div
      style={styles.zone}
      onClick={() => !uploading && inputRef.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={handleChange} />
      {uploading ? (
        <p style={styles.text}>Subiendo imagen...</p>
      ) : (
        <>
          <p style={styles.icon}>📷</p>
          <p style={styles.text}>Arrastra una imagen aquí o haz clic para seleccionar</p>
          <p style={styles.hint}>JPG, PNG, WEBP — máx. 10 MB</p>
        </>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  zone: { border: '2px dashed #c7d2fe', borderRadius: 12, padding: '2rem', textAlign: 'center', cursor: 'pointer', marginBottom: '1rem', transition: 'background .15s' },
  icon: { fontSize: '2rem', margin: '0 0 0.5rem' },
  text: { color: '#4f46e5', fontWeight: 500, margin: '0 0 0.25rem' },
  hint: { color: '#999', fontSize: '0.8rem', margin: 0 },
}
