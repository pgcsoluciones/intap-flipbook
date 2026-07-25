import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { ProductDetail } from '../lib/api'
import { formatProductDetailPrice } from '../lib/productDetailsFormat'

type Props = {
  detail: ProductDetail
  opener?: HTMLElement | null
  onClose: () => void
}

function normalizeAccent(value: unknown) {
  const color = typeof value === 'string' ? value.trim() : ''
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#5E6F59'
}

function productDetailCta(detail: ProductDetail) {
  const type = String(detail.cta_type || '').trim()
  const label = String(detail.cta_label || '').trim()
  const target = String(detail.cta_target || '').trim()
  if (!type || type === 'sin_accion' || type === 'none') return null
  if (!label || !target) return null
  if (type === 'enlace_externo' || type === 'external_url') {
    try {
      const url = new URL(target)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
      return { href: url.href, label, target: '_blank', rel: 'noopener noreferrer' }
    } catch {
      return null
    }
  }
  if (type === 'whatsapp') {
    const digits = target.replace(/[^\d]/g, '')
    if (digits.length < 8) return null
    return { href: `https://wa.me/${digits}`, label, target: '_blank', rel: 'noopener noreferrer' }
  }
  if (type === 'llamar' || type === 'phone') {
    const cleaned = target.replace(/[^\d+]/g, '')
    if ((cleaned.match(/\d/g) || []).length < 7) return null
    return { href: `tel:${cleaned}`, label, target: '_self', rel: '' }
  }
  if (type === 'correo' || type === 'email') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) return null
    return { href: `mailto:${target}`, label, target: '_self', rel: '' }
  }
  return null
}

export default function ProductDetailModal({ detail, opener, onClose }: Props) {
  const [open, setOpen] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const closingRef = useRef(false)
  const previousOverflowRef = useRef('')
  const previousScrollRef = useRef({ x: 0, y: 0 })
  const titleId = useMemo(() => `pd-editor-preview-${detail.id}-${Date.now()}`, [detail.id])
  const accent = normalizeAccent(detail.accent_color)
  const cta = productDetailCta(detail)
  const imageUrl = typeof detail.image_url === 'string' && /^https?:\/\//i.test(detail.image_url) ? detail.image_url : ''
  const displayPrice = formatProductDetailPrice(detail.price)

  function closeModal() {
    if (closingRef.current) return
    closingRef.current = true
    setOpen(false)
    window.setTimeout(onClose, 180)
  }

  useEffect(() => {
    previousOverflowRef.current = document.body.style.overflow
    previousScrollRef.current = { x: window.scrollX, y: window.scrollY }
    document.body.style.overflow = 'hidden'
    const t = window.setTimeout(() => {
      setOpen(true)
      closeRef.current?.focus({ preventScroll: true })
    }, 0)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeModal()
        return
      }
      if (event.key !== 'Tab') return
      const nodes = [...(cardRef.current?.querySelectorAll('button,a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])') ?? [])]
        .filter((node: any) => !node.disabled && node.offsetParent !== null) as HTMLElement[]
      if (!nodes.length) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previousOverflowRef.current
      window.scrollTo(previousScrollRef.current.x, previousScrollRef.current.y)
      try { opener?.focus?.({ preventScroll: true }) } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{ ...styles.overlay, opacity: open ? 1 : 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal() }}>
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ ...styles.card, '--pd-accent': accent, transform: open ? 'translateY(0) scale(1)' : 'translateY(10px) scale(.985)' } as CSSProperties}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button ref={closeRef} type="button" aria-label="Cerrar detalle" style={styles.close} onClick={closeModal}>×</button>
        <div style={styles.header}><span style={styles.headerMark} /></div>
        {imageUrl && (
          <div style={styles.media}>
            <img src={imageUrl} alt={detail.title || 'Detalle de producto'} loading="lazy" style={styles.image} onError={(event) => { (event.currentTarget.parentElement as HTMLElement | null)?.remove() }} />
          </div>
        )}
        <div style={styles.body}>
          <h2 id={titleId} style={styles.title}>{detail.title || 'Detalle de producto'}</h2>
          {displayPrice && <div style={{ ...styles.price, color: accent }}>{displayPrice}</div>}
          {detail.description && <p style={styles.description}>{detail.description}</p>}
          {cta && <a href={cta.href} target={cta.target} rel={cta.rel} style={{ ...styles.cta, background: accent }}>{cta.label}</a>}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 5000, background: 'rgba(7,10,18,.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, color: '#111827', transition: 'opacity .18s ease' },
  card: { width: 'min(520px, calc(100vw - 36px))', maxHeight: 'min(820px, calc(100dvh - 36px))', overflow: 'auto', overscrollBehavior: 'contain', background: '#fff', borderRadius: 24, boxShadow: '0 30px 90px rgba(15,23,42,.38)', position: 'relative', display: 'flex', flexDirection: 'column', transition: 'transform .18s ease' },
  close: { position: 'absolute', top: 13, right: 14, zIndex: 2, width: 36, height: 36, border: '1px solid rgba(255,255,255,.5)', borderRadius: 999, background: 'rgba(255,255,255,.92)', color: '#111827', fontSize: 22, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 20px rgba(15,23,42,.18)' },
  header: { height: 54, flex: '0 0 auto', background: 'var(--pd-accent, #5E6F59)', borderRadius: '24px 24px 0 0', position: 'relative' },
  headerMark: { position: 'absolute', top: 18, left: 24, width: 54, height: 12, borderRadius: 999, background: 'rgba(255,255,255,.36)' },
  media: { width: '100%', background: '#f3f4f6', maxHeight: 320, overflow: 'hidden' },
  image: { width: '100%', height: 'min(320px, 42vh)', display: 'block', objectFit: 'cover' },
  body: { padding: '30px 30px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center' },
  title: { margin: 0, color: '#111827', fontSize: 30, lineHeight: 1.1, fontWeight: 900, maxWidth: '100%' },
  price: { fontSize: 19, fontWeight: 900, border: '1px solid #e5e7eb', borderRadius: 999, padding: '10px 16px', background: '#fff', boxShadow: '0 8px 20px rgba(15,23,42,.06)' },
  description: { margin: 0, color: '#111827', fontSize: 17, lineHeight: 1.78, whiteSpace: 'pre-wrap', maxWidth: '42rem' },
  cta: { width: '100%', marginTop: 4, border: 0, borderRadius: 14, color: '#fff', padding: '13px 18px', fontSize: 15, fontWeight: 900, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 48, boxShadow: '0 14px 28px rgba(15,23,42,.16)' },
}
