const API_BASE = window.__FLIPBOOK_CONFIG__?.apiBase ?? 'https://intap-flipbook-api.fliaprince.workers.dev'

const slug = location.pathname.split('/').filter(Boolean).pop()
if (!slug) {
  document.body.innerHTML = '<p style="color:#fff;text-align:center;margin-top:2rem">No publication specified.</p>'
  throw new Error('No slug')
}

let soundEnabled = true
const flipSound = new Audio('https://cdn.freesound.org/previews/242/242501_4284968-lq.mp3')
flipSound.volume = 0.4

function waitForImages(imgs) {
  return Promise.all(
    Array.from(imgs).map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete) resolve()
          else { img.onload = resolve; img.onerror = resolve }
        }),
    ),
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

  const container = document.getElementById('flipbook')
  const portrait = window.innerWidth < 700
  const pageWidth = portrait
    ? Math.min(380, window.innerWidth - 20)
    : Math.min(480, Math.floor(window.innerWidth / 2) - 40)
  const pageHeight = Math.floor(pageWidth * 1.414)

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
      label.style.cssText =
        'position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.55);color:#fff;' +
        'padding:6px 10px;font-size:0.75rem;display:flex;justify-content:space-between;'
      if (page.title) {
        const t = document.createElement('span')
        t.textContent = page.title
        label.appendChild(t)
      }
      if (page.price) {
        const p = document.createElement('span')
        p.textContent = page.price
        p.style.fontWeight = 'bold'
        label.appendChild(p)
      }
      div.appendChild(label)
    }

    container.appendChild(div)
  })

  // Esperar que todas las imágenes carguen antes de inicializar StPageFlip
  await waitForImages(container.querySelectorAll('img'))

  const pageFlip = new St.PageFlip(container, {
    width: pageWidth,
    height: pageHeight,
    showCover: true,
    mobileScrollSupport: false,
    usePortrait: portrait,
    drawShadow: true,
    maxShadowOpacity: 0.6,
    flippingTime: 700,
    startPage: 0,
    useMouseEvents: true,
  })

  pageFlip.loadFromHTML(document.querySelectorAll('.page'))

  pageFlip.on('flip', () => {
    if (soundEnabled) {
      flipSound.currentTime = 0
      flipSound.play().catch(() => {})
    }
    updatePageInfo(pageFlip)
  })

  updatePageInfo(pageFlip)

  document.getElementById('btn-prev').addEventListener('click', () => pageFlip.flipPrev())
  document.getElementById('btn-next').addEventListener('click', () => pageFlip.flipNext())
  document.getElementById('btn-sound').addEventListener('click', () => {
    soundEnabled = !soundEnabled
    updateSoundBtn()
  })

  window.addEventListener('resize', () => {
    const p = window.innerWidth < 700
    pageFlip.updateState({ orientation: p ? 'portrait' : 'landscape' })
  })
}

function updatePageInfo(pf) {
  const el = document.getElementById('page-info')
  const current = pf.getCurrentPageIndex() + 1
  const total = pf.getPageCount()
  el.textContent = `${current} / ${total}`
}

function updateSoundBtn() {
  document.getElementById('btn-sound').textContent = soundEnabled ? '🔊' : '🔇'
}

init().catch((err) => console.error('Flipbook init error:', err))
