import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api, API_BASE } from '../lib/api'
import { buildPublicationViewerUrl, canOpenPublicationPreview } from '../lib/previewUrl'

type Device = 'desktop' | 'tablet' | 'mobile'

const DEVICES: { key: Device; label: string; icon: string; width: number; height: number }[] = [
  { key: 'desktop', label: 'Escritorio', icon: '🖥️', width: 1280, height: 800 },
  { key: 'tablet',  label: 'Tablet',     icon: '📱', width: 768,  height: 1024 },
  { key: 'mobile',  label: 'Móvil',      icon: '📲', width: 390,  height: 844 },
]

// QR generado vía API pública de qrserver.com (Google Charts fue dado de baja)
function QRCode({ url }: { url: string }) {
  const encoded = encodeURIComponent(url)
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encoded}`
  return (
    <div style={styles.qrWrap}>
      <img src={src} alt="QR" style={{ width: 160, height: 160, borderRadius: 8 }} />
      <p style={styles.qrHint}>Escaneá para abrir en tu dispositivo</p>
    </div>
  )
}

export default function Preview() {
  const { id } = useParams<{ id: string }>()
  const [pub, setPub]         = useState<any>(null)
  const [device, setDevice]   = useState<Device>('desktop')
  const [showQR, setShowQR]   = useState(false)
  const [copied, setCopied]   = useState(false)
  const [toggling, setToggling] = useState(false)
  const [msg, setMsg]         = useState('')
  const [previewToken, setPreviewToken] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState('')

  const VIEWER_BASE = import.meta.env.VITE_VIEWER_BASE_URL ?? 'https://flip.intaprd.com'
  const VIEWER_PREVIEW_ENABLED = import.meta.env.VITE_VIEWER_PREVIEW === '1'
  const [tenantSlug, setTenantSlug] = useState<string | null>(null)

  useEffect(() => {
    if (id) api.publications.get(id).then((r) => setPub(r.data))
    api.auth.me().then((r) => setTenantSlug(r.data.slug ?? null)).catch(() => {})
  }, [id])

  useEffect(() => {
    let cancelled = false
    setPreviewToken(null)
    setPreviewError('')
    if (!VIEWER_PREVIEW_ENABLED || !id || !pub || !canOpenPublicationPreview(pub)) return
    api.publications.previewAccess(id)
      .then((r) => {
        if (!cancelled) setPreviewToken(r.data.token)
      })
      .catch((e) => {
        if (!cancelled) setPreviewError(e.message ?? 'No se pudo preparar la vista previa')
      })
    return () => { cancelled = true }
  }, [VIEWER_PREVIEW_ENABLED, id, pub?.id, pub?.public_slug, pub?.pages?.length])

  if (!pub) return <div style={{ textAlign: 'center', padding: '4rem', color: '#666' }}>Cargando...</div>

  const previewReady = VIEWER_PREVIEW_ENABLED ? !!previewToken : true
  const viewerUrl = buildPublicationViewerUrl({
    viewerBase: VIEWER_BASE,
    tenantSlug,
    publicationSlug: pub.public_slug,
    apiBase: API_BASE,
    previewToken,
    previewMode: VIEWER_PREVIEW_ENABLED,
  })
  const isPublished = pub.status === 'published'
  const dev = DEVICES.find((d) => d.key === device)!

  async function handleTogglePublish() {
    if (!id) return
    setToggling(true)
    try {
      if (isPublished) {
        await api.publications.update(id, { status: 'draft' })
        setPub({ ...pub, status: 'draft' })
        setMsg('Publicación despublicada.')
      } else {
        await api.publications.publish(id)
        const res = await api.publications.get(id)
        setPub(res.data)
        setMsg('¡Publicación publicada!')
      }
    } catch (e: any) {
      setMsg(e.message ?? 'Error al cambiar estado')
    } finally {
      setToggling(false)
      setTimeout(() => setMsg(''), 3000)
    }
  }

  function handleCopy() {
    if (!viewerUrl) return
    navigator.clipboard.writeText(viewerUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // El iframe se escala para entrar en el contenedor visible sin cambiar el ancho simulado
  const containerMaxW = dev.key === 'desktop' ? '100%' : dev.width + 32
  const iframeW = dev.width
  const iframeH = dev.height

  return (
    <div style={styles.page}>
      {/* Top bar */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <Link to={`/publications/${id}/editor`} style={styles.backLink}>← Editor</Link>
          <span style={styles.pubTitle}>{pub.title}</span>
          <span style={{ ...styles.badge, background: isPublished ? '#059669' : '#6b7280' }}>
            {isPublished ? 'Publicado' : 'Borrador'}
          </span>
        </div>

        <div style={styles.deviceToggle}>
          {DEVICES.map((d) => (
            <button
              key={d.key}
              title={d.label}
              onClick={() => setDevice(d.key)}
              style={{
                ...styles.devBtn,
                background: device === d.key ? '#4f46e5' : 'transparent',
                color: device === d.key ? '#fff' : '#6b7280',
              }}
            >
              {d.icon}
            </button>
          ))}
        </div>

        <div style={styles.headerRight}>
          {viewerUrl && previewReady && (
            <>
              <button style={styles.iconBtn} title="Código QR" onClick={() => setShowQR(!showQR)}>
                QR
              </button>
              <a href={viewerUrl} target="_blank" rel="noopener noreferrer" style={styles.iconBtn}>
                ↗
              </a>
              <button style={styles.iconBtn} onClick={handleCopy}>
                {copied ? '✓' : '⎘'}
              </button>
            </>
          )}
          {VIEWER_PREVIEW_ENABLED && !previewReady && canOpenPublicationPreview(pub) && (
            <button style={{ ...styles.iconBtn, opacity: 0.6, cursor: 'wait' }} disabled title="Preparando vista previa">
              ...
            </button>
          )}
          <button
            onClick={handleTogglePublish}
            disabled={toggling}
            style={{
              ...styles.publishBtn,
              background: isPublished ? '#dc2626' : '#4f46e5',
            }}
          >
            {toggling ? '...' : isPublished ? 'Despublicar' : 'Publicar'}
          </button>
        </div>
      </header>

      {msg && <div style={styles.toast}>{msg}</div>}
      {previewError && <div style={styles.toast}>{previewError}</div>}

      {/* URL bar */}
      {viewerUrl && previewReady && (
        <div style={styles.urlBar}>
          <span style={styles.urlText}>{viewerUrl}</span>
          <button style={styles.copySmall} onClick={handleCopy}>{copied ? '✓ Copiado' : 'Copiar link'}</button>
        </div>
      )}

      {/* QR panel */}
      {showQR && viewerUrl && previewReady && (
        <div style={styles.qrOverlay} onClick={() => setShowQR(false)}>
          <div style={styles.qrModal} onClick={(e) => e.stopPropagation()}>
            <QRCode url={viewerUrl} />
            <button style={styles.qrClose} onClick={() => setShowQR(false)}>Cerrar</button>
          </div>
        </div>
      )}

      {/* Preview area */}
      <main style={styles.main}>
        {!canOpenPublicationPreview(pub) ? (
          <div style={styles.noUrl}>
            <p style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Vista previa no disponible</p>
            <p style={{ color: '#999', fontSize: '0.875rem' }}>La publicación necesita slug y al menos una página.</p>
          </div>
        ) : !viewerUrl || !previewReady ? (
          <div style={styles.noUrl}>
            <p style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Preparando vista previa...</p>
          </div>
        ) : (
          <div style={{ maxWidth: containerMaxW, margin: '0 auto' }}>
            {/* Device frame */}
            <div style={{
              ...styles.frame,
              width: dev.key === 'desktop' ? '100%' : dev.width + 24,
              borderRadius: dev.key === 'mobile' ? 32 : dev.key === 'tablet' ? 20 : 12,
            }}>
              {/* Notch for mobile/tablet */}
              {dev.key !== 'desktop' && (
                <div style={styles.notch} />
              )}
              <div style={{ overflow: 'hidden', borderRadius: dev.key === 'mobile' ? 24 : 12 }}>
                <iframe
                  key={device}
                  src={viewerUrl}
                  title="Flipbook Preview"
                  allow="autoplay"
                  style={{
                    width: dev.key === 'desktop' ? '100%' : iframeW,
                    height: dev.key === 'desktop' ? '75vh' : iframeH,
                    border: 'none',
                    display: 'block',
                  }}
                />
              </div>
            </div>
            <p style={styles.deviceLabel}>{dev.icon} {dev.label} — {dev.key === 'desktop' ? 'ancho completo' : `${dev.width} × ${dev.height}px`}</p>
          </div>
        )}
      </main>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page:         { minHeight: '100vh', background: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif' },
  header:       { background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '0 1.5rem', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', position: 'sticky', top: 0, zIndex: 10 },
  headerLeft:   { display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0, flex: 1 },
  backLink:     { color: '#6b7280', textDecoration: 'none', fontSize: '0.875rem', whiteSpace: 'nowrap' },
  pubTitle:     { fontWeight: 600, color: '#111827', fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  badge:        { fontSize: '0.7rem', color: '#fff', borderRadius: 12, padding: '2px 8px', fontWeight: 600, whiteSpace: 'nowrap' },
  deviceToggle: { display: 'flex', gap: 4, background: '#f3f4f6', borderRadius: 8, padding: 4 },
  devBtn:       { border: 'none', borderRadius: 6, width: 36, height: 32, cursor: 'pointer', fontSize: '1rem', transition: 'all .15s' },
  headerRight:  { display: 'flex', alignItems: 'center', gap: '0.5rem', whiteSpace: 'nowrap' },
  iconBtn:      { background: '#f3f4f6', border: 'none', borderRadius: 6, width: 36, height: 36, cursor: 'pointer', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', color: '#374151' },
  publishBtn:   { color: '#fff', border: 'none', borderRadius: 8, padding: '0 1rem', height: 36, cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem', transition: 'opacity .15s' },
  toast:        { position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', background: '#1f2937', color: '#fff', padding: '0.6rem 1.25rem', borderRadius: 8, fontSize: '0.875rem', zIndex: 100 },
  urlBar:       { background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', padding: '0.5rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' },
  urlText:      { flex: 1, fontSize: '0.8rem', color: '#4f46e5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  copySmall:    { background: 'transparent', border: '1px solid #c7d2fe', color: '#4f46e5', borderRadius: 6, padding: '0.25rem 0.75rem', cursor: 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap' },
  main:         { padding: '2rem 1.5rem' },
  frame:        { background: '#1f2937', padding: 12, boxShadow: '0 20px 60px rgba(0,0,0,.25)', overflow: 'hidden' },
  notch:        { width: 80, height: 6, background: '#374151', borderRadius: 4, margin: '0 auto 8px' },
  deviceLabel:  { textAlign: 'center', color: '#9ca3af', fontSize: '0.8rem', marginTop: '1rem' },
  noUrl:        { textAlign: 'center', padding: '5rem', color: '#374151' },
  qrOverlay:    { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  qrModal:      { background: '#fff', borderRadius: 16, padding: '2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' },
  qrWrap:       { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' },
  qrHint:       { color: '#6b7280', fontSize: '0.8rem', margin: 0 },
  qrClose:      { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '0.5rem 1.5rem', cursor: 'pointer', fontWeight: 600 },
}
