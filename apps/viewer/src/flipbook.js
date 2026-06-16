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

function waitForImages(container) {
  return Promise.all(
    Array.from(container.querySelectorAll('img')).map(
      (img) => new Promise((r) => { if (img.complete) r(); else { img.onload = r; img.onerror = r } })
    )
  )
}

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

  // Sonido siempre habilitado independientemente del plan
  soundEnabled = true

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
  const pageDivs = []
  data.pages.forEach((page) => {
    const div = document.createElement('div')
    div.className = 'page'
    div.style.cssText = `width:${pageWidth}px;height:${pageHeight}px;overflow:hidden;background:#fff;position:relative;`
    const img = document.createElement('img')
    img.src = page.image_url
    img.alt = page.title ?? `Página ${page.page_number}`
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;'
    div.appendChild(img)
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

  // índice realCount+1: blank invisible → contraportada (idx realCount) queda sola en lado izquierdo
  container.appendChild(makeBlank(pageWidth, pageHeight))

  await waitForImages(container)

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

  // ── Overlays de elementos del editor + acciones interactivas ──
  // El editor diseña a 580×820 px; aquí escalamos a la página real del viewer.
  const DESIGN_W = 580
  const DESIGN_H = Math.round(DESIGN_W * 1.414)
  const overlayScale = pageWidth / DESIGN_W

  function runAction(a) {
    if (!a || !a.type) return
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
        const im = document.createElement('img')
        im.src = a.image
        im.style.cssText = 'max-width:80vw;max-height:80vh;display:block;border-radius:8px;'
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
      case 'download': {
        if (!a.url) break
        const link = document.createElement('a')
        link.href = a.url; link.download = a.filename || ''; link.target = '_blank'
        document.body.appendChild(link); link.click(); document.body.removeChild(link)
        break
      }
      case 'show_hide':
        break
    }
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
  function ytId(u) { const m = (u || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/); return m ? m[1] : null }
  function vimeoId(u) { const m = (u || '').match(/vimeo\.com\/(\d+)/); return m ? m[1] : null }

  function buildContactForm(cfg) {
    const f = document.createElement('form')
    f.style.cssText = 'display:flex;flex-direction:column;gap:6px;width:100%;height:100%;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px;box-sizing:border-box;font-family:Inter,sans-serif;overflow:auto;'
    const title = document.createElement('div')
    title.textContent = cfg.title || 'Contáctanos'
    title.style.cssText = 'font-weight:700;font-size:13px;color:#111827;'
    const name = makeInput('Nombre *', 'text'); name.required = true
    const email = makeInput('Email *', 'email'); email.required = true
    const phone = makeInput('Teléfono', 'tel'); phone.required = !!cfg.requirePhone
    const msg = document.createElement('textarea')
    msg.placeholder = (cfg.commentLabel || 'Mensaje') + (cfg.requireComment !== false ? ' *' : '')
    msg.required = cfg.requireComment !== false
    msg.style.cssText = INP_CSS + 'resize:none;flex:1;min-height:34px;'
    const btn = document.createElement('button'); btn.type = 'submit'; btn.textContent = cfg.button || 'Enviar'
    btn.style.cssText = 'background:#4F46E5;color:#fff;border:none;border-radius:6px;padding:8px;font-weight:600;cursor:pointer;font-size:12px;'
    f.append(title, name, email)
    if (cfg.showPhone !== false) f.appendChild(phone)
    f.append(msg, btn)
    f.addEventListener('submit', (e) => {
      e.preventDefault()
      const body = `Nombre: ${name.value}\nEmail: ${email.value}\nTeléfono: ${phone.value}\n\n${msg.value}`
      window.location.href = `mailto:${cfg.toEmail || ''}?subject=${encodeURIComponent(cfg.subject || 'Contacto desde catálogo')}&body=${encodeURIComponent(body)}`
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

  function buildWidget(widget, w, h, key) {
    const cfg = widget.config || {}
    switch (widget.type) {
      case 'map': {
        const query = cfg.mapsUrl || (cfg.address ? `https://www.google.com/maps?q=${encodeURIComponent(cfg.address)}&z=${cfg.zoom || 14}&output=embed` : null)
        if (!query) return placeholderBox('Mapa (sin dirección)')
        // si es URL completa de Maps, usarla directo; si es dirección, embed
        const src = query.startsWith('http') ? query : `https://www.google.com/maps?q=${encodeURIComponent(query)}&z=${cfg.zoom || 14}&output=embed`
        return widgetFrame(src)
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
          const v = document.createElement('video')
          v.src = cfg.url; v.controls = cfg.controls !== false; v.muted = !!cfg.muted
          v.autoplay = !!cfg.autoplay; v.loop = !!cfg.loop
          if (cfg.poster) v.poster = cfg.poster
          v.style.cssText = 'width:100%;height:100%;border-radius:8px;background:#000;'
          return v
        }
        return placeholderBox('Video (sin URL)')
      }
      case 'audio': {
        if (!cfg.url) return placeholderBox('Audio (sin URL)')
        const box = centerBox()
        const color = cfg.playerColor || '#4F46E5'
        box.style.cssText += `background:${color}18;border-radius:12px;`
        const a = document.createElement('audio')
        a.src = cfg.url; a.controls = true
        if (cfg.autoplay) a.autoplay = true
        if (cfg.loop) a.loop = true
        a.style.cssText = 'width:90%;accent-color:' + color
        box.appendChild(a)
        return box
      }
      case 'whatsapp': {
        const phone = String(cfg.phone || '').replace(/\D/g, '')
        const a = document.createElement('a')
        a.href = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(cfg.message || '')}` : 'javascript:void(0)'
        a.target = '_blank'
        a.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:100%;background:#25D366;color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;font-family:Inter,sans-serif;'
        a.innerHTML = `<span style="font-size:18px">✆</span> ${cfg.label || 'WhatsApp'}`
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
      case 'contact': return buildContactForm(cfg)
      case 'table': return buildTable(cfg.csv || '')
      case 'like': return buildLike(cfg, key)
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
          qLabel.textContent = `${qi + 1}. ${q.question}`
          qLabel.style.cssText = 'font-size:12px;font-weight:600;color:#374151;'
          qWrap.appendChild(qLabel)
          ;(q.options || []).forEach((opt, oi) => {
            const row = document.createElement('label')
            row.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;color:#374151;cursor:pointer;'
            const inp = document.createElement('input')
            inp.type = q.multiple ? 'checkbox' : 'radio'
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
          btn.textContent = '✓ Respuestas guardadas'
          btn.disabled = true
        })
        wrap.appendChild(btn)
        return wrap
      }
      case 'popup_banner': {
        // El banner global se registra y se muestra después del delay
        scheduleBanner(cfg, key)
        return null
      }
      default: return placeholderBox(widget.type)
    }
  }

  // ── Banner popup emergente (cintillo) ──────────────────────────────────────
  const shownBanners = new Set()
  function scheduleBanner(cfg, key) {
    if (shownBanners.has(key)) return
    shownBanners.add(key)
    const delay = cfg.trigger === 'immediate' ? 0 : (parseInt(cfg.delay || '3', 10) * 1000)
    setTimeout(() => showBanner(cfg), delay)
  }
  function showBanner(cfg) {
    if (document.getElementById('flipbook-banner')) return
    const pos = cfg.position || 'bottom'
    const animMap = { bottom: 'pb-in-b', top: 'pb-in-t', center: 'pb-in-c' }
    const posMap = {
      bottom: 'position:fixed;bottom:0;left:0;right:0;',
      top:    'position:fixed;top:0;left:0;right:0;',
      center: 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.4);',
    }
    const outer = document.createElement('div')
    outer.id = 'flipbook-banner'
    outer.style.cssText = `z-index:2000;${posMap[pos] || posMap.bottom}`
    const inner = document.createElement('div')
    inner.style.cssText = `background:${cfg.bgColor || '#1a1827'};color:${cfg.textColor || '#fff'};padding:16px 20px;display:flex;align-items:center;gap:16px;font-family:Inter,sans-serif;animation:${animMap[pos] || animMap.bottom} 0.35s ease-out;${pos === 'center' ? 'border-radius:12px;max-width:480px;width:90%;flex-direction:column;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5);' : 'justify-content:space-between;'}`
    if (cfg.image) {
      const img = document.createElement('img')
      img.src = cfg.image; img.style.cssText = 'width:52px;height:52px;object-fit:cover;border-radius:8px;flex-shrink:0;'
      inner.appendChild(img)
    }
    const textWrap = document.createElement('div')
    textWrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;flex:1;'
    if (cfg.title) { const t = document.createElement('div'); t.textContent = cfg.title; t.style.cssText = 'font-weight:700;font-size:15px;'; textWrap.appendChild(t) }
    if (cfg.text) { const t = document.createElement('div'); t.textContent = cfg.text; t.style.cssText = 'font-size:13px;opacity:.85;'; textWrap.appendChild(t) }
    inner.appendChild(textWrap)
    if (cfg.buttonText) {
      const btn = document.createElement('button')
      btn.textContent = cfg.buttonText
      btn.style.cssText = `background:${cfg.buttonColor || '#4F46E5'};color:#fff;border:none;border-radius:8px;padding:9px 18px;font-weight:700;cursor:pointer;font-size:13px;white-space:nowrap;flex-shrink:0;`
      if (cfg.buttonUrl) btn.addEventListener('click', () => window.open(cfg.buttonUrl, '_blank'))
      inner.appendChild(btn)
    }
    const close = document.createElement('button')
    close.textContent = '✕'
    close.style.cssText = 'background:none;border:none;color:inherit;opacity:.6;cursor:pointer;font-size:16px;padding:0 4px;flex-shrink:0;'
    close.addEventListener('click', () => outer.remove())
    inner.appendChild(close)
    outer.appendChild(inner)
    document.body.appendChild(outer)
    // Auto-dismiss
    if (cfg.autoDismiss && parseInt(cfg.autoDismiss, 10) > 0) {
      setTimeout(() => outer.remove(), parseInt(cfg.autoDismiss, 10) * 1000)
    }
  }

  function buildOverlay(div, canvasJson) {
    if (!canvasJson || typeof fabric === 'undefined') return
    let parsed
    try { parsed = typeof canvasJson === 'string' ? JSON.parse(canvasJson) : canvasJson } catch { return }
    if (!parsed || !parsed.objects || !parsed.objects.length) return

    const wrap = document.createElement('div')
    wrap.style.cssText = `position:absolute;top:0;left:0;width:${DESIGN_W}px;height:${DESIGN_H}px;transform:scale(${overlayScale});transform-origin:top left;`
    const cv = document.createElement('canvas')
    cv.style.cssText = 'pointer-events:none;'
    wrap.appendChild(cv)
    div.appendChild(wrap)

    const fcanvas = new fabric.StaticCanvas(cv, { width: DESIGN_W, height: DESIGN_H })
    // Sin fondo: la imagen de la página ya está debajo
    const objectsOnly = Object.assign({}, parsed, { background: '', backgroundImage: null })
    fcanvas.loadFromJSON(objectsOnly, () => {
      let widgetIdx = 0
      // slice(): vamos a remover widgets del canvas mientras iteramos
      fcanvas.getObjects().slice().forEach((obj) => {
        const d = obj.data || {}
        const r = obj.getBoundingRect(true)

        // Hotspot animado: reemplazar con div CSS
        if (d.kind === 'hotspot') {
          const animClass = d.animStyle === 'blink' ? 'hs-blink' : d.animStyle === 'ripple' ? 'hs-ring' : 'hs-pulse'
          const color = d.color || '#ef4444'
          const hs = document.createElement('div')
          hs.style.cssText = `position:absolute;left:${r.left + r.width/2 - 18}px;top:${r.top + r.height/2 - 18}px;width:36px;height:36px;cursor:pointer;z-index:7;`
          hs.innerHTML = `<div class="${animClass}" style="width:36px;height:36px;border-radius:50%;background:${color}44;border:2.5px solid ${color};display:flex;align-items:center;justify-content:center;"><div style="width:14px;height:14px;border-radius:50%;background:${color};"></div></div>`
          if (d.action) hs.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); runAction(d.action) })
          wrap.appendChild(hs)
          fcanvas.remove(obj)
          return
        }

        // Widget: renderiza el componente real y oculta el placeholder del editor
        if (d.widget) {
          const node = buildWidget(d.widget, r.width, r.height, `${slug}_${widgetIdx++}`)
          if (node) {
            const holder = document.createElement('div')
            holder.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:6;`
            holder.appendChild(node)
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
        hot.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;cursor:pointer;z-index:5;`
        hot.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); runAction(action) })
        wrap.appendChild(hot)
      })
      fcanvas.renderAll()
    })
  }

  // Construye overlays para cada página real
  pageDivs.forEach((div, i) => buildOverlay(div, data.pages[i] && data.pages[i].canvas_json))

  // Centrado dinámico: cubre/contraportada centradas, spreads interiores sin desplazamiento
  let currentShift = 0
  let currentScale = 1
  function applyTransform() {
    container.style.transform = `translateX(${currentShift}px) scale(${currentScale})`
    container.style.transformOrigin = 'center center'
    container.style.transition = 'transform 0.35s ease'
  }
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
    const current = Math.max(1, Math.min(idx, realCount))
    document.getElementById('page-info').textContent = `${current} / ${realCount}`
  }

  // Actualiza estado habilitado/deshabilitado de los botones de navegación
  function updateNavButtons() {
    const idx = pageFlip.getCurrentPageIndex()
    document.getElementById('btn-prev').disabled = idx <= 1
    document.getElementById('btn-next').disabled = idx >= realCount
  }

  // Actualiza miniatura activa
  function updateActiveThumbnail() {
    const idx = pageFlip.getCurrentPageIndex()
    const current = Math.max(1, Math.min(idx, realCount))
    document.querySelectorAll('.thumb-item').forEach((el, i) => {
      el.classList.toggle('active', i + 1 === current)
    })
  }

  function onFlipChange() {
    const idx = pageFlip.getCurrentPageIndex()
    // Si el swipe/drag llegó a una página en blanco, volver a la real más cercana
    if (idx <= 0) { pageFlip.flip(1); return }
    if (idx > realCount) { pageFlip.flip(realCount); return }
    playFlipSound()
    updatePageInfo()
    applyCenter()
    updateNavButtons()
    updateActiveThumbnail()
  }

  pageFlip.on('flip', onFlipChange)
  pageFlip.on('changeState', () => {
    updatePageInfo()
    applyCenter()
    updateNavButtons()
    updateActiveThumbnail()
  })

  applyCenter()
  updatePageInfo()
  updateNavButtons()

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
      pageFlip.flip(i + 1)
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
      if (idx >= realCount) { stopAutoplay(); return }
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
  const zoomLevels = [1, 1.25, 1.5]
  let zoomIdx = 0
  document.getElementById('btn-zoom').addEventListener('click', () => {
    zoomIdx = (zoomIdx + 1) % zoomLevels.length
    currentScale = zoomLevels[zoomIdx]
    applyTransform()
  })

  document.getElementById('btn-first').addEventListener('click', () => pageFlip.flip(1))
  document.getElementById('btn-last').addEventListener('click', () => pageFlip.flip(realCount))

  document.getElementById('btn-prev').addEventListener('click', () => {
    const idx = pageFlip.getCurrentPageIndex()
    if (idx > 1) pageFlip.flipPrev()
  })

  document.getElementById('btn-next').addEventListener('click', () => {
    const idx = pageFlip.getCurrentPageIndex()
    if (idx < realCount) pageFlip.flipNext()
  })

  document.getElementById('btn-autoplay').addEventListener('click', () => {
    autoplayTimer ? stopAutoplay() : startAutoplay()
  })

  document.getElementById('btn-share').addEventListener('click', () => {
    const url = location.href
    if (navigator.share) {
      navigator.share({ title: data.title, url }).catch(() => {})
    } else {
      navigator.clipboard.writeText(url).then(() => {
        const btn = document.getElementById('btn-share')
        btn.textContent = '✓'
        setTimeout(() => { btn.textContent = '↗' }, 1500)
      })
    }
  })

  document.getElementById('btn-thumbnails').addEventListener('click', () => {
    document.getElementById('thumbnail-panel').classList.toggle('open')
  })

  document.getElementById('btn-print').addEventListener('click', () => window.print())

  document.getElementById('btn-fullscreen').addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen().catch(() => {})
    }
  })

  document.addEventListener('fullscreenchange', () => {
    document.getElementById('btn-fullscreen').textContent = document.fullscreenElement ? '⛶' : '⛶'
    document.getElementById('btn-fullscreen').title = document.fullscreenElement ? 'Salir de pantalla completa' : 'Pantalla completa'
  })

  // Cerrar panel de miniaturas al hacer clic fuera
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('thumbnail-panel')
    const btn = document.getElementById('btn-thumbnails')
    if (panel.classList.contains('open') && !panel.contains(e.target) && e.target !== btn) {
      panel.classList.remove('open')
    }
  })
}

init().catch((err) => console.error('Flipbook init error:', err))
