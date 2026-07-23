// Fix bug Fabric.js 5.3.0: el textBaseline por defecto es 'alphabetical' (inválido según
// el estándar Canvas) y dispara un warning del navegador en cada render de cada texto.
// El valor correcto es 'alphabetic'. Lo corregimos en el prototype de fabric.Text.
if (window.fabric?.Text?.prototype) {
  window.fabric.Text.prototype.textBaseline = 'alphabetic'
}

const PUBLIC_API_BASE = 'https://intap-flipbook-api.fliaprince.workers.dev'

function cleanApiBase(value) {
  if (!value) return null
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    return url.toString().replace(/\/+$/, '')
  } catch (e) {
    return null
  }
}

function showViewerError(message) {
  const ls = document.getElementById('loading-screen')
  if (ls) ls.remove()
  document.body.dataset.viewerError = '1'
  document.body.innerHTML = `<p style="color:#fff;text-align:center;margin:2rem auto;max-width:560px;line-height:1.5;font-family:Inter,sans-serif">${message}</p>`
}

function rawErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || '')
}

function isTechnicalErrorMessage(message) {
  return /(price_min|price_max|cursor|marker|dynamic marker|payload|fetch|endpoint|invalid|undefined|null|json|status|api|\b40[04]\b|error técnico)/i.test(message)
}

function friendlyRequestError(error, fallback = 'No pudimos completar la acción. Inténtalo nuevamente.') {
  const message = rawErrorMessage(error)
  if (message && !isTechnicalErrorMessage(message)) return message
  return fallback
}

function notifyViewerReady() {
  try {
    window.parent?.postMessage('intap-viewer-ready', '*')
  } catch (e) {}
}

const params = new URLSearchParams(location.search)
const isPreview = params.get('preview') === '1'
const queryPublication = params.get('publication')?.trim()
const API_BASE = isPreview
  ? (cleanApiBase(params.get('api_base')) ?? cleanApiBase(window.__FLIPBOOK_CONFIG__?.apiBase) ?? PUBLIC_API_BASE)
  : (cleanApiBase(window.__FLIPBOOK_CONFIG__?.apiBase) ?? PUBLIC_API_BASE)
const previewToken = isPreview ? params.get('preview_token')?.trim() : ''
const slug = queryPublication || location.pathname.split('/').filter(Boolean).pop()
if (!slug) {
  showViewerError('No se especificó una publicación para mostrar.')
  throw new Error('No slug')
}
const viewerRuntime = window.IntapViewerRuntime || {
  selectPageImageUrl: (page) => page?.optimized_url || page?.display_url || page?.image_url || '',
  nearbyRealPageNumbers: (currentRealPage, totalPages) => [currentRealPage - 1, currentRealPage, currentRealPage + 1].filter((pageNumber) => pageNumber >= 1 && pageNumber <= totalPages),
  startupRealPageNumbers: (totalPages, portrait) => Array.from({ length: Math.min(totalPages, portrait ? 2 : 3) }, (_, index) => index + 1),
  targetRealPageNumbers: (targetRealPage, totalPages) => [targetRealPage, targetRealPage + 1].filter((pageNumber) => pageNumber >= 1 && pageNumber <= totalPages),
  createImagePreloader: () => ({ preload: () => Promise.resolve(null), has: () => false, size: () => 0 }),
}
const imagePreloader = viewerRuntime.createImagePreloader(Image)

let soundEnabled = true

// Genera el sonido de pasar página con Web Audio API (sin depender de URLs externas)
function playFlipSound() {
  if (!soundEnabled) return
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.12, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2)
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.35, ctx.currentTime)
    src.connect(gain)
    gain.connect(ctx.destination)
    src.start()
    src.onended = () => ctx.close()
  } catch (e) {}
}

// Aplica el encuadre manual de la hoja (cover_json) al <img> de fondo de una página.
// Formato: { zoom>=1, fx 0..1, fy 0..1 }. fx/fy mueven qué parte se ve (pan) vía
// object-position; zoom acerca con transform:scale anclado al punto focal. Esto
// reproduce el recorte "cubrir" del editor (computeCover en EditPublication.tsx).
function applyCoverStyle(el, coverJson, src, boxAspect) {
  let fr = null
  if (coverJson) { try { fr = typeof coverJson === 'string' ? JSON.parse(coverJson) : coverJson } catch (e) { fr = null } }
  const zoom = Math.max(1, (fr && Number(fr.zoom)) || 1)
  const fx = fr ? Math.min(1, Math.max(0, fr.fx == null ? 0.5 : Number(fr.fx))) : 0.5
  const fy = fr ? Math.min(1, Math.max(0, fr.fy == null ? 0.5 : Number(fr.fy))) : 0.5
  el.style.backgroundPosition = `${(fx * 100).toFixed(2)}% ${(fy * 100).toFixed(2)}%`
  // zoom = 1: "cover" estándar (se adapta a cualquier tamaño de hoja).
  if (zoom <= 1.0001) { el.style.backgroundSize = 'cover'; return }
  // zoom > 1: necesitamos el aspecto real de la imagen para calcular el tamaño exacto
  // del fondo (cover × zoom). Se mide al cargar y se aplica como porcentajes (estables
  // porque el aspecto de la hoja es constante). Réplica exacta de computeCover.
  const probe = new Image()
  probe.onload = () => {
    const imgA = probe.naturalWidth / probe.naturalHeight
    let sx, sy
    if (imgA > boxAspect) { sy = 100 * zoom; sx = (imgA / boxAspect) * 100 * zoom }
    else { sx = 100 * zoom; sy = (boxAspect / imgA) * 100 * zoom }
    el.style.backgroundSize = `${sx.toFixed(2)}% ${sy.toFixed(2)}%`
  }
  probe.src = src
}

function makeBlank(w, h) {
  const d = document.createElement('div')
  d.className = 'page'
  d.style.cssText = `width:${w}px;height:${h}px;background:#1a1a2e;`
  return d
}

// Envía una respuesta (formulario o cuestionario) al repositorio del tenant.
function saveResponse(kind, payload, widgetKey) {
  if (isPreview) return
  try {
    fetch(`${API_BASE}/view/${slug}/response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, widget_key: widgetKey || null, payload }),
    }).catch(() => {})
  } catch (e) {}
}

async function init() {
  let res
  try {
    const endpoint = isPreview && previewToken
      ? `${API_BASE}/view/preview/${encodeURIComponent(previewToken)}`
      : `${API_BASE}/view/${slug}`
    res = await fetch(endpoint)
  } catch (e) {
    showViewerError('No pudimos conectar con el visor. Revisa tu conexión e inténtalo nuevamente.')
    throw e
  }
  if (!res.ok) {
    showViewerError(res.status === 404
      ? 'Esta publicación no está disponible.'
      : 'No pudimos cargar la publicación. Inténtalo nuevamente.')
    return
  }

  const { data } = await res.json()
  document.title = data.title
  const dynamicMarkerMap = new Map()
  ;(Array.isArray(data.dynamic_markers) ? data.dynamic_markers : []).forEach((marker) => {
    if (!marker?.page_id || !marker?.target_object_id) return
    const key = `${marker.page_id}::${marker.target_object_id}`
    if (!dynamicMarkerMap.has(key)) dynamicMarkerMap.set(key, marker)
  })

  function getDynamicMarker(pageId, elementId) {
    if (!pageId || !elementId) return null
    return dynamicMarkerMap.get(`${pageId}::${elementId}`) || null
  }

  function formatMarkerMoney(value, currency) {
    if (value == null || value === '') return ''
    const amount = Number(value)
    if (!Number.isFinite(amount)) return ''
    const code = typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : null
    if (code) {
      try {
        return new Intl.NumberFormat('es-DO', { style: 'currency', currency: code }).format(amount / 100)
      } catch (e) {}
    }
    return (amount / 100).toFixed(2)
  }

  function formatOfferPromotionText(marker) {
    const raw = typeof marker.promotion_text === 'string' ? marker.promotion_text.trim() : ''
    const postPrice = formatMarkerMoney(marker.post_promotion_price_minor, marker.currency)
    if (!raw) return postPrice ? `Luego costará ${postPrice}` : ''
    const hasCurrency = /(?:[A-Z]{2,3}\$|RD\$|\$|€|£|¥|\b(?:DOP|USD|EUR|CAD|MXN|COP)\b)/.test(raw)
    if (!postPrice || hasCurrency) return raw
    if (/\d+(?:[.,]\d+)?\s*$/.test(raw)) {
      return raw.replace(/\d+(?:[.,]\d+)?\s*$/, postPrice)
    }
    return `${raw}: ${postPrice}`
  }

  function savingsPercent(previousMinor, currentMinor) {
    const previous = Number(previousMinor)
    const current = Number(currentMinor)
    if (!Number.isFinite(previous) || !Number.isFinite(current) || previous <= 0 || current <= 0 || current >= previous) return 0
    return Math.round(((previous - current) / previous) * 100)
  }

  function appendMarkerRow(parent, label, value) {
    if (value == null || value === '') return
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;font-size:13px;line-height:1.45;'
    const key = document.createElement('span')
    key.textContent = label
    key.style.cssText = 'min-width:92px;color:#6b7280;font-weight:700;'
    const val = document.createElement('span')
    val.textContent = String(value)
    val.style.cssText = 'flex:1;color:#111827;'
    row.appendChild(key)
    row.appendChild(val)
    parent.appendChild(row)
  }

  function markerCustomFieldValue(value) {
    if (value == null || value === '') return ''
    if (typeof value === 'boolean') return value ? 'Sí' : 'No'
    if (typeof value === 'string' || typeof value === 'number') return String(value)
    if (Array.isArray(value)) {
      const parts = value
        .filter((item) => item != null && item !== '' && (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'))
        .map((item) => (typeof item === 'boolean' ? (item ? 'Sí' : 'No') : String(item)))
      return parts.join(', ')
    }
    return ''
  }

  function isNonEmpty(value) {
    if (value == null || value === '') return false
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === 'object') return Object.keys(value).length > 0
    return true
  }

  function safeUrl(value) {
    if (!value || typeof value !== 'string') return ''
    try {
      const url = new URL(value)
      return ['http:', 'https:'].includes(url.protocol) ? url.toString() : ''
    } catch (e) {
      return ''
    }
  }

  function normalizeMarkerAccent(value) {
    return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim().toUpperCase() : '#F59E0B'
  }

  function normalizeMarkerColors(value) {
    return (Array.isArray(value) ? value : []).map((item) => {
      if (typeof item === 'string') {
        const hex = item.trim()
        return /^#[0-9a-fA-F]{6}$/.test(hex) ? { name: hex, hex: hex.toUpperCase() } : null
      }
      if (!item || typeof item !== 'object') return null
      const rawHex = typeof item.hex === 'string' ? item.hex : typeof item.value === 'string' ? item.value : ''
      const hex = rawHex.trim()
      if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null
      return {
        name: String(item.name || item.label || hex).trim(),
        hex: hex.toUpperCase(),
      }
    }).filter(Boolean)
  }

  function markerOfferState(marker) {
    const end = marker.promotion_ends_at ? new Date(marker.promotion_ends_at) : null
    const endTime = end && !Number.isNaN(end.getTime()) ? end.getTime() : 0
    const hasOffer = Boolean(endTime && marker.post_promotion_price_minor != null)
    const active = hasOffer && Date.now() < endTime
    return {
      active,
      endTime,
      displayPriceMinor: active ? marker.price_minor : marker.post_promotion_price_minor ?? marker.price_minor,
      showPromotionText: active && isNonEmpty(formatOfferPromotionText(marker)),
    }
  }

  async function copyTextToClipboard(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        return true
      }
    } catch (e) {}
    const input = document.createElement('textarea')
    input.value = text
    input.setAttribute('readonly', '')
    input.style.cssText = 'position:fixed;left:-9999px;top:-9999px'
    document.body.appendChild(input)
    input.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch (e) {}
    input.remove()
    return ok
  }

  function ensureDynamicMarkerStyles() {
    if (document.getElementById('dynamic-marker-premium-styles')) return
    const style = document.createElement('style')
    style.id = 'dynamic-marker-premium-styles'
    style.textContent = `
      .dm-premium-overlay{position:fixed;inset:0;z-index:2200;background:rgba(4,7,17,.72);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px;font-family:Inter,system-ui,sans-serif;color:#f8fafc;--dm-accent:#F59E0B}
      .dm-premium-card{width:min(1120px,calc(100vw - 32px));height:min(820px,calc(100vh - 32px));max-height:calc(100vh - 32px);overflow:hidden;border:1px solid rgba(255,255,255,.14);border-radius:22px;background:linear-gradient(145deg,#111827,#0b1020 58%,#141827);box-shadow:0 30px 90px rgba(0,0,0,.55);position:relative;display:grid;grid-template-columns:minmax(0,1.06fr) minmax(360px,.94fr)}
      .dm-premium-close{position:absolute;top:14px;right:14px;z-index:4;width:36px;height:36px;border:1px solid rgba(255,255,255,.18);border-radius:999px;background:rgba(15,23,42,.84);color:#fff;font-size:20px;line-height:1;cursor:pointer}
      .dm-premium-media{min-height:0;height:100%;background:#050816;border-right:1px solid rgba(255,255,255,.1);display:flex;flex-direction:column}
      .dm-premium-stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;position:relative;padding:18px}
      .dm-premium-stage img,.dm-premium-stage video{max-width:100%;max-height:100%;object-fit:contain;border-radius:16px;box-shadow:0 18px 44px rgba(0,0,0,.36)}
      .dm-premium-media-badge{position:absolute;top:18px;left:18px;z-index:3;border:1px solid color-mix(in srgb,var(--dm-accent) 50%,transparent);background:color-mix(in srgb,var(--dm-accent) 20%,#050816);color:#fff;border-radius:999px;padding:7px 11px;font-size:12px;font-weight:900;text-transform:uppercase;box-shadow:0 10px 28px rgba(0,0,0,.32)}
      .dm-premium-audio{width:min(420px,90%);padding:24px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(255,255,255,.06)}
      .dm-premium-nav{position:absolute;top:50%;transform:translateY(-50%);width:38px;height:38px;border:1px solid rgba(255,255,255,.18);border-radius:999px;background:rgba(15,23,42,.75);color:#fff;font-size:22px;cursor:pointer}
      .dm-premium-prev{left:16px}.dm-premium-next{right:16px}
      .dm-premium-thumbs{display:flex;gap:10px;overflow-x:auto;padding:0 18px 18px}
      .dm-premium-thumb{width:72px;height:56px;flex:0 0 auto;border:1px solid rgba(255,255,255,.16);border-radius:12px;background:#111827;color:#cbd5e1;cursor:pointer;display:flex;align-items:center;justify-content:center;overflow:hidden;font-size:11px;position:relative}
      .dm-premium-thumb[data-active="true"]{border-color:var(--dm-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--dm-accent) 28%,transparent)}
      .dm-premium-thumb img{width:100%;height:100%;object-fit:cover}.dm-premium-thumb-media-icon{position:absolute;inset:auto 6px 6px auto;width:22px;height:22px;border-radius:999px;background:rgba(15,23,42,.82);color:#fff;display:flex;align-items:center;justify-content:center}.dm-premium-thumb-media-icon svg{width:13px;height:13px}.dm-premium-thumb-card{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;background:linear-gradient(145deg,rgba(255,255,255,.08),rgba(15,23,42,.9));color:#f8fafc}.dm-premium-thumb-card svg{width:18px;height:18px}.dm-premium-thumb-card span{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.04em}
      .dm-premium-content{min-height:0;overflow:auto;padding:30px 30px 28px;display:flex;flex-direction:column;gap:16px}
      .dm-premium-badges{display:flex;gap:8px;flex-wrap:wrap}.dm-premium-badge{border:1px solid color-mix(in srgb,var(--dm-accent) 45%,transparent);background:color-mix(in srgb,var(--dm-accent) 16%,transparent);color:var(--dm-accent);border-radius:999px;padding:5px 10px;font-size:11px;font-weight:800;text-transform:uppercase}
      .dm-premium-title{font-size:30px;line-height:1.08;margin:0;color:#fff}.dm-premium-desc{margin:0;color:#cbd5e1;font-size:14px;line-height:1.58}
      .dm-premium-price{display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap}.dm-premium-current{font-size:28px;font-weight:900;color:var(--dm-accent)}.dm-premium-regular{display:flex;flex-direction:column;gap:3px;margin-top:2px}.dm-premium-regular-line{color:#cbd5e1;font-size:13px;font-weight:800}.dm-premium-regular-line strong{color:#e5e7eb;font-weight:900}.dm-premium-previous{color:#94a3b8;text-decoration:line-through}.dm-premium-savings{color:var(--dm-accent);font-size:12px;font-weight:950}.dm-premium-promo{display:block;margin:10px 0 0;padding:9px 11px;border:1px solid color-mix(in srgb,var(--dm-accent) 42%,rgba(255,255,255,.12));border-radius:12px;background:linear-gradient(180deg,color-mix(in srgb,var(--dm-accent) 18%,rgba(15,23,42,.88)),rgba(15,23,42,.72));color:#fff7ed;font-size:clamp(14px,1.25vw,16px);font-weight:950;line-height:1.35;text-align:center;box-shadow:0 10px 24px rgba(0,0,0,.18) inset}
      .dm-premium-price-countdown{border:1px solid rgba(248,113,113,.72);border-radius:15px;background:radial-gradient(circle at top,rgba(248,113,113,.14),transparent 46%),linear-gradient(180deg,#160506,#070b15 72%);color:#f8fafc;padding:10px 12px;text-align:center;box-shadow:0 12px 30px rgba(127,29,29,.28),0 0 0 1px rgba(255,255,255,.05) inset}.dm-premium-countdown-kicker{display:block;color:#fff;font-size:10px;font-weight:950;text-transform:uppercase;letter-spacing:.16em;margin-bottom:6px;text-shadow:0 0 4px rgba(255,255,255,.25)}.dm-premium-countdown-value{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;align-items:end;gap:6px;color:#ff2626;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:clamp(28px,3.1vw,40px);font-weight:950;line-height:1;text-shadow:0 0 5px rgba(239,68,68,.55)}.dm-premium-countdown-value b{color:#ff3636;font-size:.82em;line-height:1}.dm-premium-countdown-labels{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;gap:6px;margin-top:5px;color:#e5e7eb;font-size:9px;font-weight:900;letter-spacing:.1em;text-transform:uppercase}.dm-premium-countdown-labels b{color:#64748b}
      .dm-premium-meta{display:flex;flex-wrap:wrap;gap:0 8px;color:#94a3b8;font-size:13px;line-height:1.5}.dm-premium-meta strong{color:var(--dm-accent);font-weight:900}.dm-premium-meta-item{white-space:normal}.dm-premium-meta-sep{color:#475569}
      .dm-premium-color-module{display:flex;flex-direction:column;gap:9px;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:rgba(255,255,255,.045);padding:12px}.dm-premium-module-title{font-size:12px;font-weight:900;color:#e5e7eb;text-transform:uppercase}
      .dm-premium-swatches{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.dm-premium-swatch-wrap{display:inline-flex;align-items:center;gap:6px;color:#cbd5e1;font-size:12px}.dm-premium-swatch{width:24px;height:24px;border-radius:999px;border:2px solid rgba(255,255,255,.75);box-shadow:0 0 0 1px rgba(0,0,0,.35)}
      .dm-premium-accordions{display:flex;flex-direction:column;gap:8px}.dm-premium-accordion{border:1px solid rgba(255,255,255,.12);border-radius:14px;background:rgba(255,255,255,.045);overflow:hidden}.dm-premium-accordion summary{cursor:pointer;padding:13px 14px;font-weight:800;color:#f8fafc}.dm-premium-accordion-body{padding:0 14px 14px;color:#d1d5db;font-size:13px;line-height:1.55}.dm-premium-list{display:flex;flex-direction:column;gap:8px}.dm-premium-row{display:flex;gap:10px;justify-content:space-between;border-top:1px solid rgba(255,255,255,.08);padding-top:8px}.dm-premium-row:first-child{border-top:0;padding-top:0}.dm-premium-row span{color:#94a3b8}.dm-premium-row strong{color:#f8fafc;text-align:right}
      .dm-premium-offer-cta{display:flex;margin-top:10px}.dm-premium-offer-cta .dm-premium-action{width:100%;box-shadow:0 10px 24px rgba(0,0,0,.24);font-size:clamp(16px,1.5vw,19px);font-weight:950;min-height:52px;gap:10px;color:#fff}.dm-premium-offer-cta .dm-premium-action svg{width:20px;height:20px;color:#fff;fill:#fff;flex:0 0 auto;transform:translateY(1px)}
      .dm-premium-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:4px;padding-top:12px;border-top:1px solid rgba(255,255,255,.1)}.dm-premium-action{border:0;border-radius:12px;padding:12px 14px;font-size:13px;font-weight:900;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px}.dm-action-whatsapp{background:#22c55e;color:#052e16}.dm-action-link{background:#7c3aed;color:#fff}.dm-action-muted{background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.14)}.dm-premium-action:focus-visible,.dm-premium-share-grid button:focus-visible{outline:3px solid var(--dm-accent);outline-offset:2px}.dm-premium-disabled{opacity:.9}

      .dm-action-booking{background:#2563eb;color:#fff}
      .dm-booking-overlay{position:fixed;inset:0;z-index:2400;background:rgba(2,6,23,.72);display:flex;align-items:center;justify-content:center;padding:16px}.dm-booking-card{width:min(460px,calc(100vw - 24px));max-height:calc(100dvh - 32px);overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;border:1px solid rgba(255,255,255,.16);border-radius:18px;background:linear-gradient(145deg,#111827,#080d19);color:#f8fafc;box-shadow:0 24px 70px rgba(0,0,0,.48);padding:20px 20px 24px;display:flex;flex-direction:column;gap:12px}.dm-booking-card h3{margin:0;font-size:22px}.dm-booking-context{border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(255,255,255,.055);padding:10px;color:#cbd5e1;font-size:13px;display:flex;flex-direction:column;gap:4px}.dm-booking-field{display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:850;color:#d1d5db}.dm-booking-field input,.dm-booking-field textarea{border:1px solid rgba(255,255,255,.16);border-radius:10px;background:rgba(15,23,42,.9);color:#fff;padding:10px;font:inherit;font-size:14px}.dm-booking-field textarea{min-height:82px;resize:vertical}.dm-booking-error{margin:0;color:#fca5a5;font-size:12px}.dm-booking-success{margin:0;color:#bbf7d0;font-size:13px;line-height:1.45}.dm-booking-actions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}.dm-booking-actions button{border:0;border-radius:10px;padding:10px 14px;font-weight:900;cursor:pointer}.dm-booking-cancel{background:rgba(255,255,255,.1);color:#fff}.dm-booking-submit{background:var(--dm-accent);color:#08111f}.dm-booking-review{display:flex;flex-direction:column;gap:10px}.dm-booking-review-item{border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(255,255,255,.05);padding:10px;color:#d1d5db;font-size:13px;line-height:1.45}.dm-booking-note{margin:0;color:#fde68a;font-size:12px;line-height:1.45}.dm-booking-availability-note{margin:0;color:#93c5fd;font-size:12px;line-height:1.4}.dm-booking-instructions{display:none;border:1px solid rgba(148,163,184,.34);border-radius:12px;background:rgba(148,163,184,.10);padding:10px 11px;color:#f8fafc;font-size:12px;line-height:1.5}.dm-booking-instructions strong{display:block;color:#cbd5e1;font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px}.dm-booking-instructions-line{display:block;color:#cbd5e1}.dm-booking-instructions-line b{color:#f8fafc}.dm-booking-empty{margin:0;color:#cbd5e1;font-size:12px;line-height:1.4;text-align:center}.dm-booking-picker-field{position:relative;display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:850;color:#d1d5db}.dm-booking-picker-trigger{width:100%;border:1px solid rgba(255,255,255,.16);border-radius:10px;background:rgba(15,23,42,.9);color:#fff;padding:10px 12px;font:inherit;font-size:14px;min-height:42px;display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;text-align:left}.dm-booking-picker-trigger[data-open="true"]{border-color:var(--dm-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--dm-accent) 24%,transparent)}.dm-booking-picker-trigger svg{color:#fff;flex:0 0 auto}.dm-booking-picker-panel{border:1px solid rgba(255,255,255,.14);border-radius:14px;background:#0b1220;box-shadow:0 18px 44px rgba(0,0,0,.42);padding:12px;display:flex;flex-direction:column;gap:10px}.dm-booking-calendar-head{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#fff;font-weight:950}.dm-booking-calendar-head button,.dm-booking-time-option{border:1px solid rgba(255,255,255,.14);border-radius:10px;background:rgba(255,255,255,.08);color:#fff;cursor:pointer;font-weight:900}.dm-booking-calendar-head button{width:34px;height:32px}.dm-booking-calendar-head button:disabled,.dm-booking-day:disabled{opacity:.35;cursor:not-allowed}.dm-booking-week,.dm-booking-days{display:grid;grid-template-columns:repeat(7,1fr);gap:5px}.dm-booking-week span{font-size:10px;color:#94a3b8;text-align:center;font-weight:900}.dm-booking-day{border:1px solid transparent;border-radius:10px;background:rgba(255,255,255,.06);color:#fff;min-height:34px;font-weight:850;cursor:pointer}.dm-booking-day[data-selected="true"]{background:var(--dm-accent);color:#08111f}.dm-booking-time-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(86px,1fr));gap:7px}.dm-booking-time-option{padding:9px 8px}.dm-booking-time-option[data-selected="true"]{background:var(--dm-accent);color:#08111f}
      .dm-premium-share{grid-column:1/-1;border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:10px;background:rgba(255,255,255,.045)}.dm-premium-share-title{font-size:12px;font-weight:900;color:#e5e7eb;margin-bottom:8px}.dm-premium-share-grid{display:flex;flex-wrap:wrap;gap:8px}.dm-premium-share-grid button{width:42px;height:42px;border:1px solid rgba(255,255,255,.14);border-radius:999px;background:rgba(255,255,255,.08);color:#fff;padding:0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}.dm-premium-share-grid button[data-network="whatsapp"]{color:#22c55e}.dm-premium-share-grid button[data-network="facebook"]{color:#1877f2}.dm-premium-share-grid button[data-network="instagram"]{color:#e1306c}.dm-premium-share-grid button:hover{border-color:var(--dm-accent);color:var(--dm-accent)}
      .dm-premium-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2300;background:#111827;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:9px 14px;font-size:13px;box-shadow:0 16px 50px rgba(0,0,0,.38)}
      @media (max-width: 820px){.dm-premium-overlay{align-items:flex-end;padding:0}.dm-premium-card{width:100vw;height:94vh;max-height:94vh;border-radius:22px 22px 0 0;grid-template-columns:1fr;overflow:auto}.dm-premium-media{height:auto;min-height:320px;border-right:0;border-bottom:1px solid rgba(255,255,255,.1)}.dm-premium-content{overflow:visible;padding:24px 18px calc(24px + env(safe-area-inset-bottom))}.dm-premium-title{font-size:24px}.dm-premium-countdown-value{font-size:34px}.dm-premium-actions{grid-template-columns:1fr}.dm-premium-share-grid{grid-template-columns:1fr 1fr}.dm-premium-close{top:10px;right:10px}}
    `
    document.head.appendChild(style)
  }

  function showMarkerToast(message) {
    const old = document.querySelector('.dm-premium-toast')
    if (old) old.remove()
    const toast = document.createElement('div')
    toast.className = 'dm-premium-toast'
    toast.textContent = message
    document.body.appendChild(toast)
    setTimeout(() => toast.remove(), 1800)
  }

  function appendRow(parent, label, value) {
    if (!isNonEmpty(value)) return
    const row = document.createElement('div')
    row.className = 'dm-premium-row'
    const key = document.createElement('span')
    key.textContent = label
    const val = document.createElement('strong')
    val.textContent = String(value)
    row.appendChild(key)
    row.appendChild(val)
    parent.appendChild(row)
  }

  function hasMeaningfulContent(node) {
    if (!node) return false
    if (node.textContent?.trim()) return true
    return [...node.children].some((child) => hasMeaningfulContent(child))
  }

  function addAccordion(parent, title, fill) {
    const details = document.createElement('details')
    details.className = 'dm-premium-accordion'
    const summary = document.createElement('summary')
    summary.textContent = title
    const body = document.createElement('div')
    body.className = 'dm-premium-accordion-body'
    fill(body)
    if (!hasMeaningfulContent(body)) return
    details.appendChild(summary)
    details.appendChild(body)
    parent.appendChild(details)
  }

  function showDynamicMarkerModal(marker) {
    ensureDynamicMarkerStyles()
    document.querySelectorAll('.dm-premium-overlay').forEach((node) => node.remove())
    const accentColor = normalizeMarkerAccent(marker.accent_color)

    const media = (Array.isArray(marker.media) ? marker.media : [])
      .map((item) => ({
        type: item?.type,
        url: safeUrl(item?.url),
        thumbnail_url: safeUrl(item?.thumbnail_url),
        title: item?.title || item?.alt || '',
        alt: item?.alt || item?.title || marker.name || '',
      }))
      .filter((item) => ['image', 'video', 'audio'].includes(item.type) && item.url)
    let selectedMedia = 0
    let galleryTimer = null
    let resumeGalleryTimer = null
    let mediaCleanups = []
    let countdownTimer = null
    let priceCountdownNode = null
    let actionBar = null
    let actionDefinitions = []
    let offerTarget = ''
    const colors = normalizeMarkerColors(marker.colors)
    const hasTimedOffer = Boolean(marker.promotion_ends_at && marker.post_promotion_price_minor != null)
    let offer = markerOfferState(marker)
    let currentPrice = formatMarkerMoney(offer.displayPriceMinor, marker.currency)
    let currentPriceNode = null
    let regularPriceNode = null
    let savingsNode = null
    let promoNode = null
    let offerCtaSlot = null

    const back = document.createElement('div')
    back.className = 'dm-premium-overlay'
    back.style.setProperty('--dm-accent', accentColor)
    const box = document.createElement('div')
    box.className = 'dm-premium-card'
    const close = document.createElement('button')
    close.type = 'button'
    close.textContent = '×'
    close.setAttribute('aria-label', 'Cerrar ficha')
    close.className = 'dm-premium-close'

    let mediaStage
    let thumbRow
    function cleanupRenderedMedia() {
      mediaCleanups.forEach((cleanup) => cleanup())
      mediaCleanups = []
    }
    function stopGalleryTimer() {
      if (galleryTimer) {
        clearInterval(galleryTimer)
        galleryTimer = null
      }
    }
    function clearResumeGalleryTimer() {
      if (resumeGalleryTimer) {
        clearTimeout(resumeGalleryTimer)
        resumeGalleryTimer = null
      }
    }
    function stopAllGalleryTimers() {
      stopGalleryTimer()
      clearResumeGalleryTimer()
    }
    function startGalleryTimer() {
      stopAllGalleryTimers()
      if (media.length < 2) return
      galleryTimer = setInterval(() => {
        selectedMedia = (selectedMedia + 1) % media.length
        renderMedia()
      }, 5000)
    }
    function nextMediaIndexAfter(index) {
      if (!media.length) return -1
      return (index + 1) % media.length
    }
    function resumeGalleryLater() {
      stopAllGalleryTimers()
      if (media.length < 2) return
      resumeGalleryTimer = setTimeout(() => {
        selectedMedia = nextMediaIndexAfter(selectedMedia)
        renderMedia()
        startGalleryTimer()
      }, 5000)
    }
    function chooseMedia(index, source = 'manual') {
      selectedMedia = index
      renderMedia()
      if (source === 'auto') startGalleryTimer()
      else if (media[selectedMedia]?.type === 'image') startGalleryTimer()
      else stopAllGalleryTimers()
    }
    function updateCountdown() {
      if (!priceCountdownNode || !offer.active) return
      const remaining = Math.max(0, offer.endTime - Date.now())
      if (!remaining) {
        if (priceCountdownNode) priceCountdownNode.remove()
        priceCountdownNode = null
        if (offerCtaSlot) {
          offerCtaSlot.remove()
          offerCtaSlot = null
        }
        if (countdownTimer) {
          clearInterval(countdownTimer)
          countdownTimer = null
        }
        offer = markerOfferState(marker)
        currentPrice = formatMarkerMoney(offer.displayPriceMinor, marker.currency)
        if (currentPriceNode) currentPriceNode.textContent = currentPrice
        const percent = savingsPercent(marker.previous_price_minor, offer.displayPriceMinor)
        if (regularPriceNode) regularPriceNode.hidden = percent <= 0
        if (savingsNode) savingsNode.textContent = percent > 0 ? `Ahorras ${percent}%` : ''
        if (promoNode) {
          promoNode.remove()
          promoNode = null
        }
        if (offerTarget && actionBar && !actionBar.querySelector(`[data-action-key="${offerTarget}"]`)) {
          const selected = actionDefinitions.find(([key]) => key === offerTarget)
          if (selected) actionBar.prepend(makeAction(selected[1], selected[2], selected[3], selected[4], selected[0]))
        }
        renderMedia()
        return
      }
      const totalSeconds = Math.floor(remaining / 1000)
      const days = Math.floor(totalSeconds / 86400)
      const hours = Math.floor((totalSeconds % 86400) / 3600)
      const minutes = Math.floor((totalSeconds % 3600) / 60)
      const value = priceCountdownNode.querySelector('.dm-premium-countdown-value')
      if (value) {
        value.innerHTML = `<span>${String(days).padStart(2, '0')}</span><b>:</b><span>${String(hours).padStart(2, '0')}</span><b>:</b><span>${String(minutes).padStart(2, '0')}</span>`
      }
    }
    function renderMedia() {
      if (!mediaStage) return
      cleanupRenderedMedia()
      mediaStage.innerHTML = ''
      const item = media[selectedMedia]
      if (!item) return
      const showOverlayInfo = item.type === 'image' || item.type === 'video'
      if (item.type === 'image') {
        const img = document.createElement('img')
        img.src = item.url
        img.alt = item.alt
        mediaStage.appendChild(img)
      } else if (item.type === 'video') {
        const video = document.createElement('video')
        video.src = item.url
        video.controls = true
        video.preload = 'metadata'
        video.poster = item.thumbnail_url || ''
        const onPlay = () => stopAllGalleryTimers()
        const onPause = () => resumeGalleryLater()
        const onEnded = () => resumeGalleryLater()
        video.addEventListener('play', onPlay)
        video.addEventListener('pause', onPause)
        video.addEventListener('ended', onEnded)
        mediaCleanups.push(() => {
          video.removeEventListener('play', onPlay)
          video.removeEventListener('pause', onPause)
          video.removeEventListener('ended', onEnded)
        })
        mediaStage.appendChild(video)
      } else if (item.type === 'audio') {
        const audioBox = document.createElement('div')
        audioBox.className = 'dm-premium-audio'
        if (item.title) {
          const title = document.createElement('strong')
          title.textContent = item.title
          title.style.cssText = 'display:block;margin-bottom:12px;color:#fff;'
          audioBox.appendChild(title)
        }
        const audio = document.createElement('audio')
        audio.src = item.url
        audio.controls = true
        audio.style.width = '100%'
        const onPlay = () => stopAllGalleryTimers()
        const onPause = () => resumeGalleryLater()
        const onEnded = () => resumeGalleryLater()
        audio.addEventListener('play', onPlay)
        audio.addEventListener('pause', onPause)
        audio.addEventListener('ended', onEnded)
        mediaCleanups.push(() => {
          audio.removeEventListener('play', onPlay)
          audio.removeEventListener('pause', onPause)
          audio.removeEventListener('ended', onEnded)
        })
        audioBox.appendChild(audio)
        mediaStage.appendChild(audioBox)
      }
      const badgeLabel = showOverlayInfo ? (offer.active ? (marker.badge_text || 'Oferta') : (hasTimedOffer ? '' : marker.badge_text || '')) : ''
      if (badgeLabel) {
        const badge = document.createElement('div')
        badge.className = 'dm-premium-media-badge'
        badge.textContent = badgeLabel
        mediaStage.appendChild(badge)
      }
      if (media.length > 1) {
        const prev = document.createElement('button')
        prev.type = 'button'
        prev.className = 'dm-premium-nav dm-premium-prev'
        prev.textContent = '‹'
        prev.addEventListener('click', (e) => {
          e.stopPropagation()
          chooseMedia((selectedMedia + media.length - 1) % media.length)
        })
        const next = document.createElement('button')
        next.type = 'button'
        next.className = 'dm-premium-nav dm-premium-next'
        next.textContent = '›'
        next.addEventListener('click', (e) => {
          e.stopPropagation()
          chooseMedia((selectedMedia + 1) % media.length)
        })
        mediaStage.appendChild(prev)
        mediaStage.appendChild(next)
      }
      if (thumbRow) {
        ;[...thumbRow.children].forEach((child, index) => {
          child.dataset.active = index === selectedMedia ? 'true' : 'false'
        })
      }
    }

    if (media.length) {
      const mediaPanel = document.createElement('div')
      mediaPanel.className = 'dm-premium-media'
      mediaStage = document.createElement('div')
      mediaStage.className = 'dm-premium-stage'
      mediaPanel.appendChild(mediaStage)
      if (media.length > 1) {
        thumbRow = document.createElement('div')
        thumbRow.className = 'dm-premium-thumbs'
        media.forEach((item, index) => {
          const thumb = document.createElement('button')
          thumb.type = 'button'
          thumb.className = 'dm-premium-thumb'
          thumb.dataset.active = index === selectedMedia ? 'true' : 'false'
          if (item.type === 'image') {
            const img = document.createElement('img')
            img.src = item.thumbnail_url || item.url
            img.alt = item.alt
            thumb.appendChild(img)
          } else {
            if (item.type === 'video' && item.thumbnail_url) {
              const img = document.createElement('img')
              img.src = item.thumbnail_url
              img.alt = item.title || 'Video'
              thumb.appendChild(img)
              const play = document.createElement('span')
              play.className = 'dm-premium-thumb-media-icon'
              play.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>'
              thumb.appendChild(play)
            } else {
              const card = document.createElement('span')
              card.className = 'dm-premium-thumb-card'
              card.innerHTML = item.type === 'video'
                ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg><span>Video</span>'
                : '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg><span>Audio</span>'
              thumb.appendChild(card)
            }
          }
          thumb.addEventListener('click', () => {
            chooseMedia(index)
          })
          thumbRow.appendChild(thumb)
        })
        mediaPanel.appendChild(thumbRow)
      }
      box.appendChild(mediaPanel)
    }

    const body = document.createElement('div')
    body.className = 'dm-premium-content'

    const title = document.createElement('h2')
    title.className = 'dm-premium-title'
    title.textContent = marker.name || 'Ficha dinámica'
    body.appendChild(title)

    if (marker.description) {
      const desc = document.createElement('p')
      desc.className = 'dm-premium-desc'
      desc.textContent = marker.description
      body.appendChild(desc)
    }

    const savings = savingsPercent(marker.previous_price_minor, offer.displayPriceMinor)
    const previousPrice = savings > 0 ? formatMarkerMoney(marker.previous_price_minor, marker.currency) : ''
    if (currentPrice || previousPrice) {
      const priceBox = document.createElement('div')
      priceBox.className = 'dm-premium-price'
      if (currentPrice) {
        const current = document.createElement('strong')
        current.className = 'dm-premium-current'
        current.textContent = currentPrice
        currentPriceNode = current
        priceBox.appendChild(current)
      }
      if (previousPrice) {
        const regular = document.createElement('div')
        regular.className = 'dm-premium-regular'
        regularPriceNode = regular
        const line = document.createElement('span')
        line.className = 'dm-premium-regular-line'
        line.appendChild(document.createTextNode('Precio regular: '))
        const previous = document.createElement('strong')
        previous.className = 'dm-premium-previous'
        previous.textContent = previousPrice
        line.appendChild(previous)
        const saved = document.createElement('span')
        saved.className = 'dm-premium-savings'
        saved.textContent = `Ahorras ${savings}%`
        savingsNode = saved
        regular.appendChild(line)
        regular.appendChild(saved)
        priceBox.appendChild(regular)
      }
      body.appendChild(priceBox)
    }
    if (offer.active) {
      priceCountdownNode = document.createElement('div')
      priceCountdownNode.className = 'dm-premium-price-countdown'
      const countdownKicker = document.createElement('span')
      countdownKicker.className = 'dm-premium-countdown-kicker'
      countdownKicker.textContent = 'Oferta termina en'
      const countdownValue = document.createElement('span')
      countdownValue.className = 'dm-premium-countdown-value'
      const countdownLabels = document.createElement('span')
      countdownLabels.className = 'dm-premium-countdown-labels'
      countdownLabels.innerHTML = '<span>Días</span><b>·</b><span>Horas</span><b>·</b><span>Minutos</span>'
      priceCountdownNode.appendChild(countdownKicker)
      priceCountdownNode.appendChild(countdownValue)
      priceCountdownNode.appendChild(countdownLabels)
      if (offer.showPromotionText) {
        const promo = document.createElement('span')
        promo.className = 'dm-premium-promo'
        promo.textContent = formatOfferPromotionText(marker)
        promoNode = promo
        priceCountdownNode.appendChild(promo)
      }
      offerCtaSlot = document.createElement('div')
      offerCtaSlot.className = 'dm-premium-offer-cta'
      priceCountdownNode.appendChild(offerCtaSlot)
      body.appendChild(priceCountdownNode)
    }

    const metaParts = [
      ['Referencia', marker.reference],
      ['Categoría', marker.category],
      ['Disponibilidad', marker.availability],
    ].filter(([, value]) => isNonEmpty(value))
    if (metaParts.length) {
      const meta = document.createElement('div')
      meta.className = 'dm-premium-meta'
      metaParts.forEach(([label, value], index) => {
        if (index) {
          const sep = document.createElement('span')
          sep.className = 'dm-premium-meta-sep'
          sep.textContent = '·'
          meta.appendChild(sep)
        }
        const item = document.createElement('span')
        item.className = 'dm-premium-meta-item'
        const key = document.createElement('strong')
        key.textContent = `${label}: `
        const val = document.createElement('span')
        val.textContent = String(value)
        item.appendChild(key)
        item.appendChild(val)
        meta.appendChild(item)
      })
      body.appendChild(meta)
    }

    if (colors.length) {
      const colorModule = document.createElement('div')
      colorModule.className = 'dm-premium-color-module'
      const key = document.createElement('div')
      key.className = 'dm-premium-module-title'
      key.textContent = 'Colores disponibles'
      const swatches = document.createElement('div')
      swatches.className = 'dm-premium-swatches'
      colors.forEach((color) => {
        const wrap = document.createElement('span')
        wrap.className = 'dm-premium-swatch-wrap'
        const swatch = document.createElement('span')
        swatch.className = 'dm-premium-swatch'
        swatch.style.background = color.hex
        swatch.title = color.name || color.hex
        wrap.appendChild(swatch)
        if (color.name && color.name !== color.hex) {
          const name = document.createElement('span')
          name.textContent = color.name
          wrap.appendChild(name)
        }
        swatches.appendChild(wrap)
      })
      colorModule.appendChild(key)
      colorModule.appendChild(swatches)
      if (swatches.childElementCount) body.appendChild(colorModule)
    }

    const accordions = document.createElement('div')
    accordions.className = 'dm-premium-accordions'
    addAccordion(accordions, 'Variantes y especificaciones', (section) => {
      const list = document.createElement('div')
      list.className = 'dm-premium-list'
      ;(Array.isArray(marker.sizes) ? marker.sizes : []).forEach((item) => appendRow(list, item?.label || 'Variante', item?.value || (item?.available === false ? 'No disponible' : 'Disponible')))
      section.appendChild(list)
    })
    addAccordion(accordions, 'Materiales', (section) => {
      const list = document.createElement('div')
      list.className = 'dm-premium-list'
      ;(Array.isArray(marker.materials) ? marker.materials : []).forEach((item) => appendRow(list, item?.name || 'Material', item?.available === false ? 'No disponible' : 'Disponible'))
      section.appendChild(list)
    })
    addAccordion(accordions, 'Medidas', (section) => {
      const list = document.createElement('div')
      list.className = 'dm-premium-list'
      ;(Array.isArray(marker.measurements) ? marker.measurements : []).forEach((item) => appendRow(list, item?.label || 'Medida', [item?.value, item?.unit].filter(Boolean).join(' ')))
      section.appendChild(list)
    })
    ;(Array.isArray(marker.custom_fields) ? marker.custom_fields : []).forEach((field) => {
      if (!field || typeof field !== 'object') return
      const value = markerCustomFieldValue(field.value)
      if (!isNonEmpty(value)) return
      addAccordion(accordions, field.label || field.name || field.key || 'Detalle', (section) => {
        const text = document.createElement('div')
        text.textContent = value
        section.appendChild(text)
      })
    })
    if (accordions.childElementCount) body.appendChild(accordions)

    const actions = marker.actions && typeof marker.actions === 'object' ? marker.actions : {}
    const contactAction = actions.contact_whatsapp || actions.whatsapp || {}
    const shareAction = actions.share || {}
    const offerCtaConfig = actions.offer_cta && typeof actions.offer_cta === 'object' ? actions.offer_cta : {}
    const offerCtaCopy = typeof offerCtaConfig.custom_label === 'string' && offerCtaConfig.custom_label.trim()
      ? offerCtaConfig.custom_label.trim()
      : typeof offerCtaConfig.preset === 'string' && offerCtaConfig.preset.trim()
        ? offerCtaConfig.preset.trim()
        : ''
    actionBar = document.createElement('div')
    actionBar.className = 'dm-premium-actions'
    const icons = {
      whatsapp: '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.5 3.5A11.7 11.7 0 0 0 12.2 0C5.7 0 .5 5.2.5 11.6c0 2 .5 4 1.5 5.7L0 24l6.9-1.8a11.7 11.7 0 0 0 5.3 1.3h.1c6.4 0 11.6-5.2 11.7-11.6 0-3.1-1.2-6-3.5-8.4ZM12.3 21.6h-.1c-1.7 0-3.4-.5-4.9-1.3l-.4-.2-4.1 1.1 1.1-4-.3-.4a9.8 9.8 0 0 1-1.5-5.1c0-5.4 4.4-9.7 9.8-9.7 2.6 0 5.1 1 6.9 2.9a9.6 9.6 0 0 1 2.8 6.9c-.1 5.4-4.4 9.8-9.3 9.8Zm5.3-7.3c-.3-.1-1.7-.8-1.9-.9-.3-.1-.5-.1-.7.1-.2.3-.8.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.4-2.3-1.4-.8-.8-1.4-1.7-1.6-2-.2-.3 0-.4.1-.6l.5-.5c.2-.2.2-.3.3-.5.1-.2 0-.4 0-.5 0-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.7-.7 1.9-1.3.2-.6.2-1.2.2-1.3-.1-.2-.3-.3-.6-.4Z"/></svg>',
      link: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>',
      facebook: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7h-2.5V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z"/></svg>',
      instagram: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/></svg>',
      copy: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1 0l2.8-2.8a5 5 0 0 0-7.1-7.1l-1.6 1.6"/><path d="M14 11a5 5 0 0 0-7.1 0l-2.8 2.8a5 5 0 0 0 7.1 7.1l1.6-1.6"/></svg>',
      share: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>',
      booking: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    }
    const makeAction = (label, className, onClick, icon = '', key = '', disabled = false) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = `dm-premium-action ${className}${disabled ? ' dm-premium-disabled' : ''}`
      btn.innerHTML = `${icon}<span>${label}</span>`
      if (key) btn.dataset.actionKey = key
      if (!disabled) btn.addEventListener('click', onClick)
      return btn
    }
    const appendAction = (label, className, onClick, icon = '', key = '', disabled = false) => {
      const btn = makeAction(label, className, onClick, icon, key, disabled)
      actionBar.appendChild(btn)
      return btn
    }
    const showBookingRequestModal = () => {
      document.querySelectorAll('.dm-booking-overlay').forEach((node) => node.remove())
      const bookingAction = actions.booking && typeof actions.booking === 'object' ? actions.booking : {}
      const appointmentTypes = Array.isArray(bookingAction.appointment_types) && bookingAction.appointment_types.length
        ? bookingAction.appointment_types.map((item) => String(item || '').trim()).filter(Boolean)
        : ['Visita', 'Llamada', 'Videollamada']
      const requireDate = bookingAction.require_date !== false
      const requireTime = bookingAction.require_time !== false
      const today = new Date()
      const minDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      let reviewMode = false
      let availability = { timezone: '', days: [], slots: [], appointment_types: appointmentTypes, appointment_type_details: [] }
      let availabilityLoading = false

      const overlay = document.createElement('div')
      overlay.className = 'dm-booking-overlay'
      overlay.style.setProperty('--dm-accent', accentColor)
      const card = document.createElement('form')
      card.className = 'dm-booking-card'
      card.noValidate = true
      const title = document.createElement('h3')
      title.textContent = 'Agendar una cita'
      const context = document.createElement('div')
      context.className = 'dm-booking-context'
      ;[
        marker.name,
        marker.reference ? `Referencia: ${marker.reference}` : '',
        currentPrice ? `Precio: ${currentPrice}` : '',
      ].filter(Boolean).forEach((row) => {
        const line = document.createElement('span')
        line.textContent = row
        context.appendChild(line)
      })

      const status = document.createElement('p')
      status.className = 'dm-booking-error'
      const success = document.createElement('p')
      success.className = 'dm-booking-success'
      const reviewBox = document.createElement('div')
      reviewBox.className = 'dm-booking-review'
      reviewBox.style.display = 'none'
      const inputs = {}
      const editNodes = []
      const appendEditNode = (node) => {
        editNodes.push(node)
        card.appendChild(node)
      }

      const appointmentWrap = document.createElement('label')
      appointmentWrap.className = 'dm-booking-field'
      appointmentWrap.textContent = 'Tipo de cita'
      const appointmentSelect = document.createElement('select')
      appointmentSelect.name = 'appointment_type'
      appointmentSelect.required = true
      appointmentSelect.style.cssText = 'border:1px solid rgba(255,255,255,.16);border-radius:10px;background:rgba(15,23,42,.9);color:#fff;padding:10px;font:inherit;font-size:14px'
      const emptyOption = document.createElement('option')
      emptyOption.value = ''
      emptyOption.textContent = 'Selecciona una opción'
      appointmentSelect.appendChild(emptyOption)
      appointmentTypes.forEach((type) => {
        const option = document.createElement('option')
        option.value = type
        option.textContent = type
        appointmentSelect.appendChild(option)
      })
      appointmentWrap.appendChild(appointmentSelect)
      inputs.appointment_type = appointmentSelect
      const availabilityNote = document.createElement('p')
      availabilityNote.className = 'dm-booking-availability-note'
      availabilityNote.textContent = 'Cargando disponibilidad...'

      const instructionsBox = document.createElement('div')
      instructionsBox.className = 'dm-booking-instructions'

      const selectedAppointmentDetail = () => (
        (availability.appointment_type_details || []).find(
          (item) => item && item.label === appointmentSelect.value,
        ) || null
      )

      const appointmentDeliveryModeLabel = (value) => {
        const labels = {
          in_person: 'Presencial',
          video_call: 'Videollamada',
          phone_call: 'Llamada telefónica',
          other: 'Otra modalidad',
        }

        return labels[String(value || '').trim()] || ''
      }

      const renderAppointmentInstructions = () => {
        const detail = selectedAppointmentDetail()
        const rows = [
          ['Modalidad', appointmentDeliveryModeLabel(detail?.delivery_mode)],
          ['Lugar', detail?.location_text],
          ['Indicaciones', detail?.customer_instructions],
        ].filter(([, value]) => Boolean(String(value || '').trim()))

        instructionsBox.innerHTML = ''

        if (!rows.length) {
          instructionsBox.style.display = 'none'
          return
        }

        const heading = document.createElement('strong')
        heading.textContent = 'Detalles de tu cita'
        instructionsBox.appendChild(heading)

        rows.forEach(([label, value]) => {
          const row = document.createElement('span')
          row.className = 'dm-booking-instructions-line'

          const labelNode = document.createElement('b')
          labelNode.textContent = `${label}: `

          row.appendChild(labelNode)
          row.appendChild(document.createTextNode(String(value).trim()))
          instructionsBox.appendChild(row)
        })

        instructionsBox.style.display = 'block'
      }

      const scheduleGrid = document.createElement('div')
      scheduleGrid.style.display = 'grid'
      scheduleGrid.style.gridTemplateColumns = 'repeat(auto-fit,minmax(150px,1fr))'
      scheduleGrid.style.gap = '10px'
      let activePicker = ''
      let dateMonth = new Date(today.getFullYear(), today.getMonth(), 1)
      const calendarIcon = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>'
      const clockIcon = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
      const toDateValue = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      const formatDateLabel = (value) => {
        if (!value) return 'dd/mm/aaaa'
        const [year, month, day] = value.split('-')
        return `${day}/${month}/${year}`
      }
      const formatTimeLabel = (value) => {
        if (!value) return '--:--'
        const [hours, minutes] = value.split(':').map(Number)
        if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value
        const suffix = hours < 12 ? 'a. m.' : 'p. m.'
        const displayHour = hours % 12 || 12
        return `${displayHour}:${String(minutes).padStart(2, '0')} ${suffix}`
      }
      const closePicker = () => {
        activePicker = ''
        ;[dateField, timeField].forEach((field) => field?.setOpen(false))
      }
      const openPicker = (name) => {
        activePicker = activePicker === name ? '' : name
        dateField.setOpen(activePicker === 'date')
        timeField.setOpen(activePicker === 'time')
      }
      const availableDates = () => new Set((availability.days || []).map((day) => day.date))
      const syncAppointmentOptions = (types) => {
        const current = appointmentSelect.value
        appointmentSelect.innerHTML = ''
        const empty = document.createElement('option')
        empty.value = ''
        empty.textContent = 'Selecciona una opción'
        appointmentSelect.appendChild(empty)
        ;(types && types.length ? types : appointmentTypes).forEach((type) => {
          const option = document.createElement('option')
          option.value = type
          option.textContent = type
          appointmentSelect.appendChild(option)
        })
        appointmentSelect.value = types?.includes(current) ? current : ''
      }
      const setAvailabilityNote = () => {
        if (availabilityLoading) {
          availabilityNote.textContent = 'Cargando disponibilidad...'
          renderAppointmentInstructions()
          return
        }

        if (!appointmentSelect.value) {
          availabilityNote.textContent = 'Selecciona un tipo de cita para ver disponibilidad real.'
          renderAppointmentInstructions()
          return
        }

        if (availability.timezone) {
          const count = availability.days?.length || 0
          availabilityNote.textContent = count
            ? `Zona horaria: ${availability.timezone}. Selecciona un día con cupo disponible.`
            : `Zona horaria: ${availability.timezone}. No hay horarios disponibles.`
          renderAppointmentInstructions()
          return
        }

        availabilityNote.textContent = 'No se pudo cargar disponibilidad.'
        renderAppointmentInstructions()
      }

      const fetchAvailability = async (dateValue) => {
        availabilityLoading = true
        setAvailabilityNote()
        const params = new URLSearchParams()
        const monthStart = new Date(dateMonth.getFullYear(), dateMonth.getMonth(), 1)
        const monthDays = new Date(dateMonth.getFullYear(), dateMonth.getMonth() + 1, 0).getDate()
        params.set('from', toDateValue(monthStart))
        params.set('days', String(Math.min(31, monthDays)))
        if (dateValue) params.set('date', dateValue)
        if (appointmentSelect.value) params.set('appointment_type', appointmentSelect.value)
        try {
          const response = await fetch(`${API_BASE}/view/${encodeURIComponent(slug)}/markers/${encodeURIComponent(marker.id)}/booking/availability${params.size ? `?${params}` : ''}`)
          const data = await response.json().catch(() => ({}))
          if (!response.ok || !data.success) throw new Error(data.error || 'No se pudo cargar disponibilidad')
          availability = data.data || availability
          syncAppointmentOptions(availability.appointment_types || appointmentTypes)
          if (dateValue && !(availability.slots || []).some((slot) => slot.time === inputs.preferred_time?.value)) {
            inputs.preferred_time.value = ''
            timeField?.setText()
          }
        } catch (error) {
          availability = { timezone: '', days: [], slots: [], appointment_types: appointmentTypes, appointment_type_details: [] }
          status.textContent = friendlyRequestError(error, 'No pudimos cargar la disponibilidad. Inténtalo nuevamente.')
        } finally {
          availabilityLoading = false
          setAvailabilityNote()
          dateField?.refresh()
          timeField?.refresh()
        }
      }
      const makePickerField = (name, label, kind) => {
        const wrap = document.createElement('div')
        wrap.className = 'dm-booking-picker-field'
        wrap.dataset.pickerField = kind
        const labelNode = document.createElement('span')
        labelNode.textContent = label
        const input = document.createElement('input')
        input.type = 'hidden'
        input.name = name
        const trigger = document.createElement('button')
        trigger.type = 'button'
        trigger.className = 'dm-booking-picker-trigger'
        trigger.setAttribute('aria-expanded', 'false')
        const text = document.createElement('span')
        const icon = document.createElement('span')
        icon.innerHTML = kind === 'date' ? calendarIcon : clockIcon
        trigger.appendChild(text)
        trigger.appendChild(icon)
        const panelSlot = document.createElement('div')
        const setText = () => {
          text.textContent = kind === 'date' ? formatDateLabel(input.value) : formatTimeLabel(input.value)
        }
        const setOpen = (isOpen) => {
          trigger.dataset.open = isOpen ? 'true' : 'false'
          trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false')
          panelSlot.innerHTML = ''
          if (isOpen) panelSlot.appendChild(kind === 'date' ? renderDatePanel() : renderTimePanel())
        }
        const refresh = () => {
          setText()
          if (trigger.dataset.open === 'true') setOpen(true)
        }
        const renderDatePanel = () => {
          const panel = document.createElement('div')
          panel.className = 'dm-booking-picker-panel'
          const head = document.createElement('div')
          head.className = 'dm-booking-calendar-head'
          const prev = document.createElement('button')
          prev.type = 'button'
          prev.textContent = '‹'
          const next = document.createElement('button')
          next.type = 'button'
          next.textContent = '›'
          const title = document.createElement('span')
          title.textContent = dateMonth.toLocaleDateString('es-DO', { month: 'long', year: 'numeric' })
          prev.disabled = dateMonth.getFullYear() === today.getFullYear() && dateMonth.getMonth() === today.getMonth()
          prev.addEventListener('click', () => {
            if (prev.disabled) return
            dateMonth = new Date(dateMonth.getFullYear(), dateMonth.getMonth() - 1, 1)
            fetchAvailability(input.value)
            setOpen(true)
          })
          next.addEventListener('click', () => {
            dateMonth = new Date(dateMonth.getFullYear(), dateMonth.getMonth() + 1, 1)
            fetchAvailability(input.value)
            setOpen(true)
          })
          head.appendChild(prev)
          head.appendChild(title)
          head.appendChild(next)
          const week = document.createElement('div')
          week.className = 'dm-booking-week'
          ;['L', 'M', 'M', 'J', 'V', 'S', 'D'].forEach((day) => {
            const node = document.createElement('span')
            node.textContent = day
            week.appendChild(node)
          })
          const days = document.createElement('div')
          days.className = 'dm-booking-days'
          const firstOffset = (new Date(dateMonth.getFullYear(), dateMonth.getMonth(), 1).getDay() + 6) % 7
          const totalDays = new Date(dateMonth.getFullYear(), dateMonth.getMonth() + 1, 0).getDate()
          for (let i = 0; i < firstOffset; i += 1) days.appendChild(document.createElement('span'))
          for (let day = 1; day <= totalDays; day += 1) {
            const date = new Date(dateMonth.getFullYear(), dateMonth.getMonth(), day)
            const value = toDateValue(date)
            const btn = document.createElement('button')
            btn.type = 'button'
            btn.className = 'dm-booking-day'
            btn.textContent = String(day)
            btn.disabled = value < minDate || !availableDates().has(value)
            btn.dataset.selected = input.value === value ? 'true' : 'false'
            btn.addEventListener('click', () => {
              if (btn.disabled) return
              input.value = value
              inputs.preferred_time.value = ''
              timeField.setText()
              setText()
              closePicker()
              fetchAvailability(value)
              trigger.focus()
            })
            days.appendChild(btn)
          }
          panel.appendChild(head)
          panel.appendChild(week)
          panel.appendChild(days)
          return panel
        }
        const renderTimePanel = () => {
          const panel = document.createElement('div')
          panel.className = 'dm-booking-picker-panel'
          const grid = document.createElement('div')
          grid.className = 'dm-booking-time-grid'
          const slots = availability.slots || []
          if (!inputs.preferred_date.value) {
            const empty = document.createElement('p')
            empty.className = 'dm-booking-empty'
            empty.textContent = 'Selecciona una fecha disponible.'
            panel.appendChild(empty)
            return panel
          }
          if (!slots.length) {
            const empty = document.createElement('p')
            empty.className = 'dm-booking-empty'
            empty.textContent = 'No hay horarios disponibles para este día.'
            panel.appendChild(empty)
            return panel
          }
          slots.forEach((slot) => {
            const value = slot.time
            const btn = document.createElement('button')
            btn.type = 'button'
            btn.className = 'dm-booking-time-option'
            btn.textContent = slot.label ? formatTimeLabel(slot.time) : formatTimeLabel(value)
            btn.dataset.selected = input.value === value ? 'true' : 'false'
            btn.addEventListener('click', () => {
              input.value = value
              setText()
              closePicker()
              trigger.focus()
            })
            grid.appendChild(btn)
          })
          panel.appendChild(grid)
          return panel
        }
        trigger.addEventListener('click', () => openPicker(kind))
        setText()
        wrap.appendChild(labelNode)
        wrap.appendChild(trigger)
        wrap.appendChild(input)
        wrap.appendChild(panelSlot)
        inputs[name] = input
        return { node: wrap, input, setOpen, setText, refresh }
      }
      const addField = (name, label, type, required) => {
        const wrap = document.createElement('label')
        wrap.className = 'dm-booking-field'
        wrap.textContent = label
        const input = document.createElement('input')
        input.name = name
        input.type = type
        input.required = required
        wrap.appendChild(input)
        inputs[name] = input
        return wrap
      }
      const dateField = makePickerField('preferred_date', 'Fecha preferida', 'date')
      const timeField = makePickerField('preferred_time', 'Hora preferida', 'time')
      scheduleGrid.appendChild(dateField.node)
      scheduleGrid.appendChild(timeField.node)
      appointmentSelect.addEventListener('change', () => {
        inputs.preferred_date.value = ''
        inputs.preferred_time.value = ''
        dateField.setText()
        timeField.setText()
        closePicker()
        fetchAvailability('')
      })

      const customerFields = [
        ['name', 'Nombre completo', 'text', true],
        ['phone', 'WhatsApp', 'tel', true],
        ['email', 'Correo', 'email', false],
      ].map((field) => addField(...field))
      const messageWrap = document.createElement('label')
      messageWrap.className = 'dm-booking-field'
      messageWrap.textContent = 'Mensaje'
      const message = document.createElement('textarea')
      message.name = 'message'
      message.placeholder = 'Cuéntanos qué necesitas coordinar'
      inputs.message = message
      messageWrap.appendChild(message)
      const honey = document.createElement('input')
      honey.name = 'honeypot'
      honey.tabIndex = -1
      honey.autocomplete = 'off'
      honey.style.display = 'none'

      card.appendChild(title)
      if (context.childElementCount) card.appendChild(context)
      appendEditNode(appointmentWrap)
      appendEditNode(availabilityNote)
      appendEditNode(instructionsBox)
      appendEditNode(scheduleGrid)
      customerFields.forEach(appendEditNode)
      appendEditNode(messageWrap)
      card.appendChild(honey)
      card.appendChild(reviewBox)
      card.appendChild(status)
      card.appendChild(success)

      const actionsRow = document.createElement('div')
      actionsRow.className = 'dm-booking-actions'
      const cancel = document.createElement('button')
      cancel.type = 'button'
      cancel.className = 'dm-booking-cancel'
      cancel.textContent = 'Cancelar'
      const submit = document.createElement('button')
      submit.type = 'submit'
      submit.className = 'dm-booking-submit'
      submit.textContent = 'Revisar cita'
      actionsRow.appendChild(cancel)
      actionsRow.appendChild(submit)
      card.appendChild(actionsRow)

      const cleanupBooking = () => {
        document.removeEventListener('keydown', onBookingKey)
        overlay.remove()
      }
      const onBookingKey = (event) => {
        if (event.key === 'Escape') {
          if (activePicker) closePicker()
          else cleanupBooking()
        }
      }
      const buildPayload = () => ({
        appointment_type: inputs.appointment_type.value,
        preferred_date: inputs.preferred_date.value,
        preferred_time: inputs.preferred_time.value,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Santo_Domingo',
        name: inputs.name.value.trim(),
        phone: inputs.phone.value.trim(),
        email: inputs.email.value.trim(),
        message: inputs.message.value.trim(),
        honeypot: honey.value,
        source_url: location.href,
      })
      const validateBooking = (payload) => {
        if (!payload.appointment_type) return 'Selecciona un tipo de cita'
        if (requireDate && !payload.preferred_date) return 'Fecha preferida es requerida'
        if (payload.preferred_date && payload.preferred_date < minDate) return 'La fecha preferida debe ser futura'
        if (requireTime && !payload.preferred_time) return 'Hora preferida es requerida'
        if (!payload.name) return 'Nombre completo es requerido'
        if (!payload.phone) return 'WhatsApp es requerido'
        return ''
      }
      const setReviewMode = (next) => {
        reviewMode = next
        title.textContent = reviewMode ? 'Resumen de tu cita' : 'Agendar una cita'
        editNodes.forEach((node) => { node.style.display = reviewMode ? 'none' : '' })
        reviewBox.style.display = reviewMode ? 'flex' : 'none'
        cancel.textContent = reviewMode ? 'Volver a editar' : 'Cancelar'
        submit.textContent = reviewMode ? 'Confirmar cita' : 'Revisar cita'
        if (!reviewMode) {
          reviewBox.innerHTML = ''
          status.textContent = ''
        }
      }
      const renderReview = (payload) => {
        reviewBox.innerHTML = ''
        const appointment = document.createElement('div')
        appointment.className = 'dm-booking-review-item'
        const typeDetail = selectedAppointmentDetail()
        const deliveryMode = appointmentDeliveryModeLabel(typeDetail?.delivery_mode)
        const instructionLines = [
          deliveryMode ? `Modalidad: ${escapeHtml(deliveryMode)}` : '',
          typeDetail?.location_text ? `Lugar: ${escapeHtml(typeDetail.location_text)}` : '',
          typeDetail?.customer_instructions ? `Indicaciones: ${escapeHtml(typeDetail.customer_instructions)}` : '',
        ].filter(Boolean).join('<br>')

        appointment.innerHTML = `<strong>${escapeHtml(marker.name || 'Ficha dinámica')}</strong><br>Tipo de cita: ${escapeHtml(payload.appointment_type)}${payload.preferred_date ? `<br>Fecha preferida: ${escapeHtml(formatDateLabel(payload.preferred_date))}` : ''}${payload.preferred_time ? `<br>Hora preferida: ${escapeHtml(formatTimeLabel(payload.preferred_time))}` : ''}${instructionLines ? `<br>${instructionLines}` : ''}`
        reviewBox.appendChild(appointment)
        const customer = document.createElement('div')
        customer.className = 'dm-booking-review-item'
        customer.innerHTML = `<strong>${escapeHtml(payload.name)}</strong><br>${escapeHtml(payload.phone)}${payload.email ? `<br>${escapeHtml(payload.email)}` : ''}${payload.message ? `<br>${escapeHtml(payload.message)}` : ''}`
        reviewBox.appendChild(customer)
        const note = document.createElement('p')
        note.className = 'dm-booking-note'
        note.textContent = 'La cita queda pendiente de confirmación por el vendedor.'
        reviewBox.appendChild(note)
      }
      cancel.addEventListener('click', () => {
        if (reviewMode) setReviewMode(false)
        else cleanupBooking()
      })
      overlay.addEventListener('click', (event) => { if (event.target === overlay) cleanupBooking() })
      card.addEventListener('click', (event) => {
        if (activePicker && !(event.target instanceof Element && event.target.closest('.dm-booking-picker-field'))) closePicker()
      })
      document.addEventListener('keydown', onBookingKey)
      card.addEventListener('submit', async (event) => {
        event.preventDefault()
        status.textContent = ''
        success.textContent = ''
        const payload = buildPayload()
        const formError = validateBooking(payload)
        if (formError) {
          status.textContent = formError
          return
        }
        if (!reviewMode) {
          renderReview(payload)
          setReviewMode(true)
          card.scrollTop = 0
          return
        }
        submit.disabled = true
        submit.textContent = 'Enviando...'
        try {
          const response = await fetch(`${API_BASE}/view/${encodeURIComponent(slug)}/markers/${encodeURIComponent(marker.id)}/booking`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          const data = await response.json().catch(() => ({}))
          if (!response.ok || !data.success) throw new Error(data.error || 'No se pudo enviar la solicitud')
          const typeDetail = selectedAppointmentDetail()
          const sentInstruction = typeDetail?.customer_instructions
            ? ` Indicaciones registradas: ${typeDetail.customer_instructions}`
            : ''
          success.textContent = `${data.data?.message || 'Tu cita fue recibida. El vendedor confirmará disponibilidad contigo.'}${sentInstruction}`
          Object.values(inputs).forEach((input) => { input.disabled = true })
          submit.remove()
        } catch (error) {
          status.textContent = friendlyRequestError(error, 'No pudimos enviar la cita. Inténtalo nuevamente.')
          submit.disabled = false
          submit.textContent = 'Confirmar cita'
        }
      })
      overlay.appendChild(card)
      document.body.appendChild(overlay)
      fetchAvailability('')
      inputs.appointment_type.focus()
    }
    actionDefinitions = []
    if (contactAction?.enabled && contactAction?.phone) {
      const openWhatsApp = (messageCopy) => {
        const messageLines = [
          `Hola, me interesa: ${marker.name || 'esta ficha'}`,
          marker.reference ? `Referencia: ${marker.reference}` : '',
        ].filter(Boolean)
        const finalCopy = messageCopy || contactAction.message_template || ''
        if (finalCopy) messageLines.push('', finalCopy)
        const message = messageLines.join('\n')
        window.open(`https://wa.me/${String(contactAction.phone).replace(/[^\d]/g, '')}?text=${encodeURIComponent(message)}`, '_blank', 'noopener')
      }
      actionDefinitions.push(['contact_whatsapp', contactAction.label || 'Contactar vendedor', 'dm-action-whatsapp', () => openWhatsApp(''), icons.whatsapp, (label) => openWhatsApp(label)])
    }
    if (actions.external_link?.enabled && safeUrl(actions.external_link.url)) {
      actionDefinitions.push(['external_link', actions.external_link.label || 'Ver enlace', 'dm-action-link', () => {
        window.open(safeUrl(actions.external_link.url), '_blank', 'noopener')
      }, icons.link])
    }
    if (actions.booking?.enabled) {
      actionDefinitions.push(['booking', actions.booking.label || 'Agendar', 'dm-action-booking', showBookingRequestModal, icons.booking])
    }
    offerTarget = offer.active && ['contact_whatsapp', 'external_link'].includes(offerCtaConfig?.target) ? offerCtaConfig.target : ''
    if (offerTarget && offerCtaSlot) {
      const selected = actionDefinitions.find(([key]) => key === offerTarget)
      if (selected) {
        const visibleLabel = offerCtaCopy || selected[1]
        const onClick = selected[5] ? () => selected[5](visibleLabel) : selected[3]
        offerCtaSlot.appendChild(makeAction(visibleLabel, selected[2], onClick, selected[4], selected[0]))
      }
    }
    actionDefinitions
      .filter(([key]) => key !== offerTarget)
      .forEach(([key, label, className, onClick, icon]) => appendAction(label, className, onClick, icon, key))
    const shareEnabled = Boolean(shareAction.enabled || shareAction.whatsapp || shareAction.facebook || shareAction.copy_link || shareAction.native)
    if (shareEnabled) {
      const sharePanel = document.createElement('div')
      sharePanel.className = 'dm-premium-share'
      const shareTitle = document.createElement('div')
      shareTitle.className = 'dm-premium-share-title'
      shareTitle.textContent = 'Compartir en'
      const shareGrid = document.createElement('div')
      shareGrid.className = 'dm-premium-share-grid'
      const shareText = `${marker.name || document.title}\n${location.href}`
      const addShare = (label, icon, onClick) => {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.innerHTML = icon
        btn.title = label
        btn.setAttribute('aria-label', label)
        btn.addEventListener('click', onClick)
        shareGrid.appendChild(btn)
        return btn
      }
      if (shareAction.whatsapp) addShare('WhatsApp', icons.whatsapp, () => window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank', 'noopener')).dataset.network = 'whatsapp'
      if (shareAction.facebook) addShare('Facebook', icons.facebook, () => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(location.href)}`, '_blank', 'noopener')).dataset.network = 'facebook'
      if (safeUrl(shareAction.instagram_url)) addShare('Instagram', icons.instagram, () => window.open(safeUrl(shareAction.instagram_url), '_blank', 'noopener')).dataset.network = 'instagram'
      if (shareAction.copy_link) addShare('Copiar enlace', icons.copy, async () => {
        if (await copyTextToClipboard(location.href)) showMarkerToast('Enlace copiado')
      })
      if (shareAction.native && navigator.share) addShare('Compartir', icons.share, async () => {
        try {
          await navigator.share({ title: marker.name || document.title, text: marker.description || '', url: location.href })
        } catch (e) {}
      })
      sharePanel.appendChild(shareTitle)
      sharePanel.appendChild(shareGrid)
      if (shareGrid.childElementCount) actionBar.appendChild(sharePanel)
    }
    if (actionBar.childElementCount) body.appendChild(actionBar)

    function cleanup() {
      stopAllGalleryTimers()
      cleanupRenderedMedia()
      if (countdownTimer) clearInterval(countdownTimer)
      document.removeEventListener('keydown', onKey)
      back.remove()
    }
    function onKey(e) {
      if (e.key === 'Escape') cleanup()
    }
    close.addEventListener('click', cleanup)
    back.addEventListener('click', (e) => { if (e.target === back) cleanup() })
    document.addEventListener('keydown', onKey)

    box.appendChild(close)
    box.appendChild(body)
    back.appendChild(box)
    document.body.appendChild(back)
    renderMedia()
    if (offer.active && !countdownTimer) {
      updateCountdown()
      countdownTimer = setInterval(updateCountdown, 1000)
    }
    startGalleryTimer()
  }

  function ensurePublicCatalogStyles() {
    if (document.getElementById('dynamic-marker-catalog-styles')) return
    const style = document.createElement('style')
    style.id = 'dynamic-marker-catalog-styles'
    style.textContent = `
      .dm-catalog-trigger{min-width:auto;padding:0 12px;border:0;border-radius:999px;background:#4f46e5;color:#fff;font:800 12px Inter,system-ui,sans-serif;cursor:pointer;height:38px;display:inline-flex;align-items:center;justify-content:center;gap:7px;white-space:nowrap}.dm-catalog-trigger svg{width:15px;height:15px;flex:0 0 auto}
      .dm-catalog-overlay{position:fixed;inset:0;z-index:2100;background:rgba(2,6,23,.38);display:flex;align-items:flex-start;justify-content:flex-end;padding:78px 18px 18px;font-family:Inter,system-ui,sans-serif;color:#111827}
      .dm-catalog-panel{width:min(430px,calc(100vw - 36px));max-height:min(720px,calc(100dvh - 96px));border:1px solid rgba(15,23,42,.12);border-radius:18px;background:#fff;box-shadow:0 24px 70px rgba(15,23,42,.35);display:flex;flex-direction:column;overflow:hidden}
      .dm-catalog-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:16px 16px 12px;border-bottom:1px solid #e5e7eb}.dm-catalog-title{margin:0;font-size:18px;color:#111827}.dm-catalog-copy{margin:3px 0 0;color:#6b7280;font-size:12px;line-height:1.35}.dm-catalog-close{border:1px solid #d1d5db;border-radius:999px;background:#fff;color:#374151;width:32px;height:32px;font-size:20px;line-height:1;cursor:pointer}
      .dm-catalog-form{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px 16px;border-bottom:1px solid #f3f4f6}.dm-catalog-form label{display:flex;flex-direction:column;gap:4px;color:#4b5563;font-size:11px;font-weight:850}.dm-catalog-form input,.dm-catalog-form select{min-width:0;border:1px solid #d1d5db;border-radius:10px;background:#fff;color:#111827;padding:9px 10px;font:500 13px Inter,system-ui,sans-serif;box-sizing:border-box}.dm-catalog-form .dm-catalog-wide{grid-column:1/-1}.dm-catalog-search-row{grid-column:1/-1;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end}.dm-catalog-query{min-width:0}.dm-catalog-actions{display:flex;gap:8px;align-items:flex-end}.dm-catalog-help{grid-column:1/-1;margin:0;color:#4b5563;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:8px 10px;font-size:12px;line-height:1.35}.dm-catalog-search,.dm-catalog-clear,.dm-catalog-more{border:0;border-radius:10px;padding:10px 12px;font:900 13px Inter,system-ui,sans-serif;cursor:pointer}.dm-catalog-search{background:#4f46e5;color:#fff}.dm-catalog-clear,.dm-catalog-more{background:#f3f4f6;color:#374151}
      .dm-catalog-summary{margin:0;padding:10px 16px;border-bottom:1px solid #f3f4f6;color:#4b5563;font:800 12px Inter,system-ui,sans-serif}
      .dm-catalog-body{min-height:150px;overflow:auto;padding:12px 16px;display:flex;flex-direction:column;gap:9px}.dm-catalog-state{border:1px solid #e5e7eb;border-radius:12px;background:#f9fafb;color:#6b7280;padding:16px;text-align:center;font-size:13px;line-height:1.45}.dm-catalog-error{border-color:#fecaca;background:#fef2f2;color:#991b1b}
      .dm-catalog-item{border:1px solid #e5e7eb;border-radius:12px;background:#fff;padding:9px;display:grid;grid-template-columns:64px minmax(0,1fr);gap:10px;text-align:left;color:#111827;cursor:pointer;font-family:Inter,system-ui,sans-serif}.dm-catalog-item:disabled{opacity:.66;cursor:wait}.dm-catalog-cover{width:64px;height:64px;border-radius:10px;background:linear-gradient(135deg,#f9fafb,#e5e7eb);overflow:hidden;display:flex;align-items:center;justify-content:center;color:#6b7280;font-size:10px;font-weight:900}.dm-catalog-cover img{width:100%;height:100%;object-fit:cover;display:block}.dm-catalog-info{min-width:0;display:flex;flex-direction:column;gap:4px}.dm-catalog-row{display:flex;gap:6px;align-items:center;min-width:0}.dm-catalog-name{font-size:13px;font-weight:950;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dm-catalog-badge{border-radius:999px;background:#fff7ed;color:#9a3412;padding:2px 7px;font-size:10px;font-weight:950;white-space:nowrap}.dm-catalog-meta{color:#6b7280;font-size:11.5px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dm-catalog-price{color:#111827;font-size:12px;font-weight:900}
      .dm-catalog-footer{padding:0 16px 14px;display:flex;justify-content:center}.dm-catalog-more:disabled{opacity:.6;cursor:wait}
      @media (max-width: 820px){.dm-catalog-trigger{width:38px;padding:0}.dm-catalog-trigger span{display:none}.dm-catalog-overlay{align-items:flex-end;justify-content:center;padding:0;background:rgba(2,6,23,.52)}.dm-catalog-panel{width:100vw;max-height:88dvh;border-radius:22px 22px 0 0}.dm-catalog-form,.dm-catalog-search-row{grid-template-columns:1fr}.dm-catalog-actions{flex-direction:column}.dm-catalog-search,.dm-catalog-clear{width:100%}}
    `
    document.head.appendChild(style)
  }

  function setupPublicCatalogSearch() {
    const controls = document.getElementById('controls')
    const shareBtn = document.getElementById('btn-share')
    if (!controls || !shareBtn || document.getElementById('btn-dynamic-catalog')) return

    ensurePublicCatalogStyles()

    const state = {
      visible: false,
      initialized: false,
      loading: false,
      loadingMore: false,
      detailLoadingId: '',
      error: '',
      items: [],
      page: { has_more: false, next_cursor: null },
      filters: { q: '', category: '', availability: '', price_min: '', price_max: '' },
      meta: { filters: { categories: [], availabilities: [], price_range: { min_minor: null, max_minor: null, currency: 'USD' } } },
    }

    const trigger = document.createElement('button')
    trigger.id = 'btn-dynamic-catalog'
    trigger.type = 'button'
    trigger.className = 'dm-catalog-trigger'
    trigger.title = 'Buscar en catálogo'
    trigger.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg><span>Buscar</span>'
    trigger.dataset.flipInteractive = 'true'
    trigger.style.display = 'none'

    const sep = document.createElement('div')
    sep.className = 'ctrl-sep'
    sep.dataset.catalogSeparator = 'true'
    sep.style.display = 'none'

    controls.insertBefore(sep, shareBtn)
    controls.insertBefore(trigger, shareBtn)

    let overlay = null
    let body = null
    let footer = null
    let summary = null
    let priceRangeHelp = null
    const inputs = {}

    function catalogUrl({ append = false } = {}) {
      const qs = new URLSearchParams()
      qs.set('limit', '12')
      if (append && state.page.next_cursor) qs.set('cursor', state.page.next_cursor)
      Object.entries(state.filters).forEach(([key, value]) => {
        const clean = String(value || '').trim()
        if (!clean) return
        qs.set(key, clean)
      })
      return `${API_BASE}/view/${encodeURIComponent(slug)}/dynamic-markers/catalog?${qs.toString()}`
    }

    function money(value, currency) {
      return formatMarkerMoney(value, currency)
    }

    function friendlyCatalogError(error, action = 'load') {
      const message = rawErrorMessage(error)
      const normalized = message.toLowerCase()
      if (normalized.includes('price_min') && normalized.includes('price_max')) return 'El precio mínimo no puede ser mayor que el precio máximo.'
      if (normalized.includes('price_min')) return 'Ingresa un precio mínimo válido.'
      if (normalized.includes('price_max')) return 'Ingresa un precio máximo válido.'
      if (normalized.includes('cursor')) return 'No pudimos cargar más resultados. Inténtalo nuevamente.'
      if (/\b404\b|no encontrado|not found/.test(normalized)) return action === 'detail' ? 'Esta ficha ya no está disponible.' : 'No encontramos fichas disponibles.'
      if (/failed to fetch|network|fetch/.test(normalized)) return action === 'detail' ? 'No pudimos abrir esta ficha. Revisa tu conexión e inténtalo otra vez.' : 'No pudimos cargar las fichas. Revisa tu conexión e inténtalo nuevamente.'
      if (message && !isTechnicalErrorMessage(message)) return message
      if (action === 'detail') return 'No pudimos abrir esta ficha. Inténtalo otra vez.'
      return 'No pudimos cargar las fichas. Inténtalo nuevamente.'
    }

    function decimalFromMinor(value) {
      return value == null ? '' : (Number(value) / 100).toFixed(2)
    }

    function filterMeta() {
      return state.meta?.filters || {}
    }

    function priceRangeMeta() {
      return filterMeta().price_range || { min_minor: null, max_minor: null, currency: 'USD' }
    }

    function filterOptions(key) {
      if (key === 'category') return [['', 'Todas'], ...(filterMeta().categories || []).map((value) => [value, value])]
      if (key === 'availability') return [['', 'Todas'], ...(filterMeta().availabilities || []).map((value) => [value, value])]
      return null
    }

    function updateSelectOptions(input, options) {
      if (!input || !options) return
      const current = input.value
      input.innerHTML = ''
      options.forEach(([value, text]) => {
        const option = document.createElement('option')
        option.value = value
        option.textContent = text
        input.appendChild(option)
      })
      input.value = options.some(([value]) => value === current) ? current : ''
    }

    function updatePriceGuidance() {
      const range = priceRangeMeta()
      const min = range.min_minor
      const max = range.max_minor
      const currency = range.currency || 'USD'
      if (inputs.price_min) inputs.price_min.placeholder = min == null ? 'Sin mínimo' : decimalFromMinor(min)
      if (inputs.price_max) inputs.price_max.placeholder = max == null ? 'Sin máximo' : decimalFromMinor(max)
      if (!priceRangeHelp) return
      if (min == null || max == null) {
        priceRangeHelp.textContent = 'Esta publicación todavía no tiene precios visibles.'
        return
      }
      priceRangeHelp.textContent = `Rango disponible: ${money(min, currency)} - ${money(max, currency)}`
    }

    function syncInputsFromState() {
      Object.entries(inputs).forEach(([key, input]) => {
        updateSelectOptions(input, filterOptions(key))
        input.value = state.filters[key] || ''
      })
      updatePriceGuidance()
    }

    function setFiltersFromInputs() {
      Object.keys(state.filters).forEach((key) => {
        state.filters[key] = inputs[key]?.value?.trim?.() || ''
      })
    }

    async function fetchCatalog({ append = false, silent = false } = {}) {
      if (append && !state.page.next_cursor) return
      state.error = ''
      if (append) state.loadingMore = true
      else state.loading = true
      if (!silent) renderPanel()

      try {
        const response = await fetch(catalogUrl({ append }))
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || !payload.success) throw new Error(payload.error || 'No pudimos cargar las fichas. Inténtalo nuevamente.')
        const incoming = Array.isArray(payload.data) ? payload.data : []
        if (append) {
          const known = new Set(state.items.map((item) => item.id))
          state.items = [...state.items, ...incoming.filter((item) => !known.has(item.id))]
        } else {
          state.items = incoming
        }
        state.page = payload.page || { has_more: false, next_cursor: null }
        state.meta = payload.meta || state.meta
        state.initialized = true
      } catch (error) {
        state.error = friendlyCatalogError(error, append ? 'more' : 'load')
        if (!append) {
          state.items = []
          state.page = { has_more: false, next_cursor: null }
        }
      } finally {
        state.loading = false
        state.loadingMore = false
        if (!silent) renderPanel()
      }
    }

    async function openMarkerFromCatalog(item) {
      state.detailLoadingId = item.id
      state.error = ''
      renderPanel()
      try {
        const response = await fetch(`${API_BASE}/view/${encodeURIComponent(slug)}/dynamic-markers/${encodeURIComponent(item.id)}`)
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || !payload.success) throw new Error(payload.error || 'No pudimos abrir esta ficha. Inténtalo otra vez.')
        showDynamicMarkerModal(payload.data)
        if (window.matchMedia('(max-width: 820px)').matches) closePanel()
      } catch (error) {
        state.error = friendlyCatalogError(error, 'detail')
      } finally {
        state.detailLoadingId = ''
        renderPanel()
      }
    }

    function renderItems() {
      if (!body) return
      body.innerHTML = ''

      if (state.loading && !state.items.length) {
        const empty = document.createElement('div')
        empty.className = 'dm-catalog-state'
        empty.textContent = 'Cargando fichas...'
        body.appendChild(empty)
        return
      }

      if (state.error) {
        const err = document.createElement('div')
        err.className = 'dm-catalog-state dm-catalog-error'
        err.textContent = state.error
        body.appendChild(err)
      }

      if (!state.items.length && !state.error) {
        const empty = document.createElement('div')
        empty.className = 'dm-catalog-state'
        empty.textContent = 'No encontramos fichas con esos filtros.'
        body.appendChild(empty)
        return
      }

      state.items.forEach((item) => {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'dm-catalog-item'
        btn.disabled = state.detailLoadingId === item.id
        btn.dataset.flipInteractive = 'true'
        btn.addEventListener('click', () => openMarkerFromCatalog(item))

        const cover = document.createElement('span')
        cover.className = 'dm-catalog-cover'
        if (item.cover_url) {
          const img = document.createElement('img')
          img.src = item.cover_url
          img.alt = ''
          cover.appendChild(img)
        } else {
          cover.textContent = 'Sin portada'
        }

        const info = document.createElement('span')
        info.className = 'dm-catalog-info'
        const top = document.createElement('span')
        top.className = 'dm-catalog-row'
        const name = document.createElement('span')
        name.className = 'dm-catalog-name'
        name.textContent = item.name || 'Ficha sin nombre'
        top.appendChild(name)
        if (item.badge_text) {
          const badge = document.createElement('span')
          badge.className = 'dm-catalog-badge'
          badge.textContent = item.badge_text
          top.appendChild(badge)
        }
        info.appendChild(top)

        const meta = document.createElement('span')
        meta.className = 'dm-catalog-meta'
        meta.textContent = [item.reference ? `Ref. ${item.reference}` : '', item.category || '', item.availability || ''].filter(Boolean).join(' · ') || 'Sin datos adicionales'
        info.appendChild(meta)

        const price = money(item.price_minor, item.currency)
        if (price) {
          const bottom = document.createElement('span')
          bottom.className = 'dm-catalog-row'
          if (price) {
            const priceNode = document.createElement('span')
            priceNode.className = 'dm-catalog-price'
            priceNode.textContent = price
            bottom.appendChild(priceNode)
          }
          info.appendChild(bottom)
        }

        btn.appendChild(cover)
        btn.appendChild(info)
        body.appendChild(btn)
      })
    }

    function renderFooter() {
      if (!footer) return
      footer.innerHTML = ''
      if (!state.page.has_more || !state.page.next_cursor) return
      const more = document.createElement('button')
      more.type = 'button'
      more.className = 'dm-catalog-more'
      more.disabled = state.loadingMore
      more.textContent = state.loadingMore ? 'Cargando fichas...' : 'Ver más resultados'
      more.addEventListener('click', () => fetchCatalog({ append: true }))
      footer.appendChild(more)
    }

    function renderSummary() {
      if (!summary) return
      const query = state.filters.q.trim()
      const count = state.items.length
      if (state.loading && !count) {
        summary.textContent = 'Buscando fichas...'
        return
      }
      if (query) {
        summary.textContent = count === 1 ? `1 resultado para "${query}"` : `${count} resultados para "${query}"`
        return
      }
      summary.textContent = count === 1 ? '1 ficha disponible' : `${count} fichas disponibles`
    }

    function renderPanel() {
      if (!overlay) return
      syncInputsFromState()
      renderSummary()
      renderItems()
      renderFooter()
    }

    function makeField(label, key, options) {
      const wrap = document.createElement('label')
      wrap.textContent = label
      const selectOptions = options || filterOptions(key)
      const input = selectOptions ? document.createElement('select') : document.createElement('input')
      if (selectOptions) {
        selectOptions.forEach(([value, text]) => {
          const option = document.createElement('option')
          option.value = value
          option.textContent = text
          input.appendChild(option)
        })
      }
      input.name = key
      input.value = state.filters[key] || ''
      if (!selectOptions) input.type = key.startsWith('price_') ? 'number' : 'text'
      if (key.startsWith('price_')) {
        input.min = '0'
        input.step = '0.01'
        input.inputMode = 'decimal'
      }
      inputs[key] = input
      wrap.appendChild(input)
      return wrap
    }

    function openPanel() {
      if (overlay) {
        closePanel()
        return
      }
      state.visible = true
      ensurePublicCatalogStyles()
      overlay = document.createElement('div')
      overlay.className = 'dm-catalog-overlay'
      overlay.dataset.flipInteractive = 'true'
      const panel = document.createElement('section')
      panel.className = 'dm-catalog-panel'
      panel.setAttribute('aria-label', 'Buscar en catálogo')

      const head = document.createElement('div')
      head.className = 'dm-catalog-head'
      const titleBox = document.createElement('div')
      const title = document.createElement('h2')
      title.className = 'dm-catalog-title'
      title.textContent = 'Buscar en catálogo'
      const copy = document.createElement('p')
      copy.className = 'dm-catalog-copy'
      copy.textContent = 'Explora fichas activas de esta publicación.'
      titleBox.appendChild(title)
      titleBox.appendChild(copy)
      const close = document.createElement('button')
      close.type = 'button'
      close.className = 'dm-catalog-close'
      close.setAttribute('aria-label', 'Cerrar catálogo')
      close.textContent = '×'
      close.addEventListener('click', closePanel)
      head.appendChild(titleBox)
      head.appendChild(close)

      const form = document.createElement('form')
      form.className = 'dm-catalog-form'
      const searchRow = document.createElement('div')
      searchRow.className = 'dm-catalog-search-row'
      const queryField = makeField('Buscar', 'q')
      queryField.classList.add('dm-catalog-query')
      inputs.q?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        setFiltersFromInputs()
        fetchCatalog()
      })
      searchRow.appendChild(queryField)
      const actions = document.createElement('div')
      actions.className = 'dm-catalog-actions'
      const search = document.createElement('button')
      search.type = 'submit'
      search.className = 'dm-catalog-search'
      search.textContent = 'Buscar'
      const clear = document.createElement('button')
      clear.type = 'button'
      clear.className = 'dm-catalog-clear'
      clear.textContent = 'Limpiar filtros'
      clear.addEventListener('click', () => {
        Object.keys(state.filters).forEach((key) => { state.filters[key] = '' })
        fetchCatalog()
      })
      actions.appendChild(search)
      actions.appendChild(clear)
      searchRow.appendChild(actions)
      form.appendChild(searchRow)
      form.appendChild(makeField('Categoría', 'category'))
      form.appendChild(makeField('Disponibilidad', 'availability'))
      form.appendChild(makeField('Precio mínimo', 'price_min'))
      form.appendChild(makeField('Precio máximo', 'price_max'))
      priceRangeHelp = document.createElement('p')
      priceRangeHelp.className = 'dm-catalog-help'
      form.appendChild(priceRangeHelp)
      form.addEventListener('submit', (event) => {
        event.preventDefault()
        setFiltersFromInputs()
        fetchCatalog()
      })

      body = document.createElement('div')
      body.className = 'dm-catalog-body'
      summary = document.createElement('p')
      summary.className = 'dm-catalog-summary'
      footer = document.createElement('div')
      footer.className = 'dm-catalog-footer'

      panel.appendChild(head)
      panel.appendChild(form)
      panel.appendChild(summary)
      panel.appendChild(body)
      panel.appendChild(footer)
      overlay.appendChild(panel)
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) closePanel()
      })
      document.body.appendChild(overlay)
      document.addEventListener('keydown', onCatalogKey)
      renderPanel()
    }

    function closePanel() {
      state.visible = false
      document.removeEventListener('keydown', onCatalogKey)
      overlay?.remove()
      overlay = null
      body = null
      footer = null
      summary = null
      priceRangeHelp = null
    }

    function onCatalogKey(event) {
      if (event.key === 'Escape') closePanel()
    }

    trigger.addEventListener('click', openPanel)

    fetchCatalog({ silent: true }).then(() => {
      if (state.items.length) {
        trigger.style.display = ''
        sep.style.display = ''
        openPanel()
      }
    })
  }

  function dynamicMarkerClipPath(obj, bounds) {
    const coords = typeof obj.getCoords === 'function' ? obj.getCoords() : null
    if (!coords || !coords.length || !bounds.width || !bounds.height) return ''
    const points = coords.map((point) => {
      const x = ((point.x - bounds.left) / bounds.width) * 100
      const y = ((point.y - bounds.top) / bounds.height) * 100
      return `${x.toFixed(2)}% ${y.toFixed(2)}%`
    })
    return `polygon(${points.join(',')})`
  }

  // Registrar vista (fire-and-forget — no bloqueamos la carga del flipbook)
  if (!isPreview) fetch(`${API_BASE}/view/${slug}/track`, { method: 'POST' }).catch(() => {})

  // ── Analítica avanzada (Fase 14): envío fire-and-forget vía sendBeacon ──
  // sendBeacon entrega los datos aunque el usuario cierre la pestaña.
  const EVENT_URL = `${API_BASE}/view/${slug}/event`
  function sendEvent(payload) {
    if (isPreview) return
    try {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
      if (navigator.sendBeacon && navigator.sendBeacon(EVENT_URL, blob)) return
    } catch (_) {}
    // Fallback si sendBeacon no está disponible
    fetch(EVENT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive: true }).catch(() => {})
  }
  // Cronómetro de permanencia por página
  let trackedPage = 1
  let pageEnterTime = Date.now()
  function flushPageTime() {
    const ms = Date.now() - pageEnterTime
    if (ms >= 500 && ms < 1000 * 60 * 30) { // ignora rebotes <0.5s y sesiones >30min
      sendEvent({ type: 'page_time', page_number: trackedPage, duration_ms: ms })
    }
  }
  function startPageTimer(pageNumber) {
    if (pageNumber === trackedPage) return
    flushPageTime()
    trackedPage = pageNumber
    pageEnterTime = Date.now()
    // Registrar que el visitante llegó a esta página (independiente del tiempo)
    sendEvent({ type: 'page_view', page_number: pageNumber })
  }
  // Al ocultar/cerrar la pestaña, mandar el tiempo de la página actual
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushPageTime() })
  window.addEventListener('pagehide', flushPageTime)

  soundEnabled = true

  const portrait = window.innerWidth < 700
  // Altura disponible = viewport - barra de controles (~64px) - padding vertical (~32px)
  const availH = window.innerHeight - 64 - 32
  let pageWidth
  if (portrait) {
    // Móvil: limitado por ancho Y por altura para que encaje justo en la pantalla
    const byW = Math.min(420, window.innerWidth - 8)
    const byH = Math.floor(availH / 1.414)
    pageWidth = Math.min(byW, byH)
  } else {
    // Escritorio: spread doble, limitado por ancho Y alto del viewport
    const byW = Math.min(1100, Math.floor(window.innerWidth * 0.95 / 2))
    const byH = Math.floor(availH / 1.414)
    pageWidth = Math.min(byW, byH)
  }
  const pageHeight = Math.floor(pageWidth * 1.414)
  const realCount = data.pages.length

  const container = document.getElementById('flipbook')

  // En escritorio agregamos páginas en blanco para que portada/contraportada
  // queden solas en su lado. En móvil (una sola página visible) NO se agregan,
  // así la portada (página real 1) es lo primero que se ve.
  const lead = portrait ? 0 : 1

  // índice 0 (solo escritorio): blank invisible → portada queda sola a la derecha
  if (!portrait) container.appendChild(makeBlank(pageWidth, pageHeight))

  // índices lead..lead+realCount-1: páginas reales
  const pageDivs = []
  data.pages.forEach((page, idx) => {
    const div = document.createElement('div')
    div.className = 'page'
    div.style.cssText = `width:${pageWidth}px;height:${pageHeight}px;overflow:hidden;background:#fff;position:relative;`
    // PROTECTED: The untransformed A4 viewport clips zoomed page content.
    // Zoom must never render outside its active page boundary.
    const pageZoomViewport = document.createElement('div')
    pageZoomViewport.className = 'page-zoom-viewport'
    pageZoomViewport.style.cssText = 'position:absolute;inset:0;overflow:hidden;clip-path:inset(0);contain:paint;isolation:isolate;'
    const pageContent = document.createElement('div')
    pageContent.className = 'page-zoom-content'
    pageContent.style.cssText = 'position:absolute;inset:0;overflow:hidden;transform-origin:top left;will-change:transform;'
    div.__pageData = page
    div.__pageBackgroundLoaded = false
    div.__zoomViewport = pageZoomViewport
    div.__zoomContent = pageContent
    // La hoja se pinta como BACKGROUND-IMAGE (no <img> con transform). Motivo: StPageFlip
    // usa transformaciones 3D (preserve-3d) para voltear, y bajo eso el overflow:hidden NO
    // recorta el transform:scale → la imagen con zoom se desbordaba. Un background siempre
    // se recorta a su caja, sin excepción 3D. El recorte/zoom se replica con
    // background-size + background-position (idéntico a computeCover del editor).
    const sheet = document.createElement('div')
    sheet.style.cssText = 'position:absolute;inset:0;overflow:hidden;background-color:#fff;background-repeat:no-repeat;background-position:center;background-size:cover;'
    div.__pageSheet = sheet
    pageContent.appendChild(sheet)
    pageDivs.push(div)
    if (page.title || page.price) {
      const label = document.createElement('div')
      label.style.cssText = 'position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.55);color:#fff;padding:6px 10px;font-size:0.75rem;display:flex;justify-content:space-between;'
      if (page.title) { const t = document.createElement('span'); t.textContent = page.title; label.appendChild(t) }
      if (page.price) { const p = document.createElement('span'); p.textContent = page.price; p.style.fontWeight = 'bold'; label.appendChild(p) }
      pageContent.appendChild(label)
    }
    pageZoomViewport.appendChild(pageContent)
    div.appendChild(pageZoomViewport)
    container.appendChild(div)
  })

  // blank final (solo escritorio): contraportada queda sola a la izquierda
  if (!portrait) container.appendChild(makeBlank(pageWidth, pageHeight))

  // Índices de página real dentro del flipbook (incluye blanks en escritorio)
  const firstIdx = lead                 // primera página real
  const lastIdx  = lead + realCount - 1 // última página real

  // Dar dimensiones explícitas al contenedor para que size:'stretch' sepa hasta dónde crecer
  container.style.width  = (portrait ? pageWidth : pageWidth * 2) + 'px'
  container.style.height = pageHeight + 'px'

  const pageFlip = new St.PageFlip(container, {
    width: pageWidth,
    height: pageHeight,
    showCover: false,
    drawShadow: true,
    maxShadowOpacity: 0.3,
    flippingTime: 900,
    mobileScrollSupport: false,
    usePortrait: portrait,
    // En móvil portrait: 'fixed' con dimensiones explícitas — evita el bug de StPageFlip v2.0.7
    // donde size:'stretch' ignora usePortrait y muestra dos páginas aunque el ancho sea de una.
    // En escritorio: 'stretch' para llenar el container doble calculado en JS.
    size: portrait ? 'fixed' : 'stretch',
  })

  pageFlip.loadFromHTML(container.querySelectorAll('.page'))
  installDesktopEdgeFlipGuard()

  // Se conserva el overlay hasta que el primer pliego tenga fondos descargados
  // y decodificados. StPageFlip necesita permanecer medible debajo del overlay.
  const loadingScreen = document.getElementById('loading-screen')

  // ── Flechas laterales de navegación (escritorio + móvil/tablet) ────────────
  // Discretas, centradas verticalmente, una a cada lado. Independientes de la barra
  // inferior. En escritorio van fuera del spread; en móvil/tablet, fijas al borde.
  {
    const baseBg = portrait ? 'rgba(0,0,0,.30)' : 'rgba(0,0,0,.45)'
    const size = portrait ? 36 : 44
    const arrowStyle = [
      portrait ? 'position:fixed' : 'position:absolute',
      'top:50%',
      'transform:translateY(-50%)',
      `width:${size}px`, `height:${size}px`,
      'border-radius:50%',
      `background:${baseBg}`,
      'border:none',
      'cursor:pointer',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'z-index:40',
      'transition:background .2s',
      'pointer-events:auto',
    ].join(';')
    const svgLeft = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`
    const svgRight = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`

    // Vincula navegación con soporte táctil: en móvil el swipe de StPageFlip se tragaba
    // el tap, así que detenemos la propagación del touch y disparamos en touchend.
    const bindNav = (btn, targetId) => {
      const go = () => document.getElementById(targetId).click()
      btn.addEventListener('click', go)
      btn.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true })
      btn.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); go() })
    }

    const btnLeft = document.createElement('button')
    btnLeft.innerHTML = svgLeft
    btnLeft.title = 'Página anterior'
    btnLeft.style.cssText = arrowStyle + (portrait ? ';left:6px' : ';left:-54px')
    bindNav(btnLeft, 'btn-prev')

    const btnRight = document.createElement('button')
    btnRight.innerHTML = svgRight
    btnRight.title = 'Página siguiente'
    btnRight.style.cssText = arrowStyle + (portrait ? ';right:6px' : ';right:-54px')
    bindNav(btnRight, 'btn-next')

    if (!portrait) {
      btnLeft.addEventListener('mouseenter', () => { btnLeft.style.background = 'rgba(0,0,0,.72)' })
      btnLeft.addEventListener('mouseleave', () => { btnLeft.style.background = baseBg })
      btnRight.addEventListener('mouseenter', () => { btnRight.style.background = 'rgba(0,0,0,.72)' })
      btnRight.addEventListener('mouseleave', () => { btnRight.style.background = baseBg })
    }

    const flipbookContainer = document.getElementById('flipbook-container')
    if (flipbookContainer.style.position !== 'relative') flipbookContainer.style.position = 'relative'
    const target = portrait ? document.body : flipbookContainer
    target.appendChild(btnLeft)
    target.appendChild(btnRight)
  }

  // ── Overlays de elementos del editor + acciones interactivas ──
  // El editor diseña a 580×820 px; aquí escalamos a la página real del viewer.
  const DESIGN_W = 580
  const DESIGN_H = Math.round(DESIGN_W * 1.414)
  const overlayScale = pageWidth / DESIGN_W

  // Registra una interacción respetando la config de seguimiento del elemento
  // ({ enabled, event, category, label }). Si enabled===false, no registra nada.
  function trackInteraction(tr, fallbackLabel, actionType, urlDest) {
    if (tr && tr.enabled === false) return
    sendEvent({
      type: 'click',
      page_number: trackedPage,
      action_type: actionType,
      label: (tr && tr.label) || fallbackLabel,
      category: (tr && tr.category) || undefined,
      event_name: (tr && tr.event) || undefined,
      url_destination: urlDest || undefined,
    })
  }

  // Toast temporal (mensaje emergente / confirmaciones). style: info|success|warning|promo
  function showToast(message, style, durationMs) {
    if (!message) return
    const colors = {
      info:    { bg: '#2563eb', fg: '#fff' },
      success: { bg: '#16a34a', fg: '#fff' },
      warning: { bg: '#f59e0b', fg: '#1f2937' },
      promo:   { bg: '#4F46E5', fg: '#fff' },
    }
    const c = colors[style] || colors.info
    const t = document.createElement('div')
    t.textContent = message
    t.style.cssText = `position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:99999;background:${c.bg};color:${c.fg};padding:12px 18px;border-radius:10px;font-family:Inter,sans-serif;font-size:14px;font-weight:600;box-shadow:0 6px 24px rgba(0,0,0,.25);max-width:90vw;text-align:center;opacity:0;transition:opacity .2s;`
    document.body.appendChild(t)
    requestAnimationFrame(() => { t.style.opacity = '1' })
    const dur = Math.max(1000, Math.min(15000, durationMs || 4000))
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 250) }, dur)
  }

  // ── Motor de animación continua (loop) de elementos del overlay ──
  // Cada objeto con data.anim.type se anima en bucle (pulse/float/spin/shake/bounce/blink),
  // sin depender de clics. Un único rAF actualiza todos y redibuja cada canvas una vez/frame.
  const animEntries = []   // { obj, fcanvas, type, speed, base }
  let animRunning = false

  // Registra los objetos animados de un canvas. Convierte su origen a 'center' para que
  // el giro/escala se hagan alrededor del centro sin desplazar el elemento.
  function registerAnimations(fcanvas) {
    fcanvas.getObjects().forEach((obj) => {
      const an = (obj.data || {}).anim
      if (!an || !an.type) return
      const ctr = obj.getCenterPoint()
      obj.set({ originX: 'center', originY: 'center', left: ctr.x, top: ctr.y })
      obj.setCoords()
      animEntries.push({
        obj, fcanvas, type: an.type, speed: Math.max(0.3, Math.min(2.5, an.speed || 1)),
        base: { sx: obj.scaleX || 1, sy: obj.scaleY || 1, angle: obj.angle || 0, left: obj.left || 0, top: obj.top || 0, opacity: obj.opacity == null ? 1 : obj.opacity },
      })
    })
    if (animEntries.length && !animRunning) { animRunning = true; requestAnimationFrame(animTick) }
  }

  function animTick(now) {
    const dirty = new Set()
    for (const e of animEntries) {
      const b = e.base
      const w = (now / 1000) * e.speed            // tiempo escalado por velocidad
      const TAU = Math.PI * 2
      switch (e.type) {
        case 'pulse': {
          const k = 1 + 0.10 * Math.sin(w * TAU / 1.2)
          e.obj.scaleX = b.sx * k; e.obj.scaleY = b.sy * k; break
        }
        case 'float':  e.obj.top  = b.top  + 8 * Math.sin(w * TAU / 2.0); break
        case 'spin':   e.obj.angle = (b.angle + (w * 120)) % 360; break
        case 'shake':  e.obj.left = b.left + 5 * Math.sin(w * TAU / 0.28); break
        case 'bounce': e.obj.top  = b.top  - 14 * Math.abs(Math.sin(w * TAU / 1.0)); break
        case 'blink':  e.obj.opacity = b.opacity * (0.35 + 0.65 * Math.abs(Math.sin(w * TAU / 1.2))); break
        default: continue
      }
      e.obj.setCoords()
      dirty.add(e.fcanvas)
    }
    dirty.forEach((fc) => fc.requestRenderAll ? fc.requestRenderAll() : fc.renderAll())
    requestAnimationFrame(animTick)
  }

  // Registro de funciones de limpieza para elementos activos de show_hide.
  // Clave: elementId del target. Valor: registro con hide() y política de cambio de página.
  const dismissCleanupMap = {}

  function getCloseOptionsForTarget(fabricTarget, domTarget) {
    const opts = fabricTarget?.data?.widget?.config?.closeOptions
      || fabricTarget?.data?.closeOptions
      || domTarget?.__widget?.config?.closeOptions
    return opts && typeof opts === 'object' ? opts : null
  }

  function setTargetVisibility(domTarget, fabricTarget, fcanvas, visible) {
    if (fabricTarget) {
      fabricTarget.visible = visible
      fcanvas.renderAll()
    }
    if (domTarget) {
      domTarget.style.visibility = visible ? 'visible' : 'hidden'
      domTarget.dataset.visible = visible ? 'true' : 'false'
    }
  }

  function isPrecisePointerDesktop() {
    return window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches === true
  }

  function isFlipInteractiveTarget(target) {
    return !!target?.closest?.([
      'button', 'a', 'input', 'select', 'textarea', 'form', 'iframe', 'audio', 'video',
      '[role="button"]', '[contenteditable="true"]', '[data-flip-interactive="true"]',
      '#controls', '#thumbnail-panel', '#share-menu',
    ].join(','))
  }

  function isPointInsideRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }

  function isPageVisiblyAtPoint(page, x, y) {
    const top = document.elementFromPoint(x, y)
    return top === page || page.contains(top)
  }

  function getVisibleSheetRects() {
    const shell = document.getElementById('flipbook-container') || container.parentElement || container
    const shellRect = shell.getBoundingClientRect()
    const sheets = Array.from(container.querySelectorAll('.page'))
      .map((page) => {
        const rect = page.getBoundingClientRect()
        return { page, rect }
      })
      .filter(({ page, rect }) => {
        if (rect.width < 20 || rect.height < 20) return false
        if (rect.right <= shellRect.left || rect.left >= shellRect.right || rect.bottom <= shellRect.top || rect.top >= shellRect.bottom) return false
        const insetX = Math.min(24, rect.width / 4)
        const insetY = Math.min(24, rect.height / 4)
        const points = [
          [rect.left + rect.width / 2, rect.top + rect.height / 2],
          [rect.left + insetX, rect.top + insetY],
          [rect.right - insetX, rect.top + insetY],
          [rect.left + insetX, rect.bottom - insetY],
          [rect.right - insetX, rect.bottom - insetY],
        ]
        return points.some(([x, y]) => isPointInsideRect(x, y, shellRect) && isPageVisiblyAtPoint(page, x, y))
      })
      .sort((a, b) => a.rect.left - b.rect.left)

    const unique = []
    sheets.forEach((sheet) => {
      const duplicate = unique.some(({ rect }) =>
        Math.abs(rect.left - sheet.rect.left) < 2
        && Math.abs(rect.top - sheet.rect.top) < 2
        && Math.abs(rect.width - sheet.rect.width) < 2
        && Math.abs(rect.height - sheet.rect.height) < 2)
      if (!duplicate) unique.push(sheet)
    })
    return unique
  }

  function getVisibleSheetLayout() {
    const sheets = getVisibleSheetRects()
    if (sheets.length >= 2) {
      const left = sheets[0].rect
      const right = sheets[sheets.length - 1].rect
      const separated = Math.abs((right.left + right.width / 2) - (left.left + left.width / 2)) > Math.min(left.width, right.width) * 0.5
      if (separated) return { mode: 'double', left, right }
    }
    if (sheets.length >= 1) return { mode: 'single', sheet: sheets[0].rect }
    return null
  }

  function getSheetActivationWidth(rect) {
    return Math.min(64, Math.max(36, rect.width * 0.08))
  }

  function getDesktopFlipEdgeZone(e) {
    const layout = getVisibleSheetLayout()
    if (!layout) return null
    const idx = pageFlip.getCurrentPageIndex()
    if (layout.mode === 'double') {
      const leftEdge = getSheetActivationWidth(layout.left)
      const rightEdge = getSheetActivationWidth(layout.right)
      if (idx > firstIdx
        && isPointInsideRect(e.clientX, e.clientY, layout.left)
        && e.clientX <= layout.left.left + leftEdge) return { direction: 'prev', rect: layout.left }
      if (idx < lastIdx
        && isPointInsideRect(e.clientX, e.clientY, layout.right)
        && e.clientX >= layout.right.right - rightEdge) return { direction: 'next', rect: layout.right }
      return null
    }

    const edge = getSheetActivationWidth(layout.sheet)
    if (!isPointInsideRect(e.clientX, e.clientY, layout.sheet)) return null
    if (idx > firstIdx && e.clientX <= layout.sheet.left + edge) return { direction: 'prev', rect: layout.sheet }
    if (idx < lastIdx && e.clientX >= layout.sheet.right - edge) return { direction: 'next', rect: layout.sheet }
    return null
  }

  function installDesktopEdgeFlipGuard() {
    const shell = document.getElementById('flipbook-container') || container.parentElement || container
    let blockPointerSequence = false
    let blockMouseSequence = false

    const block = (e) => {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation?.()
    }

    const getGestureStart = (e) => {
      if (!isPrecisePointerDesktop()) return undefined
      if (e.pointerType && e.pointerType !== 'mouse') return undefined
      if (e.button != null && e.button !== 0) return
      if (isFlipInteractiveTarget(e.target)) return undefined
      return getDesktopFlipEdgeZone(e) || false
    }

    shell.addEventListener('pointerdown', (e) => {
      const start = getGestureStart(e)
      blockPointerSequence = start === false
      if (blockPointerSequence) block(e)
    }, true)
    ;['pointermove', 'pointerup', 'click'].forEach((ev) => {
      shell.addEventListener(ev, (e) => {
        if (blockPointerSequence) block(e)
        if (ev === 'click') blockPointerSequence = false
      }, true)
    })

    shell.addEventListener('mousedown', (e) => {
      const start = getGestureStart(e)
      blockMouseSequence = start === false
      if (blockMouseSequence) block(e)
    }, true)
    ;['mousemove', 'mouseup', 'click'].forEach((ev) => {
      shell.addEventListener(ev, (e) => {
        if (blockMouseSequence) block(e)
        if (ev === 'click') blockMouseSequence = false
      }, true)
    })
  }

  function createShowHideCloseButton() {
    const xBtn = document.createElement('button')
    xBtn.type = 'button'
    xBtn.setAttribute('aria-label', 'Cerrar elemento')
    xBtn.textContent = '×'
    xBtn.style.cssText = [
      'width:32px', 'height:32px', 'border:none', 'border-radius:50%',
      'background:rgba(15,23,42,.78)', 'color:#fff', 'cursor:pointer',
      'font-size:22px', 'line-height:32px', 'font-family:Inter,sans-serif',
      'font-weight:700', 'display:flex', 'align-items:center', 'justify-content:center',
      'box-shadow:0 6px 18px rgba(0,0,0,.25)', 'padding:0', 'pointer-events:auto',
    ].join(';')
    return xBtn
  }

  function mountShowHideCloseButton(domTarget, fabricTarget, entry) {
    const wrap = fabricTarget?.__showHideWrap
    if (!domTarget && !(fabricTarget && wrap)) return null

    const xBtn = createShowHideCloseButton()
    xBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); entry.hide() })

    if (domTarget) {
      const currentPosition = window.getComputedStyle(domTarget).position
      if (!currentPosition || currentPosition === 'static') domTarget.style.position = 'relative'
      xBtn.style.cssText += ';position:absolute;top:10px;right:10px;z-index:30'
      domTarget.appendChild(xBtn)
      return xBtn
    }

    xBtn.style.cssText += ';position:absolute;z-index:20'
    wrap.appendChild(xBtn)
    positionFloatingCloseButton(xBtn, fabricTarget)
    return xBtn
  }

  function positionFloatingCloseButton(xBtn, fabricTarget) {
    if (!xBtn || !fabricTarget) return
    fabricTarget.setCoords?.()
    const r = fabricTarget.getBoundingRect(true)
    const size = 32
    const margin = 8
    const minLeft = Math.max(0, r.left)
    const maxLeft = Math.min(DESIGN_W - size, r.left + r.width - size)
    const preferredLeft = r.left + r.width - size - margin
    const minTop = Math.max(0, r.top)
    const maxTop = Math.min(DESIGN_H - size, r.top + r.height - size)
    const preferredTop = r.top + margin
    xBtn.style.left = `${Math.min(Math.max(preferredLeft, minLeft), maxLeft)}px`
    xBtn.style.top = `${Math.min(Math.max(preferredTop, minTop), maxTop)}px`
  }

  function isClickInsideFabricTarget(e, fabricTarget, fcanvas) {
    if (!fabricTarget || !fcanvas) return false
    fabricTarget.setCoords?.()
    let p = fcanvas.getPointer ? fcanvas.getPointer(e) : null
    if (!p) {
      const canvasEl = fcanvas.getElement?.()
      const rect = canvasEl?.getBoundingClientRect?.()
      if (!rect) return false
      p = {
        x: ((e.clientX - rect.left) / rect.width) * fcanvas.getWidth(),
        y: ((e.clientY - rect.top) / rect.height) * fcanvas.getHeight(),
      }
    }
    if (!p) return false
    const point = new fabric.Point(p.x, p.y)
    if (fabricTarget.containsPoint) return fabricTarget.containsPoint(point)
    const r = fabricTarget.getBoundingRect(true)
    return point.x >= r.left && point.x <= r.left + r.width && point.y >= r.top && point.y <= r.top + r.height
  }

  // Instala solo compatibilidad heredada explícita de dismissAfter.
  // Retorna la función hide() para registrarla en dismissCleanupMap.
  function installShowHideDismiss(a, domTarget, fabricTarget, fcanvas) {
    let timer = null
    const entry = { hide: null, closeOnPageChange: false }

    entry.hide = () => {
      setTargetVisibility(domTarget, fabricTarget, fcanvas, false)
      if (timer) clearTimeout(timer)
    }

    // Timer opcional: dismissAfter en segundos
    if (a.dismissAfter && Number(a.dismissAfter) > 0) {
      timer = setTimeout(() => entry.hide(), Number(a.dismissAfter) * 1000)
    }

    return entry
  }

  function installConfiguredShowHideDismiss(options, domTarget, fabricTarget, fcanvas) {
    let timer = null
    let outsideHandler = null
    let outsideDelay = null
    let xBtn = null
    const entry = { hide: null, closeOnPageChange: options.closeOnPageChange === true }

    const cleanup = () => {
      setTargetVisibility(domTarget, fabricTarget, fcanvas, false)
      if (xBtn?.parentNode) xBtn.parentNode.removeChild(xBtn)
      if (outsideDelay) { clearTimeout(outsideDelay); outsideDelay = null }
      if (outsideHandler) document.removeEventListener('click', outsideHandler, true)
      if (timer) clearTimeout(timer)
    }
    entry.hide = () => cleanup()

    if (options.showCloseButton === true) {
      xBtn = mountShowHideCloseButton(domTarget, fabricTarget, entry)
    }

    if (options.closeOnOutsideClick === true) {
      outsideHandler = (e) => {
        if (xBtn?.contains(e.target)) return
        if (domTarget && domTarget.contains(e.target)) return
        if (!domTarget && isClickInsideFabricTarget(e, fabricTarget, fcanvas)) return
        entry.hide()
      }
      outsideDelay = setTimeout(() => {
        outsideDelay = null
        document.addEventListener('click', outsideHandler, true)
      }, 160)
    }

    if (options.closeOnTimer === true && Number(options.timerSeconds) > 0) {
      timer = setTimeout(() => entry.hide(), Number(options.timerSeconds) * 1000)
    }

    return entry
  }

  function runAction(a, fcanvas, selfObj, elementDomMap) {
    if (!a || !a.type || a.type === 'none') return
    // Extraer la URL destino según el tipo de acción (para analítica)
    const urlDest = a.url || a.phone || a.email || a.whatsapp || null
    // Analítica: registrar el clic (respeta la config de seguimiento del elemento)
    trackInteraction(a.tracking, a.label || a.text || a.url || a.phone || a.email || a.type, a.type, urlDest)
    switch (a.type) {
      case 'link':
        if (a.url) window.open(a.url, a.target === '_self' ? '_self' : '_blank')
        break
      case 'page':
        if (a.page) void goToPageIndex(Number(a.page))
        break
      case 'call':
        if (a.phone) window.location.href = 'tel:' + String(a.phone).replace(/\s+/g, '')
        break
      case 'email':
        if (a.email) {
          let href = 'mailto:' + a.email
          if (a.subject) href += '?subject=' + encodeURIComponent(a.subject)
          window.location.href = href
        }
        break
      case 'popup_text': {
        const p = document.createElement('p')
        p.style.cssText = 'margin:0;color:#111;font-size:1rem;line-height:1.6;white-space:pre-wrap;'
        p.textContent = a.text || ''
        showPopup(p)
        break
      }
      case 'popup_image': {
        if (!a.image) break
        const fit = fitCss(a.image, a.fit)
        const im = document.createElement('img')
        im.src = a.image
        if (fit) {
          // Con encuadre: se muestra en un recuadro de proporción fija que "cubre".
          im.style.cssText = 'width:min(80vw,560px);height:min(60vh,420px);display:block;border-radius:8px;' + fit
        } else {
          im.style.cssText = 'max-width:80vw;max-height:80vh;display:block;border-radius:8px;'
        }
        showPopup(im)
        break
      }
      case 'whatsapp': {
        const phone = String(a.phone || '').replace(/\D/g, '')
        if (phone) window.open(`https://wa.me/${phone}?text=${encodeURIComponent(a.message || '')}`, '_blank')
        break
      }
      case 'popup_video': {
        if (!a.url) break
        const yt = (a.url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/) || [])[1]
        const vm = (a.url.match(/vimeo\.com\/(\d+)/) || [])[1]
        let src = a.url
        if (yt) src = `https://www.youtube.com/embed/${yt}?autoplay=1`
        else if (vm) src = `https://player.vimeo.com/video/${vm}?autoplay=1`
        const iframe = document.createElement('iframe')
        iframe.src = src
        iframe.style.cssText = 'width:80vw;max-width:720px;aspect-ratio:16/9;border:0;border-radius:8px;display:block;'
        iframe.allow = 'autoplay; fullscreen'
        showPopup(iframe)
        break
      }
      case 'popup_audio': {
        if (!a.url) break
        const audio = document.createElement('audio')
        audio.src = a.url
        audio.controls = true
        audio.style.cssText = 'width:80vw;max-width:480px;display:block;'
        showPopup(audio)
        // audio.load() inicia la descarga/decodificación del archivo.
        // Sin esto, .play() puede fallar porque el buffer está vacío.
        // .play() debe llamarse en el mismo hilo que el evento de clic del usuario
        // para que el navegador lo permita (autoplay policy).
        audio.load()
        audio.play().catch(() => {})
        break
      }
      case 'download': {
        if (!a.url) break
        const link = document.createElement('a')
        link.href = a.url; link.download = a.filename || ''; link.target = '_blank'
        document.body.appendChild(link); link.click(); document.body.removeChild(link)
        break
      }
      case 'show_hide': {
        if (!a.target) break
        const fabricTgt = fcanvas ? fcanvas.getObjects().find((o) => (o.data || {}).elementId === a.target) : null
        const domTgt = (elementDomMap || {})[a.target]
        const closeOptions = getCloseOptionsForTarget(fabricTgt, domTgt)
        const isVisible = domTgt ? domTgt.dataset.visible !== 'false' : (fabricTgt ? fabricTgt.visible : false)
        // Limpiar dismiss anterior para este target (si el usuario vuelve a clickear el disparador)
        const prevCleanup = dismissCleanupMap[a.target]
        if (prevCleanup) prevCleanup.hide()
        if (isVisible) {
          // Ocultar manualmente (el dismiss ya fue limpiado arriba)
          setTargetVisibility(domTgt, fabricTgt, fcanvas, false)
        } else {
          // Mostrar + instalar cierre heredado o cierre configurable del target.
          setTargetVisibility(domTgt, fabricTgt, fcanvas, true)
          const entry = closeOptions
            ? installConfiguredShowHideDismiss(closeOptions, domTgt, fabricTgt, fcanvas)
            : installShowHideDismiss(a, domTgt, fabricTgt, fcanvas)
          const rawHide = entry.hide
          entry.hide = () => {
            rawHide()
            if (dismissCleanupMap[a.target] === entry) delete dismissCleanupMap[a.target]
          }
          dismissCleanupMap[a.target] = entry
        }
        break
      }

      case 'popup_message': {
        showToast(a.message || '', a.style || 'info', (a.duration || 4) * 1000)
        break
      }

      case 'show_comment': {
        const box = document.createElement('div')
        box.style.cssText = 'max-width:80vw;width:340px;text-align:left;'
        const p = document.createElement('p')
        p.style.cssText = 'margin:0 0 10px;color:#111;font-size:1rem;line-height:1.6;white-space:pre-wrap;'
        p.textContent = a.text || ''
        box.appendChild(p)
        if (a.author || a.date) {
          const meta = document.createElement('div')
          meta.style.cssText = 'font-size:.8rem;color:#6b7280;font-weight:600;'
          meta.textContent = [a.author, a.date].filter(Boolean).join(' · ')
          box.appendChild(meta)
        }
        showPopup(box)
        break
      }

      case 'copy_text': {
        const txt = a.text || ''
        const done = () => showToast(a.confirm || '¡Copiado!', 'success', 2000)
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(done).catch(() => {})
        } else {
          const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select()
          try { document.execCommand('copy') } catch (_) {}
          ta.remove(); done()
        }
        break
      }


      case 'gallery_images': {
        const imgs = (a.images || []).filter(Boolean)
        if (!imgs.length) break
        injectGalleryStyles()
        const startIdx = imgs.indexOf(a.cover) !== -1 ? imgs.indexOf(a.cover) : 0
        showImageGallery(imgs, startIdx, a.fit)
        break
      }

      case 'gallery_videos': {
        const vids = (a.videos || []).filter(Boolean)
        if (!vids.length) break
        injectGalleryStyles()
        showVideoGallery(vids)
        break
      }
    }
  }

  function injectGalleryStyles() {
    if (document.getElementById('flipbook-gallery-styles')) return
    const st = document.createElement('style')
    st.id = 'flipbook-gallery-styles'
    st.textContent = `
      .fg-overlay { position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:2000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px; }
      .fg-close { position:fixed;top:14px;right:18px;background:none;border:none;color:#fff;font-size:28px;cursor:pointer;z-index:2001;line-height:1; }
      .fg-main { flex:1;display:flex;align-items:center;justify-content:center;width:100%;min-height:0;position:relative; }
      .fg-main img { max-width:90vw;max-height:70vh;object-fit:contain;border-radius:8px;display:block;user-select:none; }
      .fg-nav { position:absolute;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.18);border:none;color:#fff;font-size:28px;cursor:pointer;border-radius:50%;width:44px;height:44px;display:flex;align-items:center;justify-content:center;transition:background .15s; }
      .fg-nav:hover { background:rgba(255,255,255,.35); }
      .fg-nav.prev { left:8px; }
      .fg-nav.next { right:8px; }
      .fg-thumbs { display:flex;gap:8px;overflow-x:auto;padding:10px 4px;max-width:90vw; }
      .fg-thumb { width:56px;height:56px;object-fit:cover;border-radius:6px;cursor:pointer;border:2px solid transparent;flex-shrink:0;transition:border-color .15s;opacity:.65; }
      .fg-thumb.active { border-color:#818cf8;opacity:1; }
      .fg-counter { color:rgba(255,255,255,.7);font-size:13px;margin-bottom:6px; }
      .fv-grid { display:flex;flex-wrap:wrap;gap:12px;justify-content:center;max-height:70vh;overflow-y:auto;padding:4px; }
      .fv-item { width:160px;cursor:pointer;border-radius:8px;overflow:hidden;border:2px solid rgba(255,255,255,.15);transition:border-color .15s;background:#1a1a2e; }
      .fv-item:hover { border-color:#818cf8; }
      .fv-thumb { width:100%;height:90px;object-fit:cover;display:block; }
      .fv-play-wrap { width:100%;height:90px;display:flex;align-items:center;justify-content:center;font-size:36px; }
      .fv-label { color:#fff;font-size:11px;padding:5px 6px;text-overflow:ellipsis;overflow:hidden;white-space:nowrap; }
      .fv-player { position:fixed;inset:0;background:rgba(0,0,0,.95);z-index:2100;display:flex;align-items:center;justify-content:center; }
      .fv-player iframe,.fv-player video { width:90vw;max-width:780px;aspect-ratio:16/9;border:0;border-radius:8px; }
      .fv-player-close { position:fixed;top:14px;right:18px;background:none;border:none;color:#fff;font-size:28px;cursor:pointer; }
    `
    document.head.appendChild(st)
  }

  function showImageGallery(imgs, startIdx, fitMap) {
    let current = startIdx
    const overlay = document.createElement('div')
    overlay.className = 'fg-overlay'

    const closeBtn = document.createElement('button')
    closeBtn.className = 'fg-close'
    closeBtn.textContent = '✕'
    closeBtn.addEventListener('click', () => overlay.remove())
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })

    const counter = document.createElement('div')
    counter.className = 'fg-counter'

    const main = document.createElement('div')
    main.className = 'fg-main'

    const mainImg = document.createElement('img')
    main.appendChild(mainImg)

    const prevBtn = document.createElement('button')
    prevBtn.className = 'fg-nav prev'
    prevBtn.textContent = '‹'
    prevBtn.addEventListener('click', () => navigate(-1))
    main.appendChild(prevBtn)

    const nextBtn = document.createElement('button')
    nextBtn.className = 'fg-nav next'
    nextBtn.textContent = '›'
    nextBtn.addEventListener('click', () => navigate(1))
    main.appendChild(nextBtn)

    const thumbRow = document.createElement('div')
    thumbRow.className = 'fg-thumbs'
    const thumbEls = imgs.map((url, i) => {
      const t = document.createElement('img')
      t.src = url; t.className = 'fg-thumb'; t.alt = ''
      t.addEventListener('click', () => goto(i))
      thumbRow.appendChild(t)
      return t
    })

    function goto(i) {
      current = (i + imgs.length) % imgs.length
      mainImg.src = imgs[current]
      // Encuadre por imagen: si existe, la imagen "cubre" un recuadro fijo respetando
      // el zoom y centrado; si no, conserva el ajuste "contain" original (sin recorte).
      const fit = fitCss(imgs[current], fitMap)
      if (fit) {
        mainImg.style.cssText = 'width:min(90vw,720px);height:min(70vh,520px);border-radius:8px;display:block;user-select:none;' + fit
      } else {
        mainImg.style.cssText = ''
      }
      counter.textContent = `${current + 1} / ${imgs.length}`
      thumbEls.forEach((t, j) => t.classList.toggle('active', j === current))
    }

    function navigate(dir) { goto(current + dir) }

    // Touch swipe
    let touchX = 0
    overlay.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX }, { passive: true })
    overlay.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - touchX
      if (Math.abs(dx) > 40) navigate(dx < 0 ? 1 : -1)
    })

    // Escape key
    function onKey(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey) } }
    document.addEventListener('keydown', onKey)
    overlay.addEventListener('click', () => document.removeEventListener('keydown', onKey))

    overlay.appendChild(closeBtn)
    overlay.appendChild(counter)
    overlay.appendChild(main)
    overlay.appendChild(thumbRow)
    document.body.appendChild(overlay)
    goto(startIdx)
  }

  function showVideoGallery(vids) {
    const overlay = document.createElement('div')
    overlay.className = 'fg-overlay'
    overlay.style.justifyContent = 'flex-start'
    overlay.style.paddingTop = '48px'

    const closeBtn = document.createElement('button')
    closeBtn.className = 'fg-close'
    closeBtn.textContent = '✕'
    closeBtn.addEventListener('click', () => overlay.remove())
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })

    function onKey(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey) } }
    document.addEventListener('keydown', onKey)

    const grid = document.createElement('div')
    grid.className = 'fv-grid'

    vids.forEach((url) => {
      const yt = (url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/) || [])[1]
      const vm = (url.match(/vimeo\.com\/(\d+)/) || [])[1]

      const item = document.createElement('div')
      item.className = 'fv-item'

      if (yt) {
        const thumb = document.createElement('img')
        thumb.src = `https://img.youtube.com/vi/${yt}/mqdefault.jpg`
        thumb.className = 'fv-thumb'
        item.appendChild(thumb)
      } else if (vm) {
        const pw = document.createElement('div')
        pw.className = 'fv-play-wrap'
        pw.style.cssText = 'background:#1a1a2e;'
        pw.textContent = '▶'
        item.appendChild(pw)
      } else {
        const pw = document.createElement('div')
        pw.className = 'fv-play-wrap'
        pw.style.cssText = 'background:#1a1a2e;'
        pw.textContent = '🎬'
        item.appendChild(pw)
      }

      const lbl = document.createElement('div')
      lbl.className = 'fv-label'
      lbl.textContent = yt ? `YouTube` : vm ? 'Vimeo' : url.split('/').pop() || 'Video'
      item.appendChild(lbl)

      item.addEventListener('click', () => {
        const player = document.createElement('div')
        player.className = 'fv-player'
        const pclose = document.createElement('button')
        pclose.className = 'fv-player-close'
        pclose.textContent = '✕'
        pclose.addEventListener('click', () => player.remove())
        player.addEventListener('click', (e) => { if (e.target === player) player.remove() })
        let embedSrc = url
        if (yt) embedSrc = `https://www.youtube.com/embed/${yt}?autoplay=1`
        else if (vm) embedSrc = `https://player.vimeo.com/video/${vm}?autoplay=1`
        let mediaEl
        if (yt || vm) {
          mediaEl = document.createElement('iframe')
          mediaEl.src = embedSrc
          mediaEl.allow = 'autoplay; fullscreen'
        } else {
          mediaEl = document.createElement('video')
          mediaEl.src = url
          mediaEl.controls = true
          mediaEl.autoplay = true
          mediaEl.style.borderRadius = '8px'
        }
        player.appendChild(pclose)
        player.appendChild(mediaEl)
        document.body.appendChild(player)
      })

      grid.appendChild(item)
    })

    overlay.appendChild(closeBtn)
    overlay.appendChild(grid)
    document.body.appendChild(overlay)
  }

  function showPopup(node) {
    const back = document.createElement('div')
    back.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;'
    const box = document.createElement('div')
    box.style.cssText = 'background:#fff;border-radius:12px;padding:28px;max-width:90vw;max-height:90vh;overflow:auto;position:relative;box-shadow:0 20px 60px rgba(0,0,0,.4);'
    const close = document.createElement('button')
    close.textContent = '✕'
    close.style.cssText = 'position:absolute;top:8px;right:10px;border:none;background:none;font-size:20px;cursor:pointer;color:#666;'
    close.addEventListener('click', () => back.remove())
    back.addEventListener('click', (e) => { if (e.target === back) back.remove() })
    box.appendChild(close)
    box.appendChild(node)
    back.appendChild(box)
    document.body.appendChild(back)
  }

  // ── Animaciones CSS ─────────────────────────────────────────────────────
  if (!document.getElementById('flipbook-anim-styles')) {
    const st = document.createElement('style')
    st.id = 'flipbook-anim-styles'
    st.textContent = `
      @keyframes hs-pulse  { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.4);opacity:.6} }
      @keyframes hs-blink  { 0%,100%{opacity:1} 50%{opacity:0} }
      @keyframes hs-ripple { 0%{transform:scale(1);opacity:.8} 100%{transform:scale(2.2);opacity:0} }
      @keyframes pb-in-b   { from{transform:translateY(100%)} to{transform:translateY(0)} }
      @keyframes pb-in-t   { from{transform:translateY(-100%)} to{transform:translateY(0)} }
      @keyframes pb-in-c   { from{opacity:0;transform:scale(.92)} to{opacity:1;transform:scale(1)} }
      @keyframes pb-bounce { 0%{opacity:0;transform:translateY(-40px)} 60%{opacity:1;transform:translateY(12px)} 80%{transform:translateY(-6px)} 100%{transform:translateY(0)} }
      @keyframes pb-heart  { 0%{transform:scale(.9)} 25%{transform:scale(1.06)} 50%{transform:scale(.96)} 75%{transform:scale(1.03)} 100%{transform:scale(1)} }
      @keyframes pb-zoom   { from{opacity:0;transform:scale(.4)} to{opacity:1;transform:scale(1)} }
      .pb-anim-bounce    { animation: pb-bounce 0.7s ease-out }
      .pb-anim-heartbeat { animation: pb-heart 0.9s ease-in-out }
      .pb-anim-zoom      { animation: pb-zoom 0.4s ease-out }
      .hs-pulse { animation: hs-pulse  1.4s ease-in-out infinite }
      .hs-blink { animation: hs-blink  1s step-start infinite }
      .hs-ring  { animation: hs-ripple 1.4s ease-out infinite }
    `
    document.head.appendChild(st)
  }

  // ── Widgets interactivos ───────────────────────────────────────────────
  const INP_CSS = 'border:1px solid #d1d5db;border-radius:6px;padding:6px 8px;font-size:12px;font-family:Inter,sans-serif;box-sizing:border-box;width:100%;'
  function makeInput(ph, type) {
    const i = document.createElement('input')
    i.type = type || 'text'; i.placeholder = ph; i.required = true
    i.style.cssText = INP_CSS
    return i
  }
  function widgetFrame(src) {
    const f = document.createElement('iframe')
    f.src = src; f.loading = 'lazy'
    f.setAttribute('allowfullscreen', '')
    f.style.cssText = 'width:100%;height:100%;border:0;border-radius:8px;display:block;'
    return f
  }
  function centerBox() {
    const d = document.createElement('div')
    d.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;width:100%;height:100%;'
    return d
  }
  function placeholderBox(text) {
    const d = centerBox()
    d.style.cssText += 'background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;color:#94a3b8;font-size:12px;font-family:Inter,sans-serif;text-align:center;padding:8px;'
    d.textContent = text
    return d
  }
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) }
  // Encuadre por imagen elegido en el editor (zoom + centrar). fitMap = { [url]: {zoom,x,y} }.
  // Si la imagen no tiene encuadre guardado devuelve '' (conserva el comportamiento previo).
  function fitCss(url, fitMap) {
    const f = fitMap && fitMap[url]
    if (!f) return ''
    const zoom = f.zoom || 1, x = f.x == null ? 50 : f.x, y = f.y == null ? 50 : f.y
    return `object-fit:cover;object-position:${x}% ${y}%;transform:scale(${zoom});transform-origin:${x}% ${y}%;`
  }
  function ytId(u) { const m = (u || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/); return m ? m[1] : null }
  function vimeoId(u) { const m = (u || '').match(/vimeo\.com\/(\d+)/); return m ? m[1] : null }

  // Ficha de producto — tarjeta rica con galería (hasta 5 fotos), título, categoría,
  // precio, descripción, especificaciones (referencia + disponibilidad) y botones CTA
  // que responden a acciones (enlace, WhatsApp, llamar, email).
  function buildProductCard(cfg) {
    const imgs = (cfg.images || []).filter(Boolean)
    const accent = cfg.accent || '#4d7c0f'
    const primaryColor = cfg.primaryColor || '#9aab3c'

    const card = document.createElement('div')
    card.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.18);font-family:Inter,sans-serif;color:#1f2937;box-sizing:border-box;'

    // ── Sección de imagen / galería ──
    const media = document.createElement('div')
    media.style.cssText = 'position:relative;width:100%;flex:0 0 44%;min-height:110px;background:#f1f5f9;overflow:hidden;'
    if (!imgs.length) {
      media.style.cssText += 'display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:13px;'
      media.textContent = 'Sin imagen'
    } else {
      const slides = imgs.map((src, i) => {
        const im = document.createElement('div')
        // Encuadre por imagen (zoom + centrar) elegido en el editor.
        const f = (cfg.fit || {})[src] || {}
        const px = f.x == null ? 50 : f.x, py = f.y == null ? 50 : f.y, z = f.zoom || 1
        im.style.cssText = `position:absolute;inset:0;background-image:url("${src}");background-size:cover;background-position:${px}% ${py}%;background-repeat:no-repeat;transform:scale(${z});transform-origin:${px}% ${py}%;opacity:${i === 0 ? 1 : 0};transition:opacity .5s ease;`
        media.appendChild(im); return im
      })
      let cur = 0
      const dotEls = []
      const paintDots = () => dotEls.forEach((d, i) => { d.style.background = i === cur ? '#fff' : 'rgba(255,255,255,.55)' })
      const show = (n) => { cur = (n + imgs.length) % imgs.length; slides.forEach((s, i) => { s.style.opacity = i === cur ? '1' : '0' }); paintDots() }
      if (imgs.length > 1) {
        const mk = (txt, side) => {
          const b = document.createElement('button'); b.textContent = txt
          b.style.cssText = `position:absolute;${side}:6px;top:50%;transform:translateY(-50%);z-index:3;width:28px;height:28px;border-radius:50%;border:none;background:rgba(0,0,0,.4);color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;`
          return b
        }
        const bl = mk('‹', 'left'), br = mk('›', 'right')
        bl.addEventListener('click', (e) => { e.stopPropagation(); show(cur - 1) })
        br.addEventListener('click', (e) => { e.stopPropagation(); show(cur + 1) })
        media.appendChild(bl); media.appendChild(br)
        const dwrap = document.createElement('div')
        dwrap.style.cssText = 'position:absolute;bottom:8px;left:0;right:0;z-index:3;display:flex;gap:5px;justify-content:center;'
        imgs.forEach((_, i) => {
          const d = document.createElement('button')
          d.style.cssText = 'width:7px;height:7px;border-radius:50%;border:none;cursor:pointer;padding:0;'
          d.addEventListener('click', (e) => { e.stopPropagation(); show(i) })
          dwrap.appendChild(d); dotEls.push(d)
        })
        media.appendChild(dwrap); paintDots()
        if (cfg.galleryAutoplay) setInterval(() => show(cur + 1), Math.max(1, cfg.galleryInterval || 4) * 1000)
      }
    }
    card.appendChild(media)

    // ── Cuerpo ──
    const body = document.createElement('div')
    body.style.cssText = 'flex:1;overflow-y:auto;padding:18px 20px;display:flex;flex-direction:column;gap:10px;box-sizing:border-box;'

    if (cfg.title) {
      const t = document.createElement('div'); t.textContent = cfg.title
      t.style.cssText = 'font-size:18px;font-weight:800;line-height:1.25;color:#1f2937;'
      body.appendChild(t)
    }
    if (cfg.showCategory !== false && cfg.category) {
      const c = document.createElement('span'); c.textContent = cfg.category
      c.style.cssText = `align-self:flex-start;background:${accent}1a;color:${accent};font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:5px 11px;border-radius:20px;`
      body.appendChild(c)
    }
    if (cfg.showPrice !== false && cfg.price) {
      const p = document.createElement('div'); p.textContent = cfg.price
      p.style.cssText = `font-size:22px;font-weight:800;color:${accent};`
      body.appendChild(p)
    }
    if (cfg.description) {
      const d = document.createElement('div'); d.textContent = cfg.description
      d.style.cssText = `font-size:${cfg.descriptionSize || 14}px;line-height:1.55;color:#6b7280;`
      body.appendChild(d)
    }

    // ── Bloque inferior: especificaciones + CTAs siempre juntos en la parte baja ──
    const bottomWrap = document.createElement('div')
    bottomWrap.style.cssText = 'margin-top:auto;display:flex;flex-direction:column;gap:8px;'

    if (cfg.showSpecs !== false && (cfg.refValue || cfg.availValue)) {
      const specs = document.createElement('div')
      specs.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;'
      const chip = (label, val) => {
        const c = document.createElement('div')
        c.style.cssText = 'flex:1;min-width:120px;background:#f3f4f6;border-radius:10px;padding:9px 12px;font-size:12px;display:flex;align-items:center;gap:6px;'
        c.innerHTML = `<span style="color:${accent};font-weight:800;">✓</span><span style="font-weight:700;color:#374151;">${escapeHtml(label)}</span><span style="color:#6b7280;">${escapeHtml(val)}</span>`
        return c
      }
      if (cfg.refValue) specs.appendChild(chip(cfg.refLabel || 'Ref.:', cfg.refValue))
      if (cfg.availValue) specs.appendChild(chip(cfg.availLabel || 'Disponibilidad:', cfg.availValue))
      bottomWrap.appendChild(specs)
    }

    // ── Botones CTA (responden a acciones) ──
    const ctaHref = (action, val, msg) => {
      val = String(val || '').trim()
      if (action === 'whatsapp') { const ph = val.replace(/[^0-9]/g, ''); return ph ? `https://wa.me/${ph}${msg ? `?text=${encodeURIComponent(msg)}` : ''}` : null }
      if (action === 'call') return val ? `tel:${val}` : null
      if (action === 'email') return val ? `mailto:${val}` : null
      if (action === 'link') return val ? (/^https?:\/\//.test(val) ? val : `https://${val}`) : null
      return null
    }
    const mkCta = (text, bg, color, action, val, msg) => {
      const b = document.createElement('button'); b.textContent = text
      b.style.cssText = `flex:1;border:none;border-radius:10px;padding:13px 10px;font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;cursor:pointer;background:${bg};color:${color};`
      const href = ctaHref(action, val, msg)
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        trackInteraction(cfg.tracking, text, 'product_card', href || '')
        if (href) window.open(href, '_blank', 'noopener')
      })
      return b
    }
    const ctaWrap = document.createElement('div')
    ctaWrap.style.cssText = 'display:flex;gap:10px;'
    if (cfg.primaryText) ctaWrap.appendChild(mkCta(cfg.primaryText, primaryColor, '#fff', cfg.primaryAction, cfg.primaryValue, cfg.primaryMessage))
    if (cfg.showSecondary !== false && cfg.secondaryText) ctaWrap.appendChild(mkCta(cfg.secondaryText, '#eef0f3', '#4b5563', cfg.secondaryAction, cfg.secondaryValue, cfg.secondaryMessage))
    if (ctaWrap.children.length) bottomWrap.appendChild(ctaWrap)
    body.appendChild(bottomWrap)

    card.appendChild(body)
    return card
  }

  function buildContactForm(cfg) {
    const f = document.createElement('form')
    f.style.cssText = 'display:flex;flex-direction:column;gap:6px;width:100%;height:100%;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px;box-sizing:border-box;font-family:Inter,sans-serif;overflow:auto;'
    const title = document.createElement('div')
    title.textContent = cfg.title || 'Contáctanos'
    title.style.cssText = 'font-weight:700;font-size:13px;color:#111827;'
    const name = makeInput('Nombre' + (cfg.nameRequired !== false ? ' *' : ''), 'text'); name.required = cfg.nameRequired !== false
    const email = makeInput('Email' + (cfg.emailRequired !== false ? ' *' : ''), 'email'); email.required = cfg.emailRequired !== false
    const phone = makeInput('Teléfono' + (cfg.phoneRequired ? ' *' : ''), 'tel'); phone.required = !!cfg.phoneRequired
    const msg = document.createElement('textarea')
    const commentReq = cfg.commentRequired ?? false
    msg.placeholder = 'Comentario' + (commentReq ? ' *' : '')
    msg.required = !!commentReq
    msg.style.cssText = INP_CSS + 'resize:none;flex:1;min-height:34px;'
    const btn = document.createElement('button'); btn.type = 'submit'; btn.textContent = cfg.button || 'Enviar'
    btn.style.cssText = 'background:#4F46E5;color:#fff;border:none;border-radius:6px;padding:8px;font-weight:600;cursor:pointer;font-size:12px;'
    f.append(title, name, email)
    if (cfg.showPhone !== false) f.appendChild(phone)
    if (cfg.showComment !== false) f.appendChild(msg)
    f.append(btn)
    f.addEventListener('submit', (e) => {
      e.preventDefault()
      const payload = { nombre: name.value, email: email.value, telefono: phone.value, comentario: msg.value }
      // Guarda la respuesta en el repositorio del tenant
      saveResponse('contact', payload)
      // Y abre el correo si el dueño configuró un email destino
      if (cfg.toEmail) {
        const body = `Nombre: ${name.value}\nEmail: ${email.value}\nTeléfono: ${phone.value}\n\n${msg.value}`
        window.location.href = `mailto:${cfg.toEmail}?subject=${encodeURIComponent(cfg.subject || 'Contacto desde catálogo')}&body=${encodeURIComponent(body)}`
      }
      f.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#16a34a;font-weight:700;font-family:Inter,sans-serif;font-size:14px;text-align:center;padding:12px;">✓ ¡Gracias! Tu mensaje fue enviado.</div>'
    })
    return f
  }
  function buildTable(csv) {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'width:100%;height:100%;overflow:auto;border:1px solid #e5e7eb;border-radius:8px;background:#fff;'
    const tbl = document.createElement('table')
    tbl.style.cssText = 'width:100%;border-collapse:collapse;font-family:Inter,sans-serif;font-size:12px;'
    const rows = (csv || '').split('\n').filter((r) => r.trim())
    rows.forEach((row, ri) => {
      const tr = document.createElement('tr')
      row.split(',').forEach((cell) => {
        const td = document.createElement(ri === 0 ? 'th' : 'td')
        td.textContent = cell.trim()
        td.style.cssText = `border:1px solid #e5e7eb;padding:6px 8px;text-align:left;${ri === 0 ? 'background:#f3f4f6;font-weight:700;' : ''}`
        tr.appendChild(td)
      })
      tbl.appendChild(tr)
    })
    wrap.appendChild(tbl)
    return wrap
  }
  function buildLike(cfg, key) {
    const box = centerBox()
    let count = parseInt(localStorage.getItem('like_' + key) || '0', 10)
    const btn = document.createElement('button')
    btn.style.cssText = 'display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #e5e7eb;border-radius:24px;padding:8px 16px;cursor:pointer;font-family:Inter,sans-serif;font-weight:600;font-size:13px;color:#ef4444;'
    const render = () => { btn.innerHTML = `<span style="font-size:16px">♥</span> ${cfg.label || 'Me gusta'} <span style="color:#6b7280">(${count})</span>` }
    render()
    btn.addEventListener('click', () => { count++; localStorage.setItem('like_' + key, String(count)); render() })
    box.appendChild(btn)
    return box
  }

  // Botón de reproducción según el preset elegido. Compartido por audio y video.
  // Devuelve { el, setPlaying(bool) }.
  function makePlayButton(style, color, label) {
    const P = {
      circle:    { shape: 'circle', bg: color,        fg: '#fff',    icon: '▶' },
      outline:   { shape: 'circle', bg: 'transparent', fg: color,    icon: '▶', border: `3px solid ${color}` },
      noteDark:  { shape: 'circle', bg: '#1f2937',    fg: '#fff',    icon: '🎵' },
      noteLight: { shape: 'circle', bg: '#ffffff',    fg: '#111827', icon: '🎵', border: '1px solid #e5e7eb' },
      square:    { shape: 'square', bg: '#111827',    fg: '#fff',    icon: '🎵' },
      gradient:  { shape: 'circle', bg: `linear-gradient(135deg, ${color}, #a855f7)`, fg: '#fff', icon: '🎵' },
      minimal:   { shape: 'none',   bg: 'transparent', fg: color,    icon: '▶' },
      pill:      { shape: 'pill',   bg: color,        fg: '#fff',    icon: '▶' },
    }
    const p = P[style] || P.circle
    const el = document.createElement('button')
    let playing = false
    if (p.shape === 'pill') {
      el.style.cssText = `display:inline-flex;align-items:center;gap:8px;background:${color};color:#fff;border:none;border-radius:999px;cursor:pointer;font-family:Inter,sans-serif;font-weight:700;font-size:16px;padding:12px 22px;box-shadow:0 6px 18px ${color}55;`
      const paint = () => { el.innerHTML = `<span>${playing ? '⏸' : '▶'}</span>${label ? `<span style="font-size:14px">${label}</span>` : ''}` }
      paint()
      return { el, setPlaying(v) { playing = v; paint() } }
    }
    const radius = p.shape === 'square' ? '16px' : '50%'
    const dim = p.shape === 'none' ? 'auto' : 'min(72%,86px)'
    const shadow = (p.shape === 'none' || p.bg === 'transparent') ? 'none' : `0 6px 18px ${color}55`
    el.style.cssText = `display:flex;align-items:center;justify-content:center;background:${p.bg};color:${p.fg};border:${p.border || 'none'};border-radius:${radius};cursor:pointer;font-family:Inter,sans-serif;font-weight:700;font-size:${p.shape === 'none' ? '44px' : '30px'};width:${dim};height:${dim};aspect-ratio:${p.shape === 'none' ? 'auto' : '1/1'};box-shadow:${shadow};transition:transform .12s;`
    const paint = () => { el.textContent = playing ? '⏸' : p.icon }
    paint()
    el.addEventListener('mousedown', () => { el.style.transform = 'scale(.94)' })
    el.addEventListener('mouseup', () => { el.style.transform = 'scale(1)' })
    el.addEventListener('mouseleave', () => { el.style.transform = 'scale(1)' })
    return { el, setPlaying(v) { playing = v; paint() } }
  }

  function buildWidget(widget, w, h, key, ctx, pageIndex) {
    const cfg = widget.config || {}
    switch (widget.type) {
      case 'map': {
        // Mapa interactivo con OpenStreetMap (zoom/mover, gratis y SIN API key).
        // Se geocodifica la dirección con Nominatim y se cachea en localStorage.
        const addr = (cfg.address || '').trim()
        if (!addr && !(cfg.lat && cfg.lon)) return placeholderBox('Mapa (sin dirección)')
        const zoom = parseInt(cfg.zoom || 14, 10)
        const box = document.createElement('div')
        box.style.cssText = 'position:relative;width:100%;height:100%;border-radius:8px;overflow:hidden;background:#e8edf0;'
        const renderOSM = (lat, lon) => {
          const d = Math.max(0.004, 0.08 * Math.pow(2, 13 - zoom))   // medio-ancho del bbox según zoom
          const bbox = `${lon - d},${lat - d * 0.6},${lon + d},${lat + d * 0.6}`
          const f = document.createElement('iframe')
          f.src = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat},${lon}`
          f.loading = 'lazy'
          f.style.cssText = 'width:100%;height:100%;border:0;display:block;'
          box.insertBefore(f, box.firstChild)
        }
        if (cfg.lat && cfg.lon) {
          renderOSM(parseFloat(cfg.lat), parseFloat(cfg.lon))
        } else {
          const ck = 'geo_' + addr.toLowerCase()
          let cached = null
          try { cached = localStorage.getItem(ck) } catch (e) {}
          if (cached) { const [la, lo] = cached.split(','); renderOSM(parseFloat(la), parseFloat(lo)) }
          else {
            fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(addr)}`, { headers: { Accept: 'application/json' } })
              .then((r) => r.json())
              .then((arr) => {
                if (arr && arr[0]) {
                  const la = parseFloat(arr[0].lat), lo = parseFloat(arr[0].lon)
                  try { localStorage.setItem(ck, la + ',' + lo) } catch (e) {}
                  renderOSM(la, lo)
                } else { box.appendChild(placeholderBox('No se encontró la dirección')) }
              })
              .catch(() => { box.appendChild(placeholderBox('Mapa no disponible')) })
          }
        }
        // Botón "Abrir en mapa grande" (rastreable) — abre la app de mapas del usuario.
        if (cfg.openInApp !== false) {
          const openUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr || (cfg.lat + ',' + cfg.lon))}`
          const btn = document.createElement('a')
          btn.href = openUrl; btn.target = '_blank'; btn.rel = 'noopener'
          btn.textContent = '📍 Abrir en mapa'
          btn.style.cssText = 'position:absolute;left:8px;bottom:8px;z-index:2;background:rgba(255,255,255,.95);color:#1f2937;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:600;text-decoration:none;font-family:Inter,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.2);'
          btn.addEventListener('click', (e) => { e.stopPropagation(); trackInteraction(cfg.tracking, addr || 'Mapa', 'map_open', openUrl) })
          box.appendChild(btn)
        }
        return box
      }
      case 'video': {
        const yt = ytId(cfg.url), vm = vimeoId(cfg.url)
        const params = []
        if (cfg.autoplay) params.push('autoplay=1')
        if (!cfg.controls && cfg.controls !== undefined) params.push('controls=0')
        if (cfg.muted) params.push('mute=1')
        if (cfg.loop) params.push('loop=1')
        const qs = params.length ? '?' + params.join('&') : ''
        if (yt) return widgetFrame(`https://www.youtube.com/embed/${yt}${qs}`)
        if (vm) return widgetFrame(`https://player.vimeo.com/video/${vm}${qs}`)
        if (cfg.url) {
          const style = cfg.playerStyle || 'native'
          // Modo nativo: controles del navegador (comportamiento previo)
          if (style === 'native' || cfg.autoplay) {
            const v = document.createElement('video')
            v.src = cfg.url; v.controls = cfg.controls !== false; v.muted = !!cfg.muted
            v.autoplay = !!cfg.autoplay; v.loop = !!cfg.loop
            if (cfg.poster) v.poster = cfg.poster
            v.style.cssText = 'width:100%;height:100%;border-radius:8px;background:#000;'
            return v
          }
          // Botón disparador (preset): muestra el video con un botón de play encima;
          // al tocarlo reproduce y muestra los controles.
          const box = centerBox()
          box.style.cssText += 'position:relative;background:#000;border-radius:8px;overflow:hidden;'
          const v = document.createElement('video')
          v.src = cfg.url; v.playsInline = true; v.muted = !!cfg.muted; v.loop = !!cfg.loop
          if (cfg.poster) v.poster = cfg.poster
          v.style.cssText = 'width:100%;height:100%;object-fit:cover;background:#000;'
          const overlay = document.createElement('div')
          overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(0,0,0,.15);'
          const pb = makePlayButton(style, cfg.playerColor || '#ef4444', '')
          overlay.appendChild(pb.el)
          const play = () => { v.controls = true; v.play().catch(() => {}); overlay.style.display = 'none'; trackInteraction(cfg.tracking, 'Video', 'video', cfg.url) }
          overlay.addEventListener('click', play)
          box.appendChild(v); box.appendChild(overlay)
          return box
        }
        return placeholderBox('Video (sin URL)')
      }
      case 'audio': {
        if (!cfg.url) return placeholderBox('Audio (sin URL)')
        const color = cfg.playerColor || '#7c3aed'
        // playerStyle: preset elegido en la biblioteca. Compat con campos viejos
        // (cfg.style 'bar' / cfg.btnShape 'pill').
        let style = cfg.playerStyle
        if (!style) style = cfg.style === 'bar' ? 'bar' : (cfg.btnShape === 'pill' ? 'pill' : 'circle')
        const audioEl = document.createElement('audio')
        audioEl.src = cfg.url
        if (cfg.loop) audioEl.loop = true
        // Barra nativa
        if (style === 'bar' || style === 'native') {
          const box = centerBox()
          box.style.cssText += `background:${color}18;border-radius:12px;`
          audioEl.controls = true
          if (cfg.autoplay) audioEl.autoplay = true
          audioEl.style.cssText = 'width:90%;accent-color:' + color
          box.appendChild(audioEl)
          return box
        }
        // Botón disparador (preset de la biblioteca)
        const box = centerBox()
        const pb = makePlayButton(style, color, cfg.label || '')
        pb.el.addEventListener('click', () => {
          if (audioEl.paused) { audioEl.play().catch(() => {}); trackInteraction(cfg.tracking, cfg.label || 'Audio', 'audio', cfg.url) }
          else audioEl.pause()
          pb.setPlaying(!audioEl.paused)
        })
        audioEl.addEventListener('ended', () => pb.setPlaying(false))
        box.appendChild(pb.el); box.appendChild(audioEl)
        if (cfg.autoplay) { audioEl.autoplay = true; audioEl.play().then(() => pb.setPlaying(true)).catch(() => {}) }
        return box
      }
      case 'whatsapp': {
        const phone = String(cfg.phone || '').replace(/\D/g, '')
        const a = document.createElement('a')
        a.href = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(cfg.message || '')}` : 'javascript:void(0)'
        a.target = '_blank'
        const bg = cfg.color || '#25D366'
        a.style.cssText = `display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:100%;background:${bg};color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;font-family:Inter,sans-serif;`
        a.innerHTML = `<span style="font-size:18px">✆</span> ${cfg.label || 'WhatsApp'}`
        a.addEventListener('click', () => trackInteraction(cfg.tracking, cfg.label || 'WhatsApp', 'whatsapp', a.href))
        return a
      }
      case 'qr': {
        const dataStr = cfg.data || location.href
        const sz = Math.max(80, Math.round(Math.min(w, h)))
        const box = centerBox()
        const img = document.createElement('img')
        img.src = `https://api.qrserver.com/v1/create-qr-code/?size=${sz}x${sz}&data=${encodeURIComponent(dataStr)}`
        img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;'
        box.appendChild(img)
        if (cfg.caption) { const c = document.createElement('div'); c.textContent = cfg.caption; c.style.cssText = 'font-size:11px;color:#374151;font-family:Inter,sans-serif;'; box.appendChild(c) }
        return box
      }
      case 'barcode': {
        const fmt = cfg.format || 'code128'
        const val = String(cfg.value || '123456789012')
        const box = centerBox()
        box.style.cssText += 'background:#fff;border-radius:8px;'
        const img = document.createElement('img')
        img.src = `https://barcodeapi.org/api/${encodeURIComponent(fmt)}/${encodeURIComponent(val)}`
        img.alt = 'Código de barras'
        img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;'
        box.appendChild(img)
        return box
      }
      case 'social': {
        const NETS = {
          instagram: { slug: 'instagram', color: 'E4405F', tpl: 'https://instagram.com/{v}' },
          facebook:  { slug: 'facebook',  color: '0866FF', tpl: 'https://facebook.com/{v}' },
          tiktok:    { slug: 'tiktok',    color: '000000', tpl: 'https://tiktok.com/@{v}' },
          youtube:   { slug: 'youtube',   color: 'FF0000', tpl: 'https://youtube.com/@{v}' },
          x:         { slug: 'x',         color: '000000', tpl: 'https://x.com/{v}' },
          telegram:  { slug: 'telegram',  color: '26A5E4', tpl: 'https://t.me/{v}' },
          linkedin:  { slug: 'linkedin',  color: '0A66C2', tpl: 'https://linkedin.com/in/{v}' },
          pinterest: { slug: 'pinterest', color: 'BD081C', tpl: 'https://pinterest.com/{v}' },
        }
        const n = NETS[cfg.network] || NETS.instagram
        const val = String(cfg.value || '').trim()
        const href = !val ? 'javascript:void(0)' : (/^https?:\/\//.test(val) ? val : n.tpl.replace('{v}', encodeURIComponent(val.replace(/^@/, ''))))
        const a = document.createElement('a')
        a.href = href; a.target = '_blank'; a.rel = 'noopener'
        a.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%;'
        const img = document.createElement('img')
        img.src = `https://api.iconify.design/simple-icons:${n.slug}.svg?color=%23${n.color}&width=240&height=240`
        img.alt = cfg.network || 'red social'
        img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;'
        a.appendChild(img)
        a.addEventListener('click', () => trackInteraction(cfg.tracking, cfg.network || 'social', 'social', href))
        return a
      }
      case 'gallery': {
        const imgs = (cfg.images || []).filter(Boolean)
        if (!imgs.length) return placeholderBox('Galería (sin imágenes)')
        const transition = cfg.transition || 'fade'
        const box = document.createElement('div')
        box.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;border-radius:8px;background:#0f172a;'
        // Encuadre por imagen (zoom + centrar) elegido en el editor: { [src]: {zoom,x,y} }.
        const fits = imgs.map((src) => { const f = (cfg.fit || {})[src] || {}; return { x: f.x == null ? 50 : f.x, y: f.y == null ? 50 : f.y, z: f.zoom || 1 } })
        const slides = imgs.map((src, i) => {
          const im = document.createElement('div')
          const ft = fits[i]
          im.style.cssText = `position:absolute;inset:0;background-image:url("${src}");background-size:cover;background-position:${ft.x}% ${ft.y}%;background-repeat:no-repeat;transform-origin:${ft.x}% ${ft.y}%;`
          box.appendChild(im); return im
        })
        let cur = 0
        const dotEls = []
        const paintDots = () => dotEls.forEach((d, i) => { d.style.background = i === cur ? '#fff' : 'rgba(255,255,255,.5)' })
        const layout = (animate) => {
          slides.forEach((s, i) => {
            s.style.transition = animate ? 'opacity .5s ease, transform .5s ease' : 'none'
            const z = fits[i].z // zoom de encuadre, se compone con la transición
            if (transition === 'slide') { s.style.transform = `translateX(${(i - cur) * 100}%) scale(${z})`; s.style.opacity = '1' }
            else if (transition === 'zoom') { s.style.opacity = i === cur ? '1' : '0'; s.style.transform = i === cur ? `scale(${z})` : `scale(${z * 1.08})` }
            else { s.style.opacity = i === cur ? '1' : '0'; s.style.transform = `scale(${z})` }
          })
        }
        layout(false)
        let timer = null
        const restart = () => {
          if (timer) clearInterval(timer)
          if (cfg.autoplay !== false && imgs.length > 1) timer = setInterval(() => go(cur + 1), Math.max(1, cfg.interval || 4) * 1000)
        }
        const go = (n) => { cur = (n + imgs.length) % imgs.length; layout(true); paintDots() }
        if (cfg.arrows !== false && imgs.length > 1) {
          const mk = (txt, side) => {
            const b = document.createElement('button')
            b.textContent = txt
            b.style.cssText = `position:absolute;${side}:8px;top:50%;transform:translateY(-50%);z-index:3;width:32px;height:32px;border-radius:50%;border:none;background:rgba(0,0,0,.45);color:#fff;font-size:20px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;`
            return b
          }
          const bl = mk('‹', 'left'), br = mk('›', 'right')
          bl.addEventListener('click', (e) => { e.stopPropagation(); go(cur - 1); restart() })
          br.addEventListener('click', (e) => { e.stopPropagation(); go(cur + 1); restart() })
          box.appendChild(bl); box.appendChild(br)
        }
        if (cfg.dots !== false && imgs.length > 1) {
          const dwrap = document.createElement('div')
          dwrap.style.cssText = 'position:absolute;bottom:8px;left:0;right:0;z-index:3;display:flex;gap:6px;justify-content:center;'
          imgs.forEach((_, i) => {
            const d = document.createElement('button')
            d.style.cssText = 'width:8px;height:8px;border-radius:50%;border:none;cursor:pointer;padding:0;background:rgba(255,255,255,.5);'
            d.addEventListener('click', (e) => { e.stopPropagation(); go(i); restart() })
            dwrap.appendChild(d); dotEls.push(d)
          })
          box.appendChild(dwrap)
        }
        paintDots()
        restart()
        let sx = null
        box.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX }, { passive: true })
        box.addEventListener('touchend', (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 40) { go(dx < 0 ? cur + 1 : cur - 1); restart() } sx = null })
        return box
      }
      case 'product_card': return buildProductCard(cfg)
      case 'contact': return buildContactForm(cfg)
      case 'table': return buildTable(cfg.csv || '')
      case 'like': return buildLike(cfg, key)
      case 'download': {
        if (!cfg.url) return placeholderBox('Descarga (sin archivo)')
        const box = centerBox()
        box.style.cssText += 'background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:10px;box-sizing:border-box;'
        if (cfg.title) { const t = document.createElement('div'); t.textContent = cfg.title; t.style.cssText = 'font-size:13px;font-weight:700;color:#111827;font-family:Inter,sans-serif;text-align:center;'; box.appendChild(t) }
        const a = document.createElement('a')
        a.href = cfg.url; a.download = cfg.filename || ''; a.target = '_blank'
        a.style.cssText = `display:inline-flex;align-items:center;gap:6px;background:${cfg.buttonColor || '#4F46E5'};color:#fff;border-radius:8px;padding:9px 18px;font-weight:700;font-size:13px;text-decoration:none;font-family:Inter,sans-serif;`
        a.innerHTML = `<span style="font-size:16px">⬇</span> ${cfg.button || 'Descargar'}`
        box.appendChild(a)
        return box
      }
      case 'embed': {
        if (!cfg.html) return placeholderBox('Incrustar (sin código)')
        const wrap = document.createElement('div')
        wrap.style.cssText = 'width:100%;height:100%;overflow:auto;border-radius:8px;'
        wrap.innerHTML = cfg.html
        return wrap
      }
      case 'quiz': {
        const questions = cfg.questions || []
        if (!questions.length) return placeholderBox('Cuestionario (sin preguntas)')
        const wrap = document.createElement('div')
        wrap.style.cssText = 'width:100%;height:100%;overflow:auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px;box-sizing:border-box;font-family:Inter,sans-serif;display:flex;flex-direction:column;gap:10px;'
        const ttl = document.createElement('div')
        ttl.textContent = cfg.title || 'Cuestionario'
        ttl.style.cssText = 'font-weight:700;font-size:13px;color:#111827;'
        wrap.appendChild(ttl)
        const answers = {}
        questions.forEach((q, qi) => {
          const qWrap = document.createElement('div')
          qWrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;'
          const qLabel = document.createElement('div')
          qLabel.textContent = `${qi + 1}. ${q.text ?? q.question ?? ''}`
          qLabel.style.cssText = 'font-size:12px;font-weight:600;color:#374151;'
          qWrap.appendChild(qLabel)
          ;(q.options || []).forEach((opt, oi) => {
            const row = document.createElement('label')
            row.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;color:#374151;cursor:pointer;'
            const inp = document.createElement('input')
            inp.type = (q.type === 'multi' || q.multiple) ? 'checkbox' : 'radio'
            inp.name = `q${qi}`; inp.value = String(oi)
            inp.addEventListener('change', () => { answers[qi] = oi })
            row.appendChild(inp)
            row.appendChild(document.createTextNode(opt))
            qWrap.appendChild(row)
          })
          wrap.appendChild(qWrap)
        })
        const btn = document.createElement('button')
        btn.textContent = 'Enviar'
        btn.style.cssText = 'background:#4F46E5;color:#fff;border:none;border-radius:6px;padding:8px;font-weight:600;cursor:pointer;font-size:12px;margin-top:auto;'
        btn.addEventListener('click', () => {
          localStorage.setItem(`quiz_${key}`, JSON.stringify(answers))
          // Construye un resumen legible: pregunta → opción elegida
          const summary = questions.map((q, qi) => {
            const oi = answers[qi]
            const chosen = oi !== undefined ? (q.options || [])[oi] : '(sin responder)'
            return { pregunta: q.text ?? q.question ?? `Pregunta ${qi + 1}`, respuesta: chosen }
          })
          saveResponse('quiz', { titulo: cfg.title || 'Cuestionario', respuestas: summary }, key)
          btn.textContent = '✓ Respuestas guardadas'
          btn.disabled = true
        })
        wrap.appendChild(btn)
        return wrap
      }
      case 'popup_banner': {
        // El banner se registra y se muestra después del delay. Si la posición es
        // "custom" se ancla al cuadro del widget (ctx) en vez de a un lateral fijo.
        scheduleBanner(cfg, key, ctx, pageIndex)
        return null
      }
      case 'units_table': {
        // Tabla de unidades inmobiliarias — carga datos desde el endpoint público /view/units
        const wrap = document.createElement('div')
        wrap.style.cssText = 'width:100%;height:100%;overflow-y:auto;background:rgba(15,23,42,0.92);border-radius:10px;padding:10px;box-sizing:border-box;font-family:Inter,sans-serif;color:#fff;'

        const filterStatus = widget.filter_status || cfg.filter_status || 'all'
        const showPrice    = widget.show_price    !== undefined ? widget.show_price    : (cfg.show_price    !== false)
        const showArea     = widget.show_area     !== undefined ? widget.show_area     : (cfg.show_area     !== false)
        const pubId        = widget.publication_id || cfg.publication_id || ''

        if (!pubId) { wrap.appendChild(placeholderBox('Tabla de Unidades (sin publication_id)')); return wrap }

        // Título de la tabla
        const ttl = document.createElement('div')
        ttl.textContent = 'Unidades'
        ttl.style.cssText = 'font-weight:700;font-size:13px;margin-bottom:8px;color:#e2e8f0;border-bottom:1px solid rgba(255,255,255,.15);padding-bottom:6px;'
        wrap.appendChild(ttl)

        // Spinner mientras carga
        const spinner = document.createElement('div')
        spinner.textContent = 'Cargando…'
        spinner.style.cssText = 'font-size:12px;color:#94a3b8;text-align:center;padding:12px 0;'
        wrap.appendChild(spinner)

        // Fetch al endpoint público de unidades
        fetch(`${API_BASE}/view/units?publication_id=${encodeURIComponent(pubId)}`)
          .then((r) => r.json())
          .then(({ data }) => {
            spinner.remove()
            let units = Array.isArray(data) ? data : []
            if (filterStatus !== 'all') units = units.filter((u) => u.status === filterStatus)

            if (!units.length) {
              const empty = document.createElement('div')
              empty.textContent = 'No hay unidades disponibles.'
              empty.style.cssText = 'font-size:12px;color:#94a3b8;text-align:center;padding:16px 0;'
              wrap.appendChild(empty)
              return
            }

            const STATUS_COLOR = { available: '#16a34a', reserved: '#ca8a04', sold: '#dc2626' }
            const STATUS_LABEL = { available: 'Disponible', reserved: 'Reservada', sold: 'Vendida' }

            const tbl = document.createElement('table')
            tbl.style.cssText = 'width:100%;border-collapse:collapse;font-size:11px;'

            // Encabezado
            const thead = document.createElement('thead')
            const hrow = document.createElement('tr')
            const cols = ['Unidad', 'Piso', ...(showArea ? ['m²'] : []), 'Dorm.', ...(showPrice ? ['Precio'] : []), 'Estado']
            cols.forEach((col) => {
              const th = document.createElement('th')
              th.textContent = col
              th.style.cssText = 'padding:5px 6px;text-align:left;color:#94a3b8;font-weight:600;border-bottom:1px solid rgba(255,255,255,.12);white-space:nowrap;'
              hrow.appendChild(th)
            })
            thead.appendChild(hrow)
            tbl.appendChild(thead)

            // Filas de datos
            const tbody = document.createElement('tbody')
            units.forEach((u) => {
              const tr = document.createElement('tr')
              const tdStyle = 'padding:5px 6px;border-bottom:1px solid rgba(255,255,255,.07);white-space:nowrap;'

              const cells = [
                u.name || u.unit_number || '—',
                u.floor != null ? u.floor : '—',
                ...(showArea ? [u.area_m2 != null ? u.area_m2 : '—'] : []),
                u.bedrooms != null ? u.bedrooms : '—',
                ...(showPrice ? [u.price != null ? `$${Number(u.price).toLocaleString()}` : '—'] : []),
              ]
              cells.forEach((val) => {
                const td = document.createElement('td')
                td.textContent = String(val)
                td.style.cssText = tdStyle
                tr.appendChild(td)
              })

              // Badge de estado
              const tdStatus = document.createElement('td')
              tdStatus.style.cssText = tdStyle
              const badge = document.createElement('span')
              const color = STATUS_COLOR[u.status] || '#64748b'
              badge.textContent = STATUS_LABEL[u.status] || u.status || '—'
              badge.style.cssText = `display:inline-block;background:${color};color:#fff;border-radius:4px;padding:2px 6px;font-size:10px;font-weight:600;`
              tdStatus.appendChild(badge)
              tr.appendChild(tdStatus)

              tbody.appendChild(tr)
            })
            tbl.appendChild(tbody)
            wrap.appendChild(tbl)
          })
          .catch(() => {
            spinner.textContent = 'No pudimos cargar las unidades. Inténtalo nuevamente.'
          })

        return wrap
      }
      default: return placeholderBox(widget.type)
    }
  }

  // ── Banner popup emergente (cintillo) ──────────────────────────────────────
  const shownBanners = new Set()
  // Banners con alcance "page": {key, cfg, ctx, pageIndex, delay}
  const pendingPageBanners = []

  function scheduleBanner(cfg, key, ctx, pageIndex) {
    if (shownBanners.has(key)) return
    const delay = cfg.trigger === 'immediate' ? 0 : (parseInt(cfg.delay || '3', 10) * 1000)
    // timer_scope:'page' → esperar a que el lector llegue a ESA página
    if (cfg.timer_scope === 'page' && pageIndex != null) {
      pendingPageBanners.push({ key, cfg, ctx, pageIndex, delay })
      return
    }
    // timer_scope:'global' (o sin valor) → countdown desde que abre el flipbook
    shownBanners.add(key)
    setTimeout(() => showBanner(cfg, ctx), delay)
  }

  // Llamado desde onFlipChange: dispara los banners pendientes de la página activa.
  function firePendingBannersForPage(activePageIndex) {
    for (let i = pendingPageBanners.length - 1; i >= 0; i--) {
      const pb = pendingPageBanners[i]
      // Comparamos por pageIndex del canvas (puede ser par o impar según StPageFlip)
      if (pb.pageIndex === activePageIndex || pb.pageIndex === activePageIndex + 1) {
        if (!shownBanners.has(pb.key)) {
          shownBanners.add(pb.key)
          const captured = pb
          setTimeout(() => showBanner(captured.cfg, captured.ctx), captured.delay)
        }
        pendingPageBanners.splice(i, 1)
      }
    }
  }

  // Pop-up anclado al cuadro del widget (posición "personalizado"): aparece justo
  // donde el usuario colocó la zona, dentro del overlay de la página.
  function showBannerCustom(cfg, ctx) {
    const r = ctx.rect
    const bg = cfg.bgColor || '#1a1827'
    const tc = cfg.textColor || '#fff'
    const btnBg = cfg.buttonColor || '#4F46E5'
    const holder = document.createElement('div')
    const width = Math.max(r.width, 240)
    holder.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${width}px;z-index:9;pointer-events:auto;opacity:0;transform:scale(.92);transition:opacity .25s ease,transform .25s ease;`
    const card = document.createElement('div')
    card.style.cssText = `position:relative;background:${bg};color:${tc};border-radius:14px;box-shadow:0 14px 44px rgba(0,0,0,.32);overflow:hidden;font-family:Inter,sans-serif;`
    if (cfg.image) {
      const img = document.createElement('img')
      img.src = cfg.image
      img.style.cssText = `width:100%;max-height:140px;object-fit:cover;object-position:${cfg.imagePosX ?? 50}% ${cfg.imagePosY ?? 50}%;transform:scale(${cfg.imageZoom || 1});`
      card.appendChild(img)
    }
    const body = document.createElement('div')
    body.style.cssText = 'padding:14px 16px;'
    if (cfg.title) { const t = document.createElement('div'); t.textContent = cfg.title; t.style.cssText = 'font-weight:800;font-size:16px;margin-bottom:6px;'; body.appendChild(t) }
    if (cfg.text)  { const t = document.createElement('div'); t.textContent = cfg.text;  t.style.cssText = 'font-size:13px;opacity:.92;line-height:1.4;'; body.appendChild(t) }
    if (cfg.buttonText) {
      const btn = document.createElement('button')
      btn.textContent = cfg.buttonText
      btn.style.cssText = `margin-top:12px;background:${btnBg};color:#fff;border:none;border-radius:9px;padding:9px 16px;font-weight:700;font-size:13px;cursor:pointer;font-family:Inter,sans-serif;`
      if (cfg.buttonUrl) btn.addEventListener('click', () => window.open(cfg.buttonUrl, '_blank'))
      body.appendChild(btn)
    }
    card.appendChild(body)
    const close = document.createElement('button')
    close.textContent = '✕'
    close.style.cssText = `position:absolute;top:6px;right:8px;background:rgba(0,0,0,.25);color:#fff;border:none;border-radius:50%;width:24px;height:24px;cursor:pointer;font-size:13px;line-height:1;`
    close.addEventListener('click', () => holder.remove())
    card.appendChild(close)
    holder.appendChild(card)
    ;['mousedown', 'touchstart', 'pointerdown'].forEach((ev) => holder.addEventListener(ev, (e) => e.stopPropagation(), { passive: true }))
    ctx.wrap.appendChild(holder)
    requestAnimationFrame(() => { holder.style.opacity = '1'; holder.style.transform = 'scale(1)' })
    const autoClose = parseInt(cfg.autoClose ?? cfg.autoDismiss ?? 0, 10)
    if (autoClose > 0) setTimeout(() => holder.remove(), autoClose * 1000)
  }

  function showBanner(cfg, ctx) {
    if (cfg.position === 'custom' && ctx && ctx.wrap && ctx.rect) { showBannerCustom(cfg, ctx); return }
    if (document.getElementById('flipbook-banner')) return

    const side = cfg.position === 'right' ? 'right' : 'left'
    const bg   = cfg.bgColor    || '#1a1827'
    const tc   = cfg.textColor  || '#fff'
    const btnBg = cfg.buttonColor || '#4F46E5'
    const hasImg = !!cfg.image

    // Animación de entrada: la tarjeta llega deslizando desde el lateral
    const animClass = { bounce: 'pb-anim-bounce', heartbeat: 'pb-anim-heartbeat', zoom: 'pb-anim-zoom' }[cfg.animation] || ''

    const outer = document.createElement('div')
    outer.id = 'flipbook-banner'
    outer.className = `side-${side}${animClass ? ' ' + animClass : ''}`

    // ── Tarjeta (imagen 25 % + texto 75 %) ──────────────────────────────────
    const card = document.createElement('div')
    card.className = 'fb-card'
    card.style.background = bg
    card.style.color = tc

    if (hasImg) {
      const imZoom = cfg.imageZoom || 1
      const imPX   = cfg.imagePosX ?? 50
      const imPY   = cfg.imagePosY ?? 50
      const img = document.createElement('img')
      img.className = 'fb-img'
      img.src = cfg.image
      img.style.objectPosition = `${imPX}% ${imPY}%`
      img.style.transform      = `scale(${imZoom})`
      img.style.transformOrigin = 'center'
      card.appendChild(img)
    }

    const body = document.createElement('div')
    body.className = 'fb-body'
    if (cfg.title) {
      const t = document.createElement('div')
      t.className = 'fb-title'
      t.textContent = cfg.title
      body.appendChild(t)
    }
    if (cfg.text) {
      const t = document.createElement('div')
      t.className = 'fb-text'
      t.textContent = cfg.text
      body.appendChild(t)
    }
    if (cfg.buttonText) {
      const btn = document.createElement('button')
      btn.className = 'fb-btn'
      btn.textContent = cfg.buttonText
      btn.style.background = btnBg
      btn.style.color = '#fff'
      if (cfg.buttonUrl) btn.addEventListener('click', () => window.open(cfg.buttonUrl, '_blank'))
      body.appendChild(btn)
    }
    card.appendChild(body)

    // ── Pestaña / tab lateral ───────────────────────────────────────────────
    // Actúa como toggle: expande si está colapsado, colapsa si está abierto.
    const tab = document.createElement('div')
    tab.className = 'fb-tab'
    tab.style.background = btnBg
    tab.style.color = '#fff'
    // En móvil arranca colapsado; en escritorio arranca abierto.
    const startsCollapsed = window.innerWidth <= 700
    if (startsCollapsed) outer.classList.add('collapsed')
    tab.textContent = startsCollapsed ? '▶ Oferta' : '✕'
    tab.addEventListener('click', () => {
      const isCollapsed = outer.classList.toggle('collapsed')
      tab.textContent = isCollapsed ? '▶ Oferta' : '✕'
    })

    outer.appendChild(card)
    outer.appendChild(tab)
    document.body.appendChild(outer)

    // Auto-cierre
    const autoClose = parseInt(cfg.autoClose ?? cfg.autoDismiss ?? 0, 10)
    if (autoClose > 0) setTimeout(() => outer.remove(), autoClose * 1000)
  }

  // ── Animaciones de entrada (estilo PowerPoint) ─────────────────────────────
  const pageEntrancePlayers = {}   // índice de página del flipbook → fn que reproduce sus entradas
  const playedEntrances = new Set() // páginas ya reproducidas (no repetir al volver)

  // Deja el objeto en su estado inicial "oculto" según el tipo de entrada.
  function setEntranceInitial(obj, t, ent) {
    obj.set('opacity', 0)
    const dir = ent.direction || 'up'
    const d = 90
    if (ent.type === 'slide' || ent.type === 'bounce') {
      if (ent.type === 'bounce') obj.set('top', t.top - 70)
      else if (dir === 'left') obj.set('left', t.left - d)
      else if (dir === 'right') obj.set('left', t.left + d)
      else if (dir === 'down') obj.set('top', t.top + d)
      else obj.set('top', t.top - d)
    } else if (ent.type === 'zoom') {
      obj.set({ scaleX: t.scaleX * 0.55, scaleY: t.scaleY * 0.55 })
    } else if (ent.type === 'flip') {
      obj.set('scaleX', 0.01)
    }
    obj.setCoords && obj.setCoords()
  }

  // Reproduce la entrada de un objeto: anima de su estado inicial al objetivo.
  function playEntrance(fcanvas, obj, t, ent) {
    const dur = ent.speed === 'slow' ? 1100 : ent.speed === 'fast' ? 350 : 650
    const delay = Math.max(0, (parseFloat(ent.delay) || 0) * 1000)
    const easing = ent.type === 'bounce'
      ? (fabric.util.ease && fabric.util.ease.easeOutBounce)
      : (fabric.util.ease && fabric.util.ease.easeOutCubic)
    const to = { opacity: t.opacity }
    if (ent.type === 'slide' || ent.type === 'bounce') { to.left = t.left; to.top = t.top }
    if (ent.type === 'zoom' || ent.type === 'flip') { to.scaleX = t.scaleX; to.scaleY = t.scaleY }
    setTimeout(() => {
      Object.keys(to).forEach((prop) => {
        fabric.util.animate({
          startValue: obj[prop] == null ? 0 : obj[prop],
          endValue: to[prop],
          duration: dur,
          easing: prop === 'opacity' ? undefined : easing,
          onChange: (v) => { obj.set(prop, v); fcanvas.requestRenderAll() },
          onComplete: () => { obj.set(prop, to[prop]); obj.setCoords && obj.setCoords(); fcanvas.requestRenderAll() },
        })
      })
    }, delay)
  }

  // Dispara las entradas de la(s) página(s) visibles (el spread current y su pareja).
  function triggerEntrances(idx) {
    ;[idx, idx + 1, idx - 1].forEach((i) => {
      if (pageEntrancePlayers[i] && !playedEntrances.has(i)) { playedEntrances.add(i); pageEntrancePlayers[i]() }
    })
  }

  // Convierte el índice del flipbook (con blanks) al número de página real (1..realCount)
  function pageNumOf(idx) {
    return Math.max(1, Math.min(idx - lead + 1, realCount))
  }

  // PROTECTED: Load page backgrounds only when the page becomes relevant.
  // Eager background assignment downloads hidden catalog pages on mobile.
  function ensurePageBackgroundLoaded(pageIndex) {
    const realPage = pageNumOf(pageIndex)
    const realIdx = realPage - 1
    const div = pageDivs[realIdx]

    if (!div) return Promise.resolve(null)
    if (div.__pageBackgroundLoaded) return Promise.resolve(div.__pageSheet || null)
    if (div.__pageBackgroundLoading) return div.__pageBackgroundLoading

    const page = div.__pageData
    const sheet = div.__pageSheet
    const pageImageUrl = viewerRuntime.selectPageImageUrl(page)

    if (!pageImageUrl || !sheet) {
      div.__pageBackgroundLoaded = true
      return Promise.resolve(sheet || null)
    }

    // Se asigna desde el inicio para permitir que el navegador comparta su caché
    // con el Image de precarga. La hoja conserva fondo blanco mientras responde.
    sheet.style.backgroundColor = '#fff'
    sheet.style.backgroundImage = `url("${pageImageUrl}")`
    applyCoverStyle(sheet, page.cover_json, pageImageUrl, pageWidth / pageHeight)

    const task = Promise.resolve(imagePreloader.preload(pageImageUrl))
      .catch((error) => {
        console.warn('[viewer] page background preload failed', pageImageUrl, error)
        return null
      })
      .then((image) => {
        div.__pageBackgroundLoaded = true
        div.__pageBackgroundLoading = null
        return image
      })

    div.__pageBackgroundLoading = task
    return task
  }

  function delayViewer(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  function ensureRealPageBackgrounds(pageNumbers) {
    const uniquePageNumbers = Array.from(new Set(pageNumbers))
      .filter((pageNumber) => pageNumber >= 1 && pageNumber <= realCount)

    return Promise.allSettled(
      uniquePageNumbers.map((pageNumber) => (
        ensurePageBackgroundLoaded(lead + pageNumber - 1)
      )),
    )
  }

  function ensureNearbyPageBackgrounds(pageIndex) {
    const realPage = pageNumOf(pageIndex)
    return ensureRealPageBackgrounds(
      viewerRuntime.nearbyRealPageNumbers(realPage, realCount),
    )
  }


  const DEFERRED_BACKGROUND_CONCURRENCY = 2
  const deferredBackgroundQueue = []
  const deferredBackgroundQueued = new Set()
  let deferredBackgroundActive = 0
  let deferredBackgroundPumpScheduled = false

  function scheduleDeferredBackgroundPump() {
    if (deferredBackgroundPumpScheduled) return
    deferredBackgroundPumpScheduled = true

    const run = () => {
      deferredBackgroundPumpScheduled = false
      pumpDeferredBackgroundQueue()
    }

    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: 700 })
    } else {
      window.setTimeout(run, 30)
    }
  }

  function queueDeferredBackgrounds(pageNumbers, options = {}) {
    const candidates = []

    pageNumbers.forEach((pageNumber) => {
      if (pageNumber < 1 || pageNumber > realCount) return

      const div = pageDivs[pageNumber - 1]
      if (!div) return
      if (isRealPageReady(pageNumber)) return
      if (deferredBackgroundQueued.has(pageNumber)) return

      deferredBackgroundQueued.add(pageNumber)
      candidates.push(pageNumber)
    })

    if (options.front === true) {
      candidates.reverse().forEach((pageNumber) => {
        deferredBackgroundQueue.unshift(pageNumber)
      })
    } else {
      deferredBackgroundQueue.push(...candidates)
    }

    scheduleDeferredBackgroundPump()
  }

  function pumpDeferredBackgroundQueue() {
    while (
      deferredBackgroundActive < DEFERRED_BACKGROUND_CONCURRENCY
      && deferredBackgroundQueue.length
    ) {
      const pageNumber = deferredBackgroundQueue.shift()
      deferredBackgroundQueued.delete(pageNumber)

      const div = pageDivs[pageNumber - 1]
      if (!div || isRealPageReady(pageNumber)) continue

      deferredBackgroundActive += 1

      Promise.resolve(
        ensureRealPagesReady([pageNumber]),
      ).finally(() => {
        deferredBackgroundActive -= 1
        scheduleDeferredBackgroundPump()
      })
    }
  }

  function buildOverlay(div, canvasJson, pageIndex) {
    if (!canvasJson || typeof fabric === 'undefined') {
      return Promise.resolve(null)
    }

    let parsed

    try {
      parsed = typeof canvasJson === 'string'
        ? JSON.parse(canvasJson)
        : canvasJson
    } catch {
      return Promise.resolve(null)
    }

    if (!parsed || !parsed.objects || !parsed.objects.length) {
      return Promise.resolve(null)
    }

    const overlayHost = div.__zoomContent || div
    const wrap = document.createElement('div')
    // pointer-events:none en el contenedor — StPageFlip necesita recibir los gestos
    // de arrastre en toda la página. Los elementos interactivos hijos sobreescriben
    // con pointer-events:auto individualmente.
    wrap.style.cssText = `position:absolute;top:0;left:0;width:${DESIGN_W}px;height:${DESIGN_H}px;transform:scale(${overlayScale});transform-origin:top left;pointer-events:none;opacity:0;transition:opacity .35s ease;`
    const cv = document.createElement('canvas')
    cv.style.cssText = 'pointer-events:none;'
    wrap.appendChild(cv)
    overlayHost.appendChild(wrap)

    // Detiene los eventos que StPageFlip usa para iniciar el volteo de página
    // (mousedown/touchstart/pointerdown). Así un clic dentro de un widget o
    // elemento interactivo NO pasa la página: solo los clics FUERA de estos
    // elementos (sobre la imagen) activan el flip.
    function blockFlipDrag(el) {
      ;['mousedown', 'touchstart', 'pointerdown'].forEach((ev) =>
        el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true }),
      )
    }

    const fcanvas = new fabric.StaticCanvas(cv, { width: DESIGN_W, height: DESIGN_H })
    // Mapa elementId → holderDiv para widgets DOM (show_hide puede afectarlos igual que objetos Fabric)
    const elementDomMap = {}
    // Sin fondo: la imagen de la página ya está debajo
    const objectsOnly = Object.assign({}, parsed, { background: '', backgroundImage: null })
    return new Promise((resolve) => {
      fcanvas.loadFromJSON(objectsOnly, () => {
      let widgetIdx = 0
      // slice(): vamos a remover widgets del canvas mientras iteramos
      fcanvas.getObjects().slice().forEach((obj) => {
       try {
        const d = obj.data || {}
        obj.__showHideWrap = wrap
        const r = obj.getBoundingRect(true)
        const currentPage = div.__pageData || data.pages[pageIndex - lead]
        const dynamicMarker = getDynamicMarker(currentPage?.id, d.elementId)
        if (dynamicMarker) {
          const clipPath = dynamicMarkerClipPath(obj, r)
          const hot = document.createElement('button')
          hot.type = 'button'
          hot.setAttribute('aria-label', `Abrir ficha ${dynamicMarker.name || 'dinámica'}`)
          hot.style.cssText = [
            'position:absolute',
            `left:${r.left}px`,
            `top:${r.top}px`,
            `width:${r.width}px`,
            `height:${r.height}px`,
            'border:0',
            'padding:0',
            'margin:0',
            'background:transparent',
            'cursor:pointer',
            'pointer-events:auto',
            clipPath ? `clip-path:${clipPath}` : '',
          ].filter(Boolean).join(';')
          hot.dataset.flipInteractive = 'true'
          hot.addEventListener('click', (e) => {
            e.preventDefault()
            e.stopPropagation()
            showDynamicMarkerModal(dynamicMarker)
          })
          blockFlipDrag(hot)
          wrap.appendChild(hot)
          fcanvas.remove(obj)
          return
        }

        // Hotspot animado: reemplazar con div CSS
        if (d.kind === 'hotspot') {
          const hsStyle = d.hotspot?.style ?? d.animStyle
          const hsColor = d.hotspot?.color ?? d.color
          const animClass = hsStyle === 'blink' ? 'hs-blink' : hsStyle === 'ripple' ? 'hs-ring' : 'hs-pulse'
          const color = hsColor || '#ef4444'
          const hs = document.createElement('div')
          hs.style.cssText = `position:absolute;left:${r.left + r.width/2 - 18}px;top:${r.top + r.height/2 - 18}px;width:36px;height:36px;cursor:pointer;z-index:7;pointer-events:auto;`
          hs.dataset.flipInteractive = 'true'
          hs.innerHTML = `<div class="${animClass}" style="width:36px;height:36px;border-radius:50%;background:${color}44;border:2.5px solid ${color};display:flex;align-items:center;justify-content:center;"><div style="width:14px;height:14px;border-radius:50%;background:${color};"></div></div>`
          if (d.action) hs.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); runAction(d.action, fcanvas, obj, elementDomMap) })
          blockFlipDrag(hs)
          wrap.appendChild(hs)
          fcanvas.remove(obj)
          return
        }

        // Widget: renderiza el componente real y oculta el placeholder del editor
        if (d.widget) {
          const node = buildWidget(d.widget, r.width, r.height, `${slug}_${widgetIdx++}`, { rect: r, wrap }, pageIndex)
          if (node) {
            const holder = document.createElement('div')
            holder.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:6;pointer-events:auto;`
            holder.dataset.flipInteractive = 'true'
            holder.__widget = d.widget || {}
            // Visibilidad inicial para widgets con startHidden
            if (d.startHidden) { holder.style.visibility = 'hidden'; holder.dataset.visible = 'false' }
            else { holder.dataset.visible = 'true' }
            if (d.elementId) elementDomMap[d.elementId] = holder
            holder.appendChild(node)
            blockFlipDrag(holder)
            wrap.appendChild(holder)
          }
          fcanvas.remove(obj)
          return
        }

        // Acción al hacer clic (botones, zonas de enlace, cualquier elemento)
        const action = d.action
        if (!action) return
        const hot = document.createElement('a')
        hot.href = 'javascript:void(0)'
        hot.title = ''
        hot.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;cursor:pointer;z-index:5;pointer-events:auto;`
        hot.dataset.flipInteractive = 'true'
        hot.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); runAction(action, fcanvas, obj, elementDomMap) })
        blockFlipDrag(hot)
        wrap.appendChild(hot)
       } catch (err) {
        // Un widget con error no debe romper el resto de la página (p. ej. dejar el
        // mapa como dibujo estático). Se omite ese elemento y se continúa.
        console.warn('[viewer] elemento omitido por error:', err)
       }
      })

      // Visibilidad inicial: cualquier elemento con data.startHidden = true arranca invisible.
      // Esto es independiente de si tiene o no un disparador configurado.
      fcanvas.getObjects().forEach((obj) => {
        if ((obj.data || {}).startHidden) obj.visible = false
      })

      // Auto-ocultar elementos referenciados como target de show_hide.
      // Garantiza que el primer clic en el disparador siempre MUESTRE el objetivo
      // (nunca lo oculte), sin requerir que el diseñador marque "Empieza oculto" manualmente.
      const showHideTargetIds = new Set()
      ;(parsed.objects || []).forEach((o) => {
        const a = (o.data || {}).action
        if (a && a.type === 'show_hide' && a.target) showHideTargetIds.add(a.target)
      })
      if (showHideTargetIds.size) {
        fcanvas.getObjects().forEach((obj) => {
          if (showHideTargetIds.has((obj.data || {}).elementId)) obj.visible = false
        })
        Object.keys(elementDomMap).forEach((id) => {
          if (showHideTargetIds.has(id)) {
            elementDomMap[id].style.visibility = 'hidden'
            elementDomMap[id].dataset.visible = 'false'
          }
        })
      }

      // Animaciones de ENTRADA (data.entrance): se preparan ocultas y se reproducen al
      // mostrarse la página. Se registra un "player" indexado por la página del flipbook.
      const entranceObjs = []
      fcanvas.getObjects().forEach((obj) => {
        const ent = (obj.data || {}).entrance
        if (!ent || !ent.type) return
        const target = {
          left: obj.left, top: obj.top,
          scaleX: obj.scaleX == null ? 1 : obj.scaleX, scaleY: obj.scaleY == null ? 1 : obj.scaleY,
          opacity: obj.opacity == null ? 1 : obj.opacity,
        }
        setEntranceInitial(obj, target, ent)
        entranceObjs.push({ obj, target, ent })
      })
      if (entranceObjs.length && pageIndex != null) {
        pageEntrancePlayers[pageIndex] = () => entranceObjs.forEach(({ obj, target, ent }) => playEntrance(fcanvas, obj, target, ent))
      }

      // Animaciones continuas en bucle (data.anim) de esta página
      registerAnimations(fcanvas)

      fcanvas.renderAll()
      // Fade-in del overlay una vez que Fabric.js terminó de renderizar —
      // evita el "flash" de elementos que aparecen de golpe sobre la imagen.
      requestAnimationFrame(() => {
        wrap.style.opacity = '1'
        resolve(wrap)
      })
      })
    })
  }

  // PROTECTED: Build Fabric overlays only when a page becomes relevant.
  // Eagerly building all pages delays mobile startup and loads hidden assets.
  function ensureOverlayBuilt(pageIndex) {
    const realPage = pageNumOf(pageIndex)
    const realIdx = realPage - 1
    const div = pageDivs[realIdx]

    if (!div) return Promise.resolve(null)
    if (div.__overlayBuilt) return Promise.resolve(div)
    if (div.__overlayBuilding) return div.__overlayBuilding

    const task = Promise.resolve(
      buildOverlay(
        div,
        data.pages[realIdx] && data.pages[realIdx].canvas_json,
        lead + realIdx,
      ),
    )
      .catch((error) => {
        console.warn(
          '[viewer] overlay build failed',
          data.pages[realIdx]?.id,
          error,
        )
        return null
      })
      .then(() => {
        div.__overlayBuilt = true
        return div
      })
      .finally(() => {
        div.__overlayBuilding = null
      })

    div.__overlayBuilding = task
    return task
  }

  function ensureNearbyOverlays(pageIndex) {
    const realPage = pageNumOf(pageIndex)
    const jobs = []

    ;[realPage - 1, realPage, realPage + 1].forEach((pageNumber) => {
      if (pageNumber < 1 || pageNumber > realCount) return

      jobs.push(
        ensureOverlayBuilt(lead + pageNumber - 1),
      )
    })

    return Promise.allSettled(jobs)
  }

  function ensureRealPageOverlays(pageNumbers) {
    const uniquePageNumbers = Array.from(new Set(pageNumbers))
      .filter((pageNumber) => pageNumber >= 1 && pageNumber <= realCount)

    return Promise.allSettled(
      uniquePageNumbers.map((pageNumber) => (
        ensureOverlayBuilt(lead + pageNumber - 1)
      )),
    )
  }

  function ensureRealPagesReady(pageNumbers) {
    return Promise.all([
      ensureRealPageBackgrounds(pageNumbers),
      ensureRealPageOverlays(pageNumbers),
    ])
  }

  function isRealPageReady(pageNumber) {
    if (pageNumber < 1 || pageNumber > realCount) return true

    const div = pageDivs[pageNumber - 1]

    return !!(
      div
      && div.__pageBackgroundLoaded
      && div.__overlayBuilt
    )
  }

  function areRealPagesReady(pageNumbers) {
    return pageNumbers.every(isRealPageReady)
  }

  function scheduleNearbyOverlays(pageIndex) {
    const work = () => ensureNearbyOverlays(pageIndex)
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(work, { timeout: 700 })
    } else {
      window.setTimeout(work, 0)
    }
  }

  const initialPageIndex = pageFlip.getCurrentPageIndex()
  const startupRealPages = viewerRuntime.startupRealPageNumbers(
    realCount,
    portrait,
  )

  let loadingStatus = null

  if (loadingScreen) {
    loadingStatus = document.createElement('div')
    loadingStatus.dataset.intapLoadingStatus = 'true'
    loadingStatus.textContent = 'Preparando tu catálogo…'
    loadingStatus.style.cssText = [
      'margin-top:14px',
      'color:#fff',
      'font-family:Inter,system-ui,sans-serif',
      'font-size:14px',
      'font-weight:700',
      'letter-spacing:.01em',
      'text-align:center',
    ].join(';')

    loadingScreen.appendChild(loadingStatus)
  }

  // Una página se considera lista únicamente cuando terminaron su fondo
  // y su composición Fabric. Se priorizan portada y primer pliego.
  const startupLoad = ensureRealPagesReady(startupRealPages)

  await Promise.race([
    startupLoad,
    delayViewer(3500),
  ])

  scheduleNearbyOverlays(initialPageIndex)

  if (loadingScreen) {
    if (loadingStatus) loadingStatus.textContent = 'Catálogo listo'
    loadingScreen.classList.add('hidden')
    setTimeout(() => loadingScreen.remove(), 450)
  }

  // El resto continúa en segundo plano, en orden y con dos descargas simultáneas.
  const startupSet = new Set(startupRealPages)
  const remainingRealPages = Array.from(
    { length: realCount },
    (_, index) => index + 1,
  ).filter((pageNumber) => !startupSet.has(pageNumber))

  queueDeferredBackgrounds(remainingRealPages)

  // Centrado dinámico: cubre/contraportada centradas, spreads interiores sin desplazamiento
  let currentShift = 0
  function applyTransform() {
    container.style.transform = `translateX(${currentShift}px)`
    container.style.transformOrigin = 'center center'
    container.style.transition = 'transform 0.3s ease'
  }

  // PROTECTED: Double-click / double-tap cycles page zoom levels.
  // Required for small-text catalogs on mobile and desktop.
  const zoomLevels = [1, 1.5, 2.25, 3]
  let zoomIdx = 0
  let zoomScale = 1
  let panX = 0
  let panY = 0
  let zoomPage = null
  let isPanning = false
  let dragMoved = false
  let suppressNextClick = false
  let activePointerId = null
  let panStart = null
  let lastTap = { time: 0, x: 0, y: 0 }
  const activeTouchPointers = new Map()
  let isPinching = false
  let pinchStart = null
  let pendingDoubleTapPointerId = null

  function getZoomContent(page) {
    return page?.__zoomContent || null
  }

  function getZoomViewport(page) {
    return page?.__zoomViewport || page || null
  }

  function resetPageZoomContent(page) {
    const content = getZoomContent(page)
    const viewport = getZoomViewport(page)
    if (content) {
      content.style.transform = ''
      content.style.transition = ''
      content.style.cursor = ''
    }
    if (viewport) viewport.style.touchAction = ''
  }

  function getPageFromEventTarget(target) {
    const page = target?.closest?.('.page')
    return pageDivs.includes(page) ? page : null
  }

  // PROTECTED: Double-click/tap zoom must not start from interactive overlay controls.
  // Otherwise the same gesture can trigger buttons, linkzones, WhatsApp, galleries or forms.
  function isZoomBlockedTarget(target) {
    return !!target?.closest?.([
      'a', 'button', 'input', 'textarea', 'select', 'form', 'iframe', 'audio', 'video',
      '[role="button"]', '[contenteditable="true"]', '[data-flip-interactive="true"]',
      '#controls', '#thumbnail-panel', '#share-menu',
    ].join(','))
  }

  function getCurrentPageElement() {
    const idx = pageFlip.getCurrentPageIndex()
    return pageDivs[pageNumOf(idx) - 1] || null
  }

  function getZoomTargetAtPoint(clientX, clientY) {
    const page = getPageFromEventTarget(document.elementFromPoint(clientX, clientY))
    if (page) return page
    return getCurrentPageElement()
  }

  function clampPanFor(page, scale, x, y) {
    if (!page || scale <= 1) return { x: 0, y: 0 }
    const viewport = getZoomViewport(page)
    const w = viewport?.clientWidth || page.clientWidth || pageWidth
    const h = viewport?.clientHeight || page.clientHeight || pageHeight
    const minX = Math.min(0, w - w * scale)
    const minY = Math.min(0, h - h * scale)
    return {
      x: Math.min(0, Math.max(minX, x)),
      y: Math.min(0, Math.max(minY, y)),
    }
  }

  function applyPageZoom(animate = true) {
    pageDivs.forEach((page) => {
      if (page !== zoomPage) resetPageZoomContent(page)
    })
    if (!zoomPage) return
    const content = getZoomContent(zoomPage)
    const viewport = getZoomViewport(zoomPage)
    if (!content) return
    const clamped = clampPanFor(zoomPage, zoomScale, panX, panY)
    panX = clamped.x
    panY = clamped.y
    content.style.transition = animate ? 'transform .22s ease' : 'none'
    content.style.transform = zoomScale > 1 ? `translate(${panX}px, ${panY}px) scale(${zoomScale})` : ''
    content.style.cursor = zoomScale > 1 ? (isPanning ? 'grabbing' : 'grab') : ''
    if (viewport) viewport.style.touchAction = zoomScale > 1 || isPinching ? 'none' : ''
  }

  function resetPageZoom() {
    zoomIdx = 0
    zoomScale = 1
    panX = 0
    panY = 0
    isPanning = false
    isPinching = false
    dragMoved = false
    activePointerId = null
    panStart = null
    pinchStart = null
    pendingDoubleTapPointerId = null
    activeTouchPointers.clear()
    const previous = zoomPage
    zoomPage = null
    if (previous) resetPageZoomContent(previous)
    pageDivs.forEach(resetPageZoomContent)
  }

  function cyclePageZoom(clientX, clientY, sourceTarget = null) {
    if (sourceTarget && isZoomBlockedTarget(sourceTarget)) return
    const targetPage = getZoomTargetAtPoint(clientX, clientY)
    if (!targetPage) return
    if (zoomPage && zoomPage !== targetPage) resetPageZoom()

    const nextIdx = zoomScale >= zoomLevels[zoomLevels.length - 1] - 0.01
      ? 0
      : zoomLevels.findIndex((scale) => scale > zoomScale + 0.01)
    const nextScale = zoomLevels[nextIdx]
    if (nextScale === 1) {
      resetPageZoom()
      return
    }

    const viewport = getZoomViewport(targetPage)
    const rect = viewport.getBoundingClientRect()
    const pageX = ((clientX - rect.left) / Math.max(1, rect.width)) * (viewport.clientWidth || targetPage.clientWidth || pageWidth)
    const pageY = ((clientY - rect.top) / Math.max(1, rect.height)) * (viewport.clientHeight || targetPage.clientHeight || pageHeight)
    const viewportX = pageX * zoomScale + panX
    const viewportY = pageY * zoomScale + panY
    zoomPage = targetPage
    zoomIdx = nextIdx
    zoomScale = nextScale
    panX = viewportX - pageX * zoomScale
    panY = viewportY - pageY * zoomScale
    applyPageZoom(true)
  }

  function isZoomed() {
    return zoomScale > 1 && !!zoomPage
  }

  function blockZoomEvent(e) {
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation?.()
  }

  function distanceBetween(a, b) {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
  }

  function midpointBetween(a, b) {
    return {
      clientX: (a.clientX + b.clientX) / 2,
      clientY: (a.clientY + b.clientY) / 2,
    }
  }

  function viewportPointFor(page, clientX, clientY) {
    const viewport = getZoomViewport(page)
    const rect = viewport.getBoundingClientRect()
    return {
      x: ((clientX - rect.left) / Math.max(1, rect.width)) * (viewport.clientWidth || page.clientWidth || pageWidth),
      y: ((clientY - rect.top) / Math.max(1, rect.height)) * (viewport.clientHeight || page.clientHeight || pageHeight),
    }
  }

  function syncZoomIdxFromScale() {
    zoomIdx = zoomLevels.reduce((bestIdx, level, idx) => (
      Math.abs(level - zoomScale) < Math.abs(zoomLevels[bestIdx] - zoomScale) ? idx : bestIdx
    ), 0)
  }

  function installPageZoom() {
    const shell = document.getElementById('flipbook-container') || container.parentElement || container

    shell.addEventListener('dblclick', (e) => {
      if (isZoomBlockedTarget(e.target)) return
      const page = getZoomTargetAtPoint(e.clientX, e.clientY)
      if (!page) return
      blockZoomEvent(e)
      suppressNextClick = true
      cyclePageZoom(e.clientX, e.clientY, e.target)
    }, true)

    function beginPinch() {
      if (activeTouchPointers.size < 2) return false
      const touches = Array.from(activeTouchPointers.values()).slice(0, 2)
      const center = midpointBetween(touches[0], touches[1])
      const targetPage = zoomPage || getZoomTargetAtPoint(center.clientX, center.clientY)
      if (!targetPage) return false
      if (zoomPage && zoomPage !== targetPage) resetPageZoom()

      zoomPage = targetPage
      const centerPoint = viewportPointFor(zoomPage, center.clientX, center.clientY)
      pinchStart = {
        distance: Math.max(1, distanceBetween(touches[0], touches[1])),
        scale: zoomScale,
        contentX: (centerPoint.x - panX) / zoomScale,
        contentY: (centerPoint.y - panY) / zoomScale,
      }
      isPinching = true
      isPanning = false
      activePointerId = null
      panStart = null
      dragMoved = true
      applyPageZoom(false)
      return true
    }

    function updatePinch() {
      if (!isPinching || !pinchStart || activeTouchPointers.size < 2 || !zoomPage) return
      const touches = Array.from(activeTouchPointers.values()).slice(0, 2)
      const center = midpointBetween(touches[0], touches[1])
      const centerPoint = viewportPointFor(zoomPage, center.clientX, center.clientY)
      zoomScale = Math.min(3, Math.max(1, pinchStart.scale * (distanceBetween(touches[0], touches[1]) / pinchStart.distance)))
      panX = centerPoint.x - pinchStart.contentX * zoomScale
      panY = centerPoint.y - pinchStart.contentY * zoomScale
      const clamped = clampPanFor(zoomPage, zoomScale, panX, panY)
      panX = clamped.x
      panY = clamped.y
      syncZoomIdxFromScale()
      applyPageZoom(false)
    }

    // PROTECTED: The second mobile tap must be intercepted before StPageFlip.
    // Otherwise a zoom gesture can accidentally turn the page.
    shell.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return
      const page = getPageFromEventTarget(e.target)
      if (e.pointerType === 'touch') {
        const now = Date.now()
        const moved = Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y)
        if (page && !isZoomBlockedTarget(e.target) && now - lastTap.time < 320 && moved < 28) {
          blockZoomEvent(e)
          pendingDoubleTapPointerId = e.pointerId
          lastTap = { time: 0, x: 0, y: 0 }
          return
        }

        if (page && (!isZoomBlockedTarget(e.target) || isZoomed())) {
          activeTouchPointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY, page })
          try { shell.setPointerCapture?.(e.pointerId) } catch (_) {}
          if (activeTouchPointers.size >= 2 && beginPinch()) {
            blockZoomEvent(e)
            return
          }
        }
      }

      if (!isZoomed()) return
      if (page !== zoomPage) return
      blockZoomEvent(e)
      isPanning = true
      dragMoved = false
      activePointerId = e.pointerId
      panStart = { x: e.clientX, y: e.clientY, panX, panY }
      try { shell.setPointerCapture?.(e.pointerId) } catch (_) {}
      applyPageZoom(false)
    }, true)

    // PROTECTED: Two-finger pinch owns the gesture while active.
    // It must never leak to page-flip navigation or interactive overlays.
    shell.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' && activeTouchPointers.has(e.pointerId)) {
        activeTouchPointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY, page: activeTouchPointers.get(e.pointerId).page })
        if (isPinching) {
          blockZoomEvent(e)
          updatePinch()
          return
        }
      }

      if (!isPanning || e.pointerId !== activePointerId || !panStart) return
      blockZoomEvent(e)
      const dx = e.clientX - panStart.x
      const dy = e.clientY - panStart.y
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragMoved = true
      const next = clampPanFor(zoomPage, zoomScale, panStart.panX + dx, panStart.panY + dy)
      panX = next.x
      panY = next.y
      applyPageZoom(false)
    }, true)

    function finishPointer(e) {
      if (pendingDoubleTapPointerId === e.pointerId) {
        blockZoomEvent(e)
        pendingDoubleTapPointerId = null
        suppressNextClick = true
        activeTouchPointers.delete(e.pointerId)
        cyclePageZoom(e.clientX, e.clientY, e.target)
        return
      }

      if (e.pointerType === 'touch') activeTouchPointers.delete(e.pointerId)

      if (isPinching) {
        blockZoomEvent(e)
        isPinching = false
        pinchStart = null
        if (zoomScale <= 1.01) {
          resetPageZoom()
          return
        }
        syncZoomIdxFromScale()
        applyPageZoom(false)

        const remaining = Array.from(activeTouchPointers.entries())[0]
        if (remaining && isZoomed()) {
          activePointerId = remaining[0]
          isPanning = true
          dragMoved = true
          panStart = { x: remaining[1].clientX, y: remaining[1].clientY, panX, panY }
        }
        return
      }

      const wasPanning = isPanning && e.pointerId === activePointerId
      if (wasPanning) {
        blockZoomEvent(e)
        try { shell.releasePointerCapture?.(e.pointerId) } catch (_) {}
        isPanning = false
        activePointerId = null
        panStart = null
        applyPageZoom(false)
      }

      const now = Date.now()
      if (!dragMoved && e.pointerType === 'touch' && !isZoomBlockedTarget(e.target)) {
        lastTap = { time: now, x: e.clientX, y: e.clientY }
      }
    }

    shell.addEventListener('pointerup', finishPointer, true)
    shell.addEventListener('pointercancel', finishPointer, true)

    shell.addEventListener('click', (e) => {
      if (!suppressNextClick && !(isZoomed() && dragMoved)) return
      blockZoomEvent(e)
      suppressNextClick = false
      dragMoved = false
    }, true)

    const reclampZoom = () => {
      if (!isZoomed()) return
      const next = clampPanFor(zoomPage, zoomScale, panX, panY)
      panX = next.x
      panY = next.y
      applyPageZoom(false)
    }
    window.addEventListener('resize', reclampZoom)
    window.addEventListener('orientationchange', reclampZoom)
    window.addEventListener('pagehide', resetPageZoom)
  }

  installPageZoom()

  function applyCenter() {
    if (portrait) return
    const idx = pageFlip.getCurrentPageIndex()
    currentShift = idx <= 0 ? -(pageWidth / 2)
      : idx >= realCount ? (pageWidth / 2)
      : 0
    applyTransform()
  }

  function updatePageInfo() {
    const idx = pageFlip.getCurrentPageIndex()
    document.getElementById('page-info').textContent = `${pageNumOf(idx)} / ${realCount}`
  }

  // Actualiza estado habilitado/deshabilitado de los botones de navegación
  function updateNavButtons() {
    const idx = pageFlip.getCurrentPageIndex()
    document.getElementById('btn-prev').disabled = idx <= firstIdx
    document.getElementById('btn-next').disabled = idx >= lastIdx
  }

  // Actualiza miniatura activa
  function updateActiveThumbnail() {
    const idx = pageFlip.getCurrentPageIndex()
    const current = pageNumOf(idx)
    document.querySelectorAll('.thumb-item').forEach((el, i) => {
      el.classList.toggle('active', i + 1 === current)
    })
  }

  function onFlipChange() {
    const idx = pageFlip.getCurrentPageIndex()
    // Si el swipe/drag llegó a una página en blanco, volver a la real más cercana
    if (idx < firstIdx) { pageFlip.flip(firstIdx); return }
    if (idx > lastIdx) { pageFlip.flip(lastIdx); return }
    playFlipSound()
    // Cerrar al cambiar de página solo los show_hide activos cuya política lo permita.
    Object.keys(dismissCleanupMap).forEach((k) => {
      const entry = dismissCleanupMap[k]
      if (!entry?.closeOnPageChange) return
      entry.hide()
    })
    // Al cambiar de página, deshacer el zoom (vuelve a 1x).
    resetPageZoom()
    updatePageInfo()
    applyCenter()
    updateNavButtons()
    updateActiveThumbnail()
    const nearbyRealPages = viewerRuntime.nearbyRealPageNumbers(
      pageNumOf(idx),
      realCount,
    )

    queueDeferredBackgrounds(nearbyRealPages, { front: true })
    scheduleNearbyOverlays(idx)
    startPageTimer(pageNumOf(idx))
    triggerEntrances(idx)
    firePendingBannersForPage(idx)
  }

  pageFlip.on('flip', onFlipChange)
  // Entradas y banners de página de la primera hoja visible (tras el fade-in del overlay).
  setTimeout(() => {
    const firstPage = pageFlip.getCurrentPageIndex()
    triggerEntrances(firstPage)
    firePendingBannersForPage(firstPage)
  }, 500)
  pageFlip.on('changeState', () => {
    updatePageInfo()
    applyCenter()
    updateNavButtons()
    updateActiveThumbnail()
  })

  applyCenter()
  updatePageInfo()
  updateNavButtons()

  // Registrar vista de la página 1 al inicializar el flipbook
  sendEvent({ type: 'page_view', page_number: 1 })

  // Construir panel de miniaturas
  const thumbList = document.getElementById('thumbnail-list')
  data.pages.forEach((page, i) => {
    const item = document.createElement('div')
    item.className = 'thumb-item' + (i === 0 ? ' active' : '')
    const img = document.createElement('img')
    img.src = viewerRuntime.selectPageImageUrl(page)
    img.alt = `Pág ${i + 1}`
    img.loading = 'lazy'
    const label = document.createElement('span')
    label.textContent = i + 1
    item.appendChild(img)
    item.appendChild(label)
    item.addEventListener('click', () => {
      void goToPageIndex(lead + i)
      document.getElementById('thumbnail-panel').classList.remove('open')
    })
    thumbList.appendChild(item)
  })

  // La navegación conserva una cola corta. Cada petición prepara primero
  // el pliego destino y permanece ocupada hasta finalizar el giro completo.
  let navigationPending = false
  const navigationQueue = []
  let preparingHintTimer = null

  function showPreparingHint(message = 'Preparando páginas…') {
    let hint = document.getElementById('intap-page-preparing')

    if (!hint) {
      hint = document.createElement('div')
      hint.id = 'intap-page-preparing'
      hint.style.cssText = [
        'position:fixed',
        'left:50%',
        'bottom:82px',
        'transform:translateX(-50%)',
        'z-index:99990',
        'background:rgba(15,23,42,.92)',
        'color:#fff',
        'padding:9px 14px',
        'border-radius:999px',
        'font-family:Inter,system-ui,sans-serif',
        'font-size:12px',
        'font-weight:800',
        'box-shadow:0 8px 24px rgba(0,0,0,.28)',
        'pointer-events:none',
      ].join(';')

      document.body.appendChild(hint)
    }

    hint.textContent = message
    hint.style.display = 'block'

    clearTimeout(preparingHintTimer)
    preparingHintTimer = setTimeout(() => {
      hint.style.display = 'none'
    }, 1400)
  }

  async function waitUntilPageFlipRead(timeoutMs = 1800) {
    const startedAt = Date.now()

    while (
      pageFlip.getState() !== 'read'
      && Date.now() - startedAt < timeoutMs
    ) {
      await delayViewer(35)
    }
  }

  async function waitForPageFlipCycle(timeoutMs = 2200) {
    const startedAt = Date.now()
    let movementDetected = false

    while (Date.now() - startedAt < timeoutMs) {
      const state = pageFlip.getState()

      if (state !== 'read') movementDetected = true
      if (movementDetected && state === 'read') return

      await delayViewer(35)
    }
  }

  function enqueueNavigation(request) {
    if (request.type === 'target') {
      navigationQueue.length = 0
      navigationQueue.push(request)
      return
    }

    if (navigationQueue.length < 6) {
      navigationQueue.push(request)
    }
  }

  function requestNavigation(request) {
    enqueueNavigation(request)
    void drainNavigationQueue()
  }

  async function drainNavigationQueue() {
    if (navigationPending) return

    const request = navigationQueue.shift()
    if (!request) return

    navigationPending = true

    try {
      await waitUntilPageFlipRead()

      const currentIndex = pageFlip.getCurrentPageIndex()
      let targetIndex = currentIndex
      let executeFlip = null

      if (request.type === 'target') {
        targetIndex = Math.max(
          firstIdx,
          Math.min(lastIdx, request.targetIndex),
        )

        if (targetIndex === currentIndex) return
        executeFlip = () => pageFlip.flip(targetIndex)
      }

      if (request.type === 'next') {
        if (currentIndex >= lastIdx) return

        const step = portrait ? 1 : 2
        targetIndex = Math.min(lastIdx, currentIndex + step)
        executeFlip = () => pageFlip.flipNext()
      }

      if (request.type === 'previous') {
        if (currentIndex <= firstIdx) return

        const step = portrait ? 1 : 2
        targetIndex = Math.max(firstIdx, currentIndex - step)
        executeFlip = () => pageFlip.flipPrev()
      }

      if (!executeFlip) return

      const targetRealPages = viewerRuntime.targetRealPageNumbers(
        pageNumOf(targetIndex),
        realCount,
      )

      if (!areRealPagesReady(targetRealPages)) {
        showPreparingHint(
          request.type === 'target'
            ? 'Preparando sección…'
            : 'Preparando páginas…',
        )
      }

      queueDeferredBackgrounds(targetRealPages, { front: true })
      await ensureRealPagesReady(targetRealPages)
      await waitUntilPageFlipRead()

      executeFlip()
      await waitForPageFlipCycle()
    } finally {
      navigationPending = false

      if (navigationQueue.length) {
        setTimeout(() => {
          void drainNavigationQueue()
        }, 0)
      }
    }
  }

  function goToPageIndex(targetIndex) {
    requestNavigation({
      type: 'target',
      targetIndex,
    })

    return Promise.resolve()
  }

  function goNextPage() {
    requestNavigation({ type: 'next' })
    return Promise.resolve()
  }

  function goPreviousPage() {
    requestNavigation({ type: 'previous' })
    return Promise.resolve()
  }

  // El arrastre nativo también queda protegido. Si el pliego próximo no está
  // preparado, se prioriza y se pide al usuario repetir el gesto unos instantes después.
  function guardUnpreparedNativeFlip(event) {
    if (navigationPending) {
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }

    const currentRealPage = pageNumOf(
      pageFlip.getCurrentPageIndex(),
    )

    const interactionPages = viewerRuntime.targetRealPageNumbers(
      currentRealPage,
      realCount,
    )

    if (areRealPagesReady(interactionPages)) return

    const target = event.target

    if (
      target instanceof Element
      && target.closest('[data-flip-interactive="true"]')
    ) {
      return
    }

    queueDeferredBackgrounds(interactionPages, { front: true })
    void ensureRealPagesReady(interactionPages)
    showPreparingHint()

    event.preventDefault()
    event.stopImmediatePropagation()
  }

  ;['pointerdown', 'mousedown', 'touchstart'].forEach((eventName) => {
    container.addEventListener(
      eventName,
      guardUnpreparedNativeFlip,
      { capture: true, passive: false },
    )
  })

  // Autoplay
  let autoplayTimer = null
  function startAutoplay() {
    stopAutoplay()
    autoplayTimer = setInterval(() => {
      const idx = pageFlip.getCurrentPageIndex()
      if (idx >= lastIdx) { stopAutoplay(); return }
      void goNextPage()
    }, 3000)
    document.getElementById('btn-autoplay').textContent = '⏸'
    document.getElementById('btn-autoplay').classList.add('playing')
  }
  function stopAutoplay() {
    clearInterval(autoplayTimer)
    autoplayTimer = null
    document.getElementById('btn-autoplay').textContent = '▶'
    document.getElementById('btn-autoplay').classList.remove('playing')
  }

  // Botón de zoom: usa el mismo ciclo que doble clic / doble toque sobre la hoja activa.
  document.getElementById('btn-zoom').addEventListener('click', () => {
    const page = zoomPage || getCurrentPageElement()
    const rect = page?.getBoundingClientRect()
    if (!rect) return
    cyclePageZoom(rect.left + rect.width / 2, rect.top + rect.height / 2)
  })

  document.getElementById('btn-first').addEventListener('click', () => {
    void goToPageIndex(firstIdx)
  })

  document.getElementById('btn-last').addEventListener('click', () => {
    void goToPageIndex(lastIdx)
  })

  document.getElementById('btn-prev').addEventListener('click', () => {
    void goPreviousPage()
  })

  document.getElementById('btn-next').addEventListener('click', () => {
    void goNextPage()
  })

  document.getElementById('btn-autoplay').addEventListener('click', () => {
    autoplayTimer ? stopAutoplay() : startAutoplay()
  })

  // ── Menú de compartir en redes sociales ─────────────────────────────────────
  function openShareMenu() {
    // Si ya existe, lo cerramos (toggle)
    const existing = document.getElementById('share-menu-overlay')
    if (existing) { existing.remove(); return }

    const url = location.href
    const title = data.title || 'Mira este catálogo'
    const eUrl = encodeURIComponent(url)
    const eText = encodeURIComponent(`${title} ${url}`)

    // Opciones de compartir: etiqueta, color, icono SVG y enlace destino
    const opts = [
      { label: 'WhatsApp', color: '#25D366', href: `https://wa.me/?text=${eText}`,
        icon: '<path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2zm0 18a8 8 0 0 1-4.1-1.1l-.3-.2-2.8.8.8-2.7-.2-.3A8 8 0 1 1 12 20zm4.4-6c-.2-.1-1.4-.7-1.6-.8s-.4-.1-.6.1-.6.8-.8 1-.3.1-.5 0a6.5 6.5 0 0 1-3.2-2.8c-.2-.4.2-.4.6-1.2.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3A2.8 2.8 0 0 0 6 8.6c0 1.7 1.2 3.3 1.4 3.5s2.4 3.7 5.9 5c2 .8 2.4.7 2.9.6s1.4-.6 1.6-1.1.2-1 .1-1.1-.2-.2-.5-.3z"/>' },
      { label: 'Facebook', color: '#1877F2', href: `https://www.facebook.com/sharer/sharer.php?u=${eUrl}`,
        icon: '<path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12z"/>' },
      { label: 'X', color: '#000000', href: `https://twitter.com/intent/tweet?url=${eUrl}&text=${encodeURIComponent(title)}`,
        icon: '<path d="M18.9 2H22l-7.1 8.1L23 22h-6.4l-5-6.6L5.8 22H2.7l7.6-8.7L1.7 2h6.5l4.5 6 5.2-6zm-1.1 18h1.7L7.3 3.8H5.5L17.8 20z"/>' },
      { label: 'Telegram', color: '#0088CC', href: `https://t.me/share/url?url=${eUrl}&text=${encodeURIComponent(title)}`,
        icon: '<path d="M21.9 4.3l-3.3 15.5c-.2 1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.3-5 9.1-8.2c.4-.3-.1-.5-.6-.2L6.3 13 1.5 11.5c-1-.3-1-1 .2-1.5l18.7-7.2c.9-.3 1.7.2 1.5 1.5z"/>' },
      { label: 'Email', color: '#6B7280', href: `mailto:?subject=${encodeURIComponent(title)}&body=${eText}`,
        icon: '<path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm9 7L4 7v1l8 5 8-5V7l-8 5z"/>' },
    ]

    const overlay = document.createElement('div')
    overlay.id = 'share-menu-overlay'
    overlay.style.cssText = 'position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px;'

    const card = document.createElement('div')
    card.style.cssText = 'background:#fff;border-radius:16px;padding:22px 20px;max-width:360px;width:100%;font-family:Inter,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.3);'

    const h = document.createElement('div')
    h.textContent = 'Compartir catálogo'
    h.style.cssText = 'font-weight:700;font-size:16px;color:#111827;margin-bottom:16px;text-align:center;'
    card.appendChild(h)

    const grid = document.createElement('div')
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:12px;'
    opts.forEach((o) => {
      const a = document.createElement('a')
      a.href = o.href
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;text-decoration:none;color:#374151;font-size:11px;font-weight:600;'
      a.innerHTML = `<span style="width:46px;height:46px;border-radius:50%;background:${o.color};display:flex;align-items:center;justify-content:center;">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="#fff">${o.icon}</svg></span>${o.label}`
      a.addEventListener('click', () => setTimeout(() => overlay.remove(), 100))
      grid.appendChild(a)
    })
    card.appendChild(grid)

    // Fila de copiar enlace
    const copyRow = document.createElement('div')
    copyRow.style.cssText = 'display:flex;gap:8px;margin-top:18px;'
    const input = document.createElement('input')
    input.value = url
    input.readOnly = true
    input.style.cssText = 'flex:1;border:1px solid #d1d5db;border-radius:8px;padding:9px 10px;font-size:12px;color:#374151;font-family:Inter,sans-serif;'
    const copyBtn = document.createElement('button')
    copyBtn.textContent = 'Copiar'
    copyBtn.style.cssText = 'background:#4F46E5;color:#fff;border:none;border-radius:8px;padding:9px 16px;font-weight:700;font-size:12px;cursor:pointer;font-family:Inter,sans-serif;'
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(url).then(() => {
        copyBtn.textContent = '✓ Copiado'
        setTimeout(() => { copyBtn.textContent = 'Copiar' }, 1500)
      })
      input.select()
    })
    copyRow.appendChild(input)
    copyRow.appendChild(copyBtn)
    card.appendChild(copyRow)

    // Botón nativo del sistema (móvil) si está disponible
    if (navigator.share) {
      const nativeBtn = document.createElement('button')
      nativeBtn.textContent = 'Más opciones…'
      nativeBtn.style.cssText = 'width:100%;margin-top:12px;background:#f3f4f6;color:#374151;border:none;border-radius:8px;padding:10px;font-weight:600;font-size:13px;cursor:pointer;font-family:Inter,sans-serif;'
      nativeBtn.addEventListener('click', () => {
        navigator.share({ title, url }).catch(() => {})
      })
      card.appendChild(nativeBtn)
    }

    overlay.appendChild(card)
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })
    document.body.appendChild(overlay)
  }

  document.getElementById('btn-share').addEventListener('click', () => {
    openShareMenu()
  })

  setupPublicCatalogSearch()

  document.getElementById('btn-thumbnails').addEventListener('click', () => {
    document.getElementById('thumbnail-panel').classList.toggle('open')
  })

  document.getElementById('btn-fullscreen').addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen().catch(() => {})
    }
  })

  document.addEventListener('fullscreenchange', () => {
    const btnFs = document.getElementById('btn-fullscreen')
    btnFs.title = document.fullscreenElement ? 'Salir de pantalla completa' : 'Pantalla completa'
    if (document.fullscreenElement) {
      btnFs.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/></svg>`
    } else {
      btnFs.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`
    }
  })

  // Cerrar panel de miniaturas al hacer clic fuera
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('thumbnail-panel')
    const btn = document.getElementById('btn-thumbnails')
    if (panel.classList.contains('open') && !panel.contains(e.target) && e.target !== btn) {
      panel.classList.remove('open')
    }
  })

  // ── Marca de agua ────────────────────────────────────────────────────────
  if (data.watermark_enabled && data.watermark) {
    const wm = data.watermark
    const opacity = Math.min(100, Math.max(0, wm.opacity ?? 80)) / 100
    const isMobile = window.innerWidth < 700

    const el = document.createElement('a')
    el.id = 'flipbook-watermark'
    el.href = wm.link_url || 'https://intapflipbook.com'
    el.target = '_blank'
    el.rel = 'noopener noreferrer'
    el.textContent = wm.text || 'Creado con Intap Flipbook'

    if (isMobile) {
      // En móvil: div absoluto sobre el flipbook-container, centrado horizontalmente,
      // anclado en la parte inferior. No cubre los controles porque va dentro del contenedor.
      const container = document.getElementById('flipbook-container')
      el.style.cssText = [
        'position:absolute',
        'left:50%',
        'transform:translateX(-50%)',
        'bottom:6px',
        'z-index:30',
        'text-align:center',
        'color:#fff',
        'background:rgba(26,26,46,.75)',
        'font-size:0.65rem',
        'text-decoration:none',
        'font-family:Inter,sans-serif',
        `opacity:${opacity}`,
        'padding:3px 10px',
        'border-radius:4px',
        'pointer-events:auto',
        'white-space:nowrap',
      ].join(';')
      // El contenedor debe tener position:relative para que el absolute funcione
      if (container.style.position !== 'relative') container.style.position = 'relative'
      container.appendChild(el)
    } else {
      // En escritorio: dentro de la barra de controles, tras un separador.
      const controls = document.getElementById('controls')
      const sep = document.createElement('div')
      sep.className = 'ctrl-sep'
      controls.appendChild(sep)
      el.style.cssText = [
        'color:rgba(255,255,255,.75)',
        'font-size:0.7rem',
        'text-decoration:none',
        'white-space:nowrap',
        'flex-shrink:0',
        'font-family:Inter,sans-serif',
        `opacity:${opacity}`,
        'padding:2px 4px',
      ].join(';')
      el.addEventListener('mouseenter', () => { el.style.opacity = '1'; el.style.color = '#fff' })
      el.addEventListener('mouseleave', () => { el.style.opacity = String(opacity); el.style.color = 'rgba(255,255,255,.75)' })
      controls.appendChild(el)
    }
  }
  notifyViewerReady()
}

init().catch((err) => {
  console.error('Flipbook init error:', err)
  if (document.body.dataset.viewerError !== '1') {
    showViewerError('No se pudo inicializar el visor.')
  }
})

// Al rotar el dispositivo o redimensionar la ventana, recargar para recalcular dimensiones.
// Se espera 400ms para que el viewport termine de acomodarse antes de recargar.
let resizeTimer
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => location.reload(), 400)
})
