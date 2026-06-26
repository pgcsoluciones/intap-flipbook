// Fix bug Fabric.js 5.3.0: el textBaseline por defecto es 'alphabetical' (inválido según
// el estándar Canvas) y dispara un warning del navegador en cada render de cada texto.
// El valor correcto es 'alphabetic'. Lo corregimos en el prototype de fabric.Text.
if (window.fabric?.Text?.prototype) {
  window.fabric.Text.prototype.textBaseline = 'alphabetic'
}

const API_BASE = window.__FLIPBOOK_CONFIG__?.apiBase ?? 'https://intap-flipbook-api.fliaprince.workers.dev'

const slug = location.pathname.split('/').filter(Boolean).pop()
if (!slug) {
  document.body.innerHTML = '<p style="color:#fff;text-align:center;margin-top:2rem">No publication specified.</p>'
  throw new Error('No slug')
}

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

function waitForImages(container) {
  // Solo espera las primeras 2 imágenes de página (las visibles al abrir).
  // El resto tiene loading="lazy" y carga en diferido mientras el usuario hojea.
  // Esto reduce el tiempo de inicio de varios segundos a <500 ms en la mayoría de conexiones.
  const sheets = Array.from(container.querySelectorAll('.page [data-bg]')).slice(0, 2)
  return Promise.all(
    sheets.map((el) => new Promise((r) => { const im = new Image(); im.onload = r; im.onerror = r; im.src = el.getAttribute('data-bg') }))
  )
}

function makeBlank(w, h) {
  const d = document.createElement('div')
  d.className = 'page'
  d.style.cssText = `width:${w}px;height:${h}px;background:#1a1a2e;`
  return d
}

// Envía una respuesta (formulario o cuestionario) al repositorio del tenant.
function saveResponse(kind, payload, widgetKey) {
  try {
    fetch(`${API_BASE}/view/${slug}/response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, widget_key: widgetKey || null, payload }),
    }).catch(() => {})
  } catch (e) {}
}

async function init() {
  const res = await fetch(`${API_BASE}/view/${slug}`)
  if (!res.ok) {
    const ls = document.getElementById('loading-screen')
    if (ls) ls.remove()
    document.body.innerHTML = `<p style="color:#fff;text-align:center;margin-top:2rem">Publication not found.</p>`
    return
  }

  const { data } = await res.json()
  document.title = data.title

  // Registrar vista (fire-and-forget — no bloqueamos la carga del flipbook)
  fetch(`${API_BASE}/view/${slug}/track`, { method: 'POST' }).catch(() => {})

  // ── Analítica avanzada (Fase 14): envío fire-and-forget vía sendBeacon ──
  // sendBeacon entrega los datos aunque el usuario cierre la pestaña.
  const EVENT_URL = `${API_BASE}/view/${slug}/event`
  function sendEvent(payload) {
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
    // La hoja se pinta como BACKGROUND-IMAGE (no <img> con transform). Motivo: StPageFlip
    // usa transformaciones 3D (preserve-3d) para voltear, y bajo eso el overflow:hidden NO
    // recorta el transform:scale → la imagen con zoom se desbordaba. Un background siempre
    // se recorta a su caja, sin excepción 3D. El recorte/zoom se replica con
    // background-size + background-position (idéntico a computeCover del editor).
    const sheet = document.createElement('div')
    sheet.style.cssText = 'position:absolute;inset:0;overflow:hidden;background-repeat:no-repeat;background-position:center;background-size:cover;'
    sheet.style.backgroundImage = `url("${page.image_url}")`
    sheet.setAttribute('data-bg', page.image_url)
    // Encuadre manual de la hoja (zoom + posición) elegido en el editor (cover_json).
    // El overlay de elementos es un canvas hermano y NO se ve afectado por esto.
    applyCoverStyle(sheet, page.cover_json, page.image_url, pageWidth / pageHeight)
    div.appendChild(sheet)
    pageDivs.push(div)
    if (page.title || page.price) {
      const label = document.createElement('div')
      label.style.cssText = 'position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.55);color:#fff;padding:6px 10px;font-size:0.75rem;display:flex;justify-content:space-between;'
      if (page.title) { const t = document.createElement('span'); t.textContent = page.title; label.appendChild(t) }
      if (page.price) { const p = document.createElement('span'); p.textContent = page.price; p.style.fontWeight = 'bold'; label.appendChild(p) }
      div.appendChild(label)
    }
    container.appendChild(div)
  })

  // blank final (solo escritorio): contraportada queda sola a la izquierda
  if (!portrait) container.appendChild(makeBlank(pageWidth, pageHeight))

  // Índices de página real dentro del flipbook (incluye blanks en escritorio)
  const firstIdx = lead                 // primera página real
  const lastIdx  = lead + realCount - 1 // última página real

  await waitForImages(container)

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

  // Ocultar la pantalla de carga. El flipbook-container siempre estuvo visible
  // debajo (necesario para que StPageFlip pueda medir sus dimensiones con size:'stretch');
  // el loading-screen es un overlay fixed que lo tapaba mientras se construía.
  const loadingScreen = document.getElementById('loading-screen')
  if (loadingScreen) {
    loadingScreen.classList.add('hidden')
    setTimeout(() => loadingScreen.remove(), 450)
  }

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
        if (a.page) pageFlip.flip(Number(a.page))
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
            spinner.textContent = 'Error al cargar unidades.'
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

  function buildOverlay(div, canvasJson, pageIndex) {
    if (!canvasJson || typeof fabric === 'undefined') return
    let parsed
    try { parsed = typeof canvasJson === 'string' ? JSON.parse(canvasJson) : canvasJson } catch { return }
    if (!parsed || !parsed.objects || !parsed.objects.length) return

    const wrap = document.createElement('div')
    // pointer-events:none en el contenedor — StPageFlip necesita recibir los gestos
    // de arrastre en toda la página. Los elementos interactivos hijos sobreescriben
    // con pointer-events:auto individualmente.
    wrap.style.cssText = `position:absolute;top:0;left:0;width:${DESIGN_W}px;height:${DESIGN_H}px;transform:scale(${overlayScale});transform-origin:top left;pointer-events:none;opacity:0;transition:opacity .35s ease;`
    const cv = document.createElement('canvas')
    cv.style.cssText = 'pointer-events:none;'
    wrap.appendChild(cv)
    div.appendChild(wrap)

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
    fcanvas.loadFromJSON(objectsOnly, () => {
      let widgetIdx = 0
      // slice(): vamos a remover widgets del canvas mientras iteramos
      fcanvas.getObjects().slice().forEach((obj) => {
       try {
        const d = obj.data || {}
        obj.__showHideWrap = wrap
        const r = obj.getBoundingRect(true)

        // Hotspot animado: reemplazar con div CSS
        if (d.kind === 'hotspot') {
          const hsStyle = d.hotspot?.style ?? d.animStyle
          const hsColor = d.hotspot?.color ?? d.color
          const animClass = hsStyle === 'blink' ? 'hs-blink' : hsStyle === 'ripple' ? 'hs-ring' : 'hs-pulse'
          const color = hsColor || '#ef4444'
          const hs = document.createElement('div')
          hs.style.cssText = `position:absolute;left:${r.left + r.width/2 - 18}px;top:${r.top + r.height/2 - 18}px;width:36px;height:36px;cursor:pointer;z-index:7;pointer-events:auto;`
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
      requestAnimationFrame(() => { wrap.style.opacity = '1' })
    })
  }

  // Construye overlays para cada página real (pasa el índice real dentro del flipbook
  // = lead + i, para disparar las animaciones de entrada al mostrarse esa hoja).
  pageDivs.forEach((div, i) => buildOverlay(div, data.pages[i] && data.pages[i].canvas_json, lead + i))

  // Centrado dinámico: cubre/contraportada centradas, spreads interiores sin desplazamiento
  let currentShift = 0
  let currentScale = 1
  function applyTransform() {
    container.style.transform = `translateX(${currentShift}px) scale(${currentScale})`
    container.style.transformOrigin = 'center center'
    container.style.transition = 'transform 0.3s ease'
  }
  // Convierte el índice del flipbook (con blanks) al número de página real (1..realCount)
  const pageNumOf = (idx) => Math.max(1, Math.min(idx - lead + 1, realCount))

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
    currentScale = 1; zoomIdx = 0
    updatePageInfo()
    applyCenter()
    updateNavButtons()
    updateActiveThumbnail()
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
    img.src = page.image_url
    img.alt = `Pág ${i + 1}`
    img.loading = 'lazy'
    const label = document.createElement('span')
    label.textContent = i + 1
    item.appendChild(img)
    item.appendChild(label)
    item.addEventListener('click', () => {
      pageFlip.flip(lead + i)
      document.getElementById('thumbnail-panel').classList.remove('open')
    })
    thumbList.appendChild(item)
  })

  // Autoplay
  let autoplayTimer = null
  function startAutoplay() {
    stopAutoplay()
    autoplayTimer = setInterval(() => {
      const idx = pageFlip.getCurrentPageIndex()
      if (idx >= lastIdx) { stopAutoplay(); return }
      pageFlip.flipNext()
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

  // Zoom simple: cicla entre 3 escalas
  const zoomLevels = [1, 1.5, 2, 2.5, 3]
  let zoomIdx = 0
  document.getElementById('btn-zoom').addEventListener('click', () => {
    zoomIdx = (zoomIdx + 1) % zoomLevels.length
    currentScale = zoomLevels[zoomIdx]
    applyTransform()
  })

  document.getElementById('btn-first').addEventListener('click', () => pageFlip.flip(firstIdx))
  document.getElementById('btn-last').addEventListener('click', () => pageFlip.flip(lastIdx))

  document.getElementById('btn-prev').addEventListener('click', () => {
    const idx = pageFlip.getCurrentPageIndex()
    if (idx > firstIdx) pageFlip.flipPrev()
  })

  document.getElementById('btn-next').addEventListener('click', () => {
    const idx = pageFlip.getCurrentPageIndex()
    if (idx < lastIdx) pageFlip.flipNext()
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
}

init().catch((err) => console.error('Flipbook init error:', err))

// Al rotar el dispositivo o redimensionar la ventana, recargar para recalcular dimensiones.
// Se espera 400ms para que el viewport termine de acomodarse antes de recargar.
let resizeTimer
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => location.reload(), 400)
})
