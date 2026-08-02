import { useEffect, useRef, type CSSProperties, type MouseEvent } from 'react'

type Props = {
  markerName: string
  cloning: boolean
  cloneDisabled?: boolean
  cloneDisabledReason?: string
  error?: string
  onUseSame: () => void
  onClone: () => void
  onCancel: () => void
}

export default function DynamicMarkerReuseDialog({
  markerName,
  cloning,
  cloneDisabled = false,
  cloneDisabledReason = '',
  error = '',
  onUseSame,
  onClone,
  onCancel,
}: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !cloning) onCancel()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [cloning, onCancel])

  function closeFromOverlay(event: MouseEvent<HTMLDivElement>) {
    if (!cloning && event.target === event.currentTarget) onCancel()
  }

  return (
    <div style={styles.overlay} onMouseDown={closeFromOverlay}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="dynamic-marker-reuse-title"
        style={styles.modal}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header style={styles.header}>
          <div style={styles.titleBlock}>
            <h2 id="dynamic-marker-reuse-title" style={styles.title}>Esta ficha ya está en uso</h2>
            <span style={styles.subtitle}>{markerName || 'Ficha sin nombre'}</span>
          </div>
          <button ref={closeRef} type="button" style={styles.closeBtn} disabled={cloning} onClick={onCancel}>
            Cerrar
          </button>
        </header>

        <div style={styles.body}>
          <p style={styles.copy}>
            Puedes usar la misma ficha y compartir sus datos, o crear una copia independiente para editarla por separado.
          </p>

          {error && <div style={styles.error}>{error}</div>}
          {cloning && <div style={styles.state}>Creando copia independiente...</div>}
          {cloneDisabled && !cloning && (
            <div style={styles.state}>{cloneDisabledReason || 'No pudimos preparar una copia para este elemento.'}</div>
          )}

          <div style={styles.actions}>
            <button type="button" style={{ ...styles.primaryBtn, ...(cloning ? styles.disabledBtn : {}) }} disabled={cloning} onClick={onUseSame}>
              <strong>Usar esta misma ficha</strong>
              <span>Los cambios futuros se reflejarán en todos los lugares donde se utilice.</span>
            </button>
            <button type="button" style={{ ...styles.secondaryBtn, ...(cloning || cloneDisabled ? styles.disabledBtn : {}) }} disabled={cloning || cloneDisabled} onClick={onClone}>
              <strong>Crear copia independiente</strong>
              <span>Se creará una nueva ficha con los mismos datos iniciales para editarla por separado.</span>
            </button>
            <button type="button" style={{ ...styles.cancelBtn, ...(cloning ? styles.disabledBtn : {}) }} disabled={cloning} onClick={onCancel}>Cancelar</button>
          </div>
        </div>
      </section>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 5450, background: 'rgba(17, 24, 39, 0.58)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 },
  modal: { width: 560, maxWidth: '100%', maxHeight: '88vh', background: '#fff', borderRadius: 8, boxShadow: '0 22px 70px rgba(15, 23, 42, 0.32)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '16px 18px', borderBottom: '1px solid #e5e7eb' },
  titleBlock: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  title: { margin: 0, color: '#111827', fontSize: 18, lineHeight: 1.25 },
  subtitle: { color: '#6b7280', fontSize: 13, lineHeight: 1.35, overflowWrap: 'anywhere' },
  closeBtn: { border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', color: '#374151', padding: '8px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' },
  body: { padding: 16, display: 'flex', flexDirection: 'column', gap: 12 },
  copy: { margin: 0, color: '#374151', fontSize: 13, lineHeight: 1.45 },
  error: { border: '1px solid #fecaca', borderRadius: 8, background: '#fef2f2', color: '#991b1b', padding: 10, fontSize: 13, lineHeight: 1.4 },
  state: { border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb', color: '#6b7280', padding: 10, fontSize: 12.5, lineHeight: 1.4 },
  actions: { display: 'flex', flexDirection: 'column', gap: 9 },
  primaryBtn: { width: '100%', border: '1px solid #4f46e5', borderRadius: 8, background: '#eef2ff', color: '#312e81', padding: 12, textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'inherit', fontSize: 13, lineHeight: 1.35 },
  secondaryBtn: { width: '100%', border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', color: '#111827', padding: 12, textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'inherit', fontSize: 13, lineHeight: 1.35 },
  cancelBtn: { alignSelf: 'flex-end', border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', color: '#374151', padding: '9px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' },
  disabledBtn: { cursor: 'not-allowed', opacity: 0.62, borderStyle: 'dashed' },
}
