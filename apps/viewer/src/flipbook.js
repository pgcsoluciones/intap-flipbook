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

  const container = document.getElementById('flipbook')
  const totalPages = data.pages.length

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

  await waitForImages(container)

  // showCover:true → portada y contraportada se muestran solas (como en FlipHTML5)
  // El centrado dinámico compensa que StPageFlip siempre reserva 2×pageWidth
  const pageFlip = new St.PageFlip(container, {
    width: pageWidth,
    height: pageHeight,
    showCover: true,
    drawShadow: true,
    maxShadowOpacity: 0.4,
    flippingTime: 900,
    mobileScrollSupport: false,
    usePortrait: portrait,
    size: 'fixed',
    autoSize: false,
  })

  pageFlip.loadFromHTML(container.querySelectorAll('.page'))

  // Centrado dinámico:
  // - Portada (idx 0): contenido en mitad DERECHA → desplazar el flipbook -pageWidth/2 hacia la izquierda
  // - Páginas interiores: centrado normal
  // - Contraportada (idx totalPages-1): contenido en mitad IZQUIERDA → desplazar +pageWidth/2
  function applyCenter() {
    if (portrait) return
    const idx = pageFlip.getCurrentPageIndex()
    const shift = idx === 0
      ? -(pageWidth / 2)
      : idx >= totalPages - 1
      ? pageWidth / 2
      : 0
    container.style.transform = `translateX(${shift}px)`
    container.style.transition = 'transform 0.3s ease'
  }

  pageFlip.on('flip', () => {
    if (soundEnabled) { flipSound.currentTime = 0; flipSound.play().catch(() => {}) }
    updatePageInfo(pageFlip, totalPages)
    applyCenter()
  })

  pageFlip.on('changeState', () => applyCenter())

  applyCenter()
  updatePageInfo(pageFlip, totalPages)

  document.getElementById('btn-prev').addEventListener('click', () => pageFlip.flipPrev())
  document.getElementById('btn-next').addEventListener('click', () => pageFlip.flipNext())
  document.getElementById('btn-sound').addEventListener('click', () => {
    soundEnabled = !soundEnabled
    updateSoundBtn()
  })
}

function updatePageInfo(pf, total) {
  const el = document.getElementById('page-info')
  el.textContent = `${pf.getCurrentPageIndex() + 1} / ${total}`
}

function updateSoundBtn() {
  document.getElementById('btn-sound').textContent = soundEnabled ? '🔊' : '🔇'
}

init().catch((err) => console.error('Flipbook init error:', err))
