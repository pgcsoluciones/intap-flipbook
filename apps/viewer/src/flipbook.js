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
      (img) => new Promise((resolve) => {
        if (img.complete) resolve()
        else { img.onload = resolve; img.onerror = resolve }
      })
    )
  )
}

function makePage(pageWidth, pageHeight, bg = '#fff') {
  const div = document.createElement('div')
  div.className = 'page'
  div.style.cssText = `width:${pageWidth}px;height:${pageHeight}px;background:${bg};flex-shrink:0;`
  return div
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
  const realCount = data.pages.length

  // Página en blanco al inicio → portada queda sola a la DERECHA (libro cerrado)
  container.appendChild(makePage(pageWidth, pageHeight, '#f0f0ea'))

  // Páginas reales
  data.pages.forEach((page) => {
    const div = makePage(pageWidth, pageHeight)
    const img = document.createElement('img')
    img.src = page.image_url
    img.alt = page.title ?? `Página ${page.page_number}`
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;'
    div.appendChild(img)

    if (page.title || page.price) {
      const label = document.createElement('div')
      label.style.cssText =
        'position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.55);' +
        'color:#fff;padding:6px 10px;font-size:0.75rem;display:flex;justify-content:space-between;'
      div.style.position = 'relative'
      if (page.title) { const t = document.createElement('span'); t.textContent = page.title; label.appendChild(t) }
      if (page.price) { const p = document.createElement('span'); p.textContent = page.price; p.style.fontWeight = 'bold'; label.appendChild(p) }
      div.appendChild(label)
    }

    container.appendChild(div)
  })

  // Página en blanco al final → contraportada queda sola a la IZQUIERDA (libro cerrando)
  container.appendChild(makePage(pageWidth, pageHeight, '#f0f0ea'))

  await waitForImages(container)

  const pageFlip = new St.PageFlip(container, {
    width: pageWidth,
    height: pageHeight,
    showCover: false,      // false = todas las páginas flexibles, sin distinción rígida
    drawShadow: true,
    maxShadowOpacity: 0.3,
    flippingTime: 900,
    mobileScrollSupport: false,
    usePortrait: portrait,
    size: 'fixed',
    autoSize: false,
  })

  pageFlip.loadFromHTML(container.querySelectorAll('.page'))

  pageFlip.on('flip', () => {
    if (soundEnabled) { flipSound.currentTime = 0; flipSound.play().catch(() => {}) }
    updatePageInfo(pageFlip, realCount)
  })

  updatePageInfo(pageFlip, realCount)

  document.getElementById('btn-prev').addEventListener('click', () => pageFlip.flipPrev())
  document.getElementById('btn-next').addEventListener('click', () => pageFlip.flipNext())
  document.getElementById('btn-sound').addEventListener('click', () => {
    soundEnabled = !soundEnabled
    updateSoundBtn()
  })
}

function updatePageInfo(pf, realCount) {
  const el = document.getElementById('page-info')
  // idx 0 = blank inicial, idx 1..realCount = páginas reales, idx realCount+1 = blank final
  const idx = pf.getCurrentPageIndex()
  const page = Math.max(0, Math.min(idx, realCount))
  el.textContent = `${page} / ${realCount}`
}

function updateSoundBtn() {
  document.getElementById('btn-sound').textContent = soundEnabled ? '🔊' : '🔇'
}

init().catch((err) => console.error('Flipbook init error:', err))
