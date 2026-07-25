import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { api, toCanvasSafeAssetUrl } from '../lib/api'
import {
  addTenantImageBankUrl,
  getLastImageBankFolder,
  loadTenantImageBankView,
  setLastImageBankFolder,
  type TenantImageBankView,
} from '../lib/imageBank'

type Props = {
  open: boolean
  title?: string
  description?: string
  selectedUrl?: string
  onSelect: (url: string) => void
  onClose: () => void
}

const EMPTY_VIEW: TenantImageBankView = { folders: [], general: [], byFolder: {}, all: [] }

export default function ImageBankModal({
  open,
  title = 'Banco de imágenes',
  description = 'Selecciona una imagen existente o sube una nueva desde tu equipo.',
  selectedUrl = '',
  onSelect,
  onClose,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [view, setView] = useState<TenantImageBankView>(EMPTY_VIEW)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const currentImages = selectedFolder ? view.byFolder[selectedFolder] ?? [] : view.general
  const folderName = selectedFolder
    ? view.folders.find((folder) => folder.id === selectedFolder)?.name ?? 'Carpeta'
    : 'Banco general'

  const selectedSafeUrl = useMemo(() => selectedUrl ? toCanvasSafeAssetUrl(selectedUrl) : '', [selectedUrl])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError('')
    loadTenantImageBankView(api)
      .then((nextView) => {
        if (cancelled) return
        setView(nextView)
        const lastFolder = getLastImageBankFolder()
        setSelectedFolder(lastFolder && nextView.folders.some((folder) => folder.id === lastFolder) ? lastFolder : null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo cargar el Banco de imágenes.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    window.setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 0)
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  if (!open) return null

  function addUrlToView(url: string) {
    const safe = toCanvasSafeAssetUrl(url)
    setView((current) => {
      if (selectedFolder) {
        const currentFolder = current.byFolder[selectedFolder] ?? []
        return {
          ...current,
          byFolder: {
            ...current.byFolder,
            [selectedFolder]: Array.from(new Set([safe, ...currentFolder])),
          },
          all: Array.from(new Set([safe, ...current.all])),
        }
      }
      return {
        ...current,
        general: Array.from(new Set([safe, ...current.general])),
        all: Array.from(new Set([safe, ...current.all])),
      }
    })
  }

  async function upload(file: File) {
    setUploading(true)
    setError('')
    try {
      const res = await api.upload(file)
      const url = toCanvasSafeAssetUrl(res.data.url)
      addUrlToView(url)
      await addTenantImageBankUrl(api, url, selectedFolder)
      onSelect(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir la imagen.')
    } finally {
      setUploading(false)
    }
  }

  function enterFolder(folderId: string) {
    setSelectedFolder(folderId)
    setLastImageBankFolder(folderId)
  }

  function backToGeneral() {
    setSelectedFolder(null)
    setLastImageBankFolder(null)
  }

  return (
    <div style={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div style={styles.modal} role="dialog" aria-modal="true" aria-labelledby="image-bank-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <h2 id="image-bank-modal-title" style={styles.title}>{title}</h2>
            <p style={styles.description}>{description}</p>
          </div>
          <button ref={closeRef} type="button" style={styles.closeBtn} aria-label="Cerrar Banco de imágenes" onClick={onClose}>×</button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/svg+xml,image/gif"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void upload(file)
          }}
        />

        <div style={styles.toolbar}>
          <button type="button" style={styles.primaryBtn} onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? 'Subiendo...' : 'Explorar equipo'}
          </button>
          <div style={styles.breadcrumb}>
            <button type="button" style={styles.breadcrumbBtn} onClick={backToGeneral}>Banco general</button>
            {selectedFolder && <><span>/</span><span>{folderName}</span></>}
          </div>
        </div>

        {loading ? (
          <div style={styles.state}>Cargando imágenes...</div>
        ) : error ? (
          <div style={{ ...styles.state, color: '#991b1b', background: '#fef2f2', borderColor: '#fecaca' }}>{error}</div>
        ) : (
          <div style={styles.body}>
            <aside style={styles.folders}>
              <button type="button" style={{ ...styles.folderBtn, ...(!selectedFolder ? styles.folderBtnActive : {}) }} onClick={backToGeneral}>
                Banco general
              </button>
              {view.folders.map((folder) => (
                <button key={folder.id} type="button" style={{ ...styles.folderBtn, ...(selectedFolder === folder.id ? styles.folderBtnActive : {}) }} onClick={() => enterFolder(folder.id)}>
                  <span style={styles.folderIcon}>📁</span>
                  <span style={styles.folderName}>{folder.name}</span>
                </button>
              ))}
            </aside>
            <section style={styles.gallery}>
              <div style={styles.galleryHeader}>
                <strong>{folderName}</strong>
                <span>{currentImages.length} imagen{currentImages.length === 1 ? '' : 'es'}</span>
              </div>
              {currentImages.length === 0 ? (
                <div style={styles.empty}>No hay imágenes en esta ubicación del Banco.</div>
              ) : (
                <div style={styles.grid}>
                  {currentImages.map((url) => {
                    const safe = toCanvasSafeAssetUrl(url)
                    const selected = safe === selectedSafeUrl
                    return (
                      <button
                        key={safe}
                        type="button"
                        title="Seleccionar imagen"
                        style={{ ...styles.item, ...(selected ? styles.itemSelected : {}) }}
                        onClick={() => onSelect(safe)}
                      >
                        <img src={safe} alt="" style={styles.thumb} loading="lazy" />
                      </button>
                    )
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 5000, background: 'rgba(15,23,42,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 },
  modal: { width: 'min(880px, calc(100vw - 36px))', maxHeight: 'min(760px, calc(100dvh - 36px))', background: '#fff', borderRadius: 14, boxShadow: '0 24px 70px rgba(15,23,42,.32)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', gap: 16, padding: '18px 20px', borderBottom: '1px solid #e5e7eb' },
  title: { margin: 0, fontSize: 18, lineHeight: 1.2, color: '#111827' },
  description: { margin: '5px 0 0', color: '#6b7280', fontSize: 13 },
  closeBtn: { width: 34, height: 34, border: '1px solid #e5e7eb', borderRadius: 999, background: '#fff', cursor: 'pointer', color: '#374151', fontSize: 22, lineHeight: 1, flex: '0 0 auto' },
  toolbar: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid #f3f4f6', flexWrap: 'wrap' },
  primaryBtn: { minHeight: 38, border: 'none', borderRadius: 8, padding: '8px 13px', background: '#4F46E5', color: '#fff', fontWeight: 800, cursor: 'pointer', font: 'inherit' },
  breadcrumb: { display: 'flex', alignItems: 'center', gap: 7, color: '#6b7280', fontSize: 13, fontWeight: 700 },
  breadcrumbBtn: { border: 'none', background: 'transparent', padding: 0, color: '#4F46E5', font: 'inherit', fontWeight: 800, cursor: 'pointer' },
  state: { margin: 20, border: '1px solid #e5e7eb', borderRadius: 10, padding: 18, color: '#6b7280', background: '#f9fafb', fontSize: 13 },
  body: { display: 'grid', gridTemplateColumns: '220px 1fr', minHeight: 360, minWidth: 0, overflow: 'hidden' },
  folders: { borderRight: '1px solid #e5e7eb', padding: 12, overflowY: 'auto', background: '#f9fafb', display: 'flex', flexDirection: 'column', gap: 6 },
  folderBtn: { width: '100%', border: '1px solid transparent', borderRadius: 8, padding: '8px 10px', background: 'transparent', color: '#374151', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 750, display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' },
  folderBtnActive: { background: '#eef2ff', borderColor: '#c7d2fe', color: '#4338ca' },
  folderIcon: { flex: '0 0 auto' },
  folderName: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  gallery: { minWidth: 0, padding: 14, overflowY: 'auto' },
  galleryHeader: { display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12, color: '#374151', fontSize: 13 },
  empty: { minHeight: 220, border: '1px dashed #d1d5db', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', background: '#fff', textAlign: 'center', padding: 18 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 10 },
  item: { padding: 0, border: '2px solid transparent', borderRadius: 10, overflow: 'hidden', cursor: 'pointer', background: '#f9fafb', aspectRatio: '1', boxShadow: '0 1px 2px rgba(15,23,42,.08)' },
  itemSelected: { borderColor: '#4F46E5', boxShadow: '0 0 0 2px #c7d2fe' },
  thumb: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
}
