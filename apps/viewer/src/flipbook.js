const API_BASE = window.__FLIPBOOK_CONFIG__?.apiBase ?? 'https://intap-flipbook-api.fliaprince.workers.dev'

const slug = location.pathname.split('/').filter(Boolean).pop()
if (!slug) {
  document.body.innerHTML = '<p style="color:#fff;text-align:center;margin-top:2rem">No publication specified.</p>'
  throw new Error('No slug')
}

let soundEnabled = true
const flipSound = new Audio('https://cdn.freesound.org/previews/242/242501_4284968-lq.mp3')
flipSound.volume = 0.4

function waitForImages(container) {
  return Promise.all(
    Array.from(container.querySelectorAll('img')).map(
      (img) => new Promise((r) => { if (img.complete) r(); else { img.onload = r; img.onerror = r } })
    )
  )
}

// Página invisible (color fondo) para acompañar portada/contraportada
function makeBlank(w, h) {
  const d = document.createElement('div')
  d.className = 'page'
  d.style.cssText = `width:${w}px;height:${h}px;background:#1a1a2e;`
  return d
}

async function init() {
  const res = await fetch(`${API_BASE}/view/${slug}`)
  if (!res.ok) {
    document.body.innerHTML = `<p style="color:#fff;text-align:center;margin-top:2rem">Publication not found.</p>`
    return
  }

  const { data } = await res.json()
  document.title = data.title
  soundEnabled = data.sound_enabled
  updateSoundBtn()

  const portrait = window.innerWidth < 700
  const pageWidth = portrait
    ? Math.min(340, window.innerWidth - 24)
    : Math.min(440, Math.floor(window.innerWidth / 2) - 60)
  const pageHeight = Math.floor(pageWidth * 1.414)
  const realCount = data.pages.length

  const container = document.getElementById('flipbook')

  // índice 0: blank invisible → portada (idx 1) queda sola en lado derecho
  container.appendChild(makeBlank(pageWidth, pageHeight))

  // índices 1..realCount: páginas reales
  data.pages.forEach((page) => {
    const div = document.createElement('div')
    div.className = 'page'
    div.style.cssText = `width:${pageWidth}px;height:${pageHeight}px;overflow:hidden;background:#fff;position:relative;`
    const img = document.createElement('img')
    img.src = page.image_url
    img.alt = page.title ?? `Página ${page.page_number}`
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;'
    div.appendChild(img)
    if (page.title || page.price) {
      const label = document.createElement('div')
      label.style.cssText = 'position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.55);color:#fff;padding:6px 10px;font-size:0.75rem;display:flex;justify-content:space-between;'
      if (page.title) { const t = document.createElement('span'); t.textContent = page.title; label.appendChild(t) }
      if (page.price) { const p = document.createElement('span'); p.textContent = page.price; p.style.fontWeight = 'bold'; label.appendChild(p) }
      div.appendChild(label)
    }
    container.appendChild(div)
  })

  // índice realCount+1: blank invisible → contraportada (idx realCount) queda sola en lado izquierdo
  container.appendChild(makeBlank(pageWidth, pageHeight))

  await waitForImages(container)

  // showCover: false → TODAS las páginas tienen el efecto de hoja flexible
  const pageFlip = new St.PageFlip(container, {
    width: pageWidth,
    height: pageHeight,
    showCover: false,
    drawShadow: true,
    maxShadowOpacity: 0.3,
    flippingTime: 900,
    mobileScrollSupport: false,
    usePortrait: portrait,
    size: 'fixed',
    autoSize: false,
  })

  pageFlip.loadFromHTML(container.querySelectorAll('.page'))

  // Centrado dinámico:
  // El libro siempre ocupa 2×pageWidth. Cuando el spread tiene una página invisible,
  // desplazamos el libro para centrar la página visible.
  //
  // Primer spread [blank(izq) | portada(der)]: desplazar -pageWidth/2 (book va a la izquierda, portada queda centrada)
  // Último spread [contraportada(izq) | blank(der)]: desplazar +pageWidth/2 (book va a la derecha, contraportada queda centrada)
  // Spreads interiores: sin desplazamiento
  function applyCenter() {
    if (portrait) return
    const idx = pageFlip.getCurrentPageIndex()
    const shift = idx <= 0 ? -(pageWidth / 2)
      : idx >= realCount ? (pageWidth / 2)
      : 0
    container.style.transform = `translateX(${shift}px)`
    container.style.transition = 'transform 0.35s ease'
  }

  function updatePageInfo() {
    const idx = pageFlip.getCurrentPageIndex()
    // idx 0 = blank inicial, idx 1..realCount = páginas reales, idx realCount+1 = blank final
    const current = Math.max(1, Math.min(idx, realCount))
    document.getElementById('page-info').textContent = `${current} / ${realCount}`
  }

  pageFlip.on('flip', () => {
    if (soundEnabled) { flipSound.currentTime = 0; flipSound.play().catch(() => {}) }
    updatePageInfo()
    applyCenter()
  })

  pageFlip.on('changeState', () => {
    updatePageInfo()
    applyCenter()
  })

  applyCenter()
  updatePageInfo()

  document.getElementById('btn-prev').addEventListener('click', () => pageFlip.flipPrev())
  document.getElementById('btn-next').addEventListener('click', () => pageFlip.flipNext())
  document.getElementById('btn-sound').addEventListener('click', () => {
    soundEnabled = !soundEnabled
    updateSoundBtn()
  })
}

function updateSoundBtn() {
  document.getElementById('btn-sound').textContent = soundEnabled ? '🔊' : '🔇'
}

init().catch((err) => console.error('Flipbook init error:', err))
