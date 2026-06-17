import React from 'react'

/**
 * WidgetPreview — vista previa fiel de cada widget tal como se verá en la
 * publicación (viewer). El editor usa Fabric.js (un canvas de dibujo) y no
 * puede mostrar HTML interactivo dentro del lienzo, así que aquí renderizamos
 * el componente real en una capa flotante para que el usuario lo vea y ajuste
 * sin tener que publicar.
 *
 * Refleja la lógica de `apps/viewer/src/flipbook.js → buildWidget`.
 */

function ytId(u = ''): string | null {
  const m = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/)
  return m ? m[1] : null
}
function vimeoId(u = ''): string | null {
  const m = u.match(/vimeo\.com\/(\d+)/)
  return m ? m[1] : null
}

const PH: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
  background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 8, color: '#94a3b8',
  fontSize: 13, fontFamily: 'Inter, sans-serif', padding: 12, width: '100%', height: '100%',
}
const INP: React.CSSProperties = {
  border: '1px solid #d1d5db', borderRadius: 6, padding: '7px 9px', fontSize: 12,
  fontFamily: 'Inter, sans-serif', boxSizing: 'border-box', width: '100%',
}

function Body({ type, config }: { type: string; config: any }) {
  const cfg = config || {}

  switch (type) {
    case 'map': {
      const query = cfg.mapsUrl || (cfg.address ? `https://www.google.com/maps?q=${encodeURIComponent(cfg.address)}&z=${cfg.zoom || 14}&output=embed` : null)
      if (!query) return <div style={PH}>Mapa (sin dirección)</div>
      const src = query.startsWith('http') ? query : `https://www.google.com/maps?q=${encodeURIComponent(query)}&z=${cfg.zoom || 14}&output=embed`
      return <iframe src={src} style={{ width: '100%', height: '100%', border: 0, borderRadius: 8 }} />
    }
    case 'video': {
      const yt = ytId(cfg.url), vm = vimeoId(cfg.url)
      const params: string[] = []
      if (cfg.autoplay) params.push('autoplay=1')
      if (!cfg.controls && cfg.controls !== undefined) params.push('controls=0')
      if (cfg.muted) params.push('mute=1')
      if (cfg.loop) params.push('loop=1')
      const qs = params.length ? '?' + params.join('&') : ''
      if (yt) return <iframe src={`https://www.youtube.com/embed/${yt}${qs}`} allowFullScreen style={{ width: '100%', height: '100%', border: 0, borderRadius: 8 }} />
      if (vm) return <iframe src={`https://player.vimeo.com/video/${vm}${qs}`} allowFullScreen style={{ width: '100%', height: '100%', border: 0, borderRadius: 8 }} />
      if (cfg.url) return <video src={cfg.url} controls={cfg.controls !== false} muted={!!cfg.muted} loop={!!cfg.loop} poster={cfg.poster || undefined} style={{ width: '100%', height: '100%', borderRadius: 8, background: '#000' }} />
      return <div style={PH}>Video (sin URL)</div>
    }
    case 'audio': {
      if (!cfg.url) return <div style={PH}>Audio (sin URL)</div>
      const color = cfg.playerColor || '#4F46E5'
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', background: `${color}18`, borderRadius: 12 }}>
          <audio src={cfg.url} controls loop={!!cfg.loop} style={{ width: '90%', accentColor: color }} />
        </div>
      )
    }
    case 'whatsapp': {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: '100%', background: '#25D366', color: '#fff', borderRadius: 10, fontWeight: 700, fontSize: 15, fontFamily: 'Inter, sans-serif' }}>
          <span style={{ fontSize: 18 }}>✆</span> {cfg.label || 'WhatsApp'}
        </div>
      )
    }
    case 'qr': {
      const dataStr = cfg.data || location.href
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', height: '100%' }}>
          <img src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(dataStr)}`} style={{ maxWidth: '100%', maxHeight: '80%', objectFit: 'contain' }} />
          {cfg.caption && <div style={{ fontSize: 11, color: '#374151', fontFamily: 'Inter, sans-serif' }}>{cfg.caption}</div>}
        </div>
      )
    }
    case 'table': {
      const rows = String(cfg.csv || '').split('\n').filter((r) => r.trim())
      return (
        <div style={{ width: '100%', height: '100%', overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'Inter, sans-serif', fontSize: 12 }}>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.split(',').map((cell, ci) => {
                    const Tag = (ri === 0 ? 'th' : 'td') as any
                    return <Tag key={ci} style={{ border: '1px solid #e5e7eb', padding: '6px 8px', textAlign: 'left', ...(ri === 0 ? { background: '#f3f4f6', fontWeight: 700 } : {}) }}>{cell.trim()}</Tag>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    case 'like': {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
          <button style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 24, padding: '8px 16px', cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 13, color: '#ef4444' }}>
            <span style={{ fontSize: 16 }}>♥</span> {cfg.label || 'Me gusta'} <span style={{ color: '#6b7280' }}>(0)</span>
          </button>
        </div>
      )
    }
    case 'download': {
      if (!cfg.url) return <div style={PH}>Descarga (sin archivo)</div>
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: '100%', background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, boxSizing: 'border-box' }}>
          {cfg.title && <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', fontFamily: 'Inter, sans-serif', textAlign: 'center' }}>{cfg.title}</div>}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: cfg.buttonColor || '#4F46E5', color: '#fff', borderRadius: 8, padding: '9px 18px', fontWeight: 700, fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
            <span style={{ fontSize: 16 }}>⬇</span> {cfg.button || 'Descargar'}
          </span>
        </div>
      )
    }
    case 'embed': {
      if (!cfg.html) return <div style={PH}>Incrustar (sin código)</div>
      return <div style={{ width: '100%', height: '100%', overflow: 'auto', borderRadius: 8 }} dangerouslySetInnerHTML={{ __html: cfg.html }} />
    }
    case 'contact': {
      return (
        <form onSubmit={(e) => e.preventDefault()} style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', height: '100%', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, boxSizing: 'border-box', fontFamily: 'Inter, sans-serif', overflow: 'auto' }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#111827' }}>{cfg.title || 'Contáctanos'}</div>
          <input style={INP} placeholder={'Nombre' + (cfg.nameRequired !== false ? ' *' : '')} />
          <input style={INP} placeholder={'Email' + (cfg.emailRequired !== false ? ' *' : '')} />
          {cfg.showPhone !== false && <input style={INP} placeholder={'Teléfono' + (cfg.phoneRequired ? ' *' : '')} />}
          {cfg.showComment !== false && <textarea style={{ ...INP, resize: 'none', flex: 1, minHeight: 40 }} placeholder={'Comentario' + (cfg.commentRequired ? ' *' : '')} />}
          <button type="submit" style={{ background: '#4F46E5', color: '#fff', border: 'none', borderRadius: 6, padding: 8, fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>{cfg.button || 'Enviar'}</button>
        </form>
      )
    }
    case 'quiz': {
      const questions = cfg.questions || []
      if (!questions.length) return <div style={PH}>Cuestionario (sin preguntas)</div>
      return (
        <div style={{ width: '100%', height: '100%', overflow: 'auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, boxSizing: 'border-box', fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#111827' }}>{cfg.title || 'Cuestionario'}</div>
          {questions.map((q: any, qi: number) => (
            <div key={qi} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{qi + 1}. {q.text ?? q.question ?? ''}</div>
              {(q.options || []).map((opt: string, oi: number) => (
                <label key={oi} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#374151', cursor: 'pointer' }}>
                  <input type={(q.type === 'multi' || q.multiple) ? 'checkbox' : 'radio'} name={`pq${qi}`} /> {opt}
                </label>
              ))}
            </div>
          ))}
          <button style={{ background: '#4F46E5', color: '#fff', border: 'none', borderRadius: 6, padding: 8, fontWeight: 600, cursor: 'pointer', fontSize: 12, marginTop: 'auto' }}>Enviar</button>
        </div>
      )
    }
    case 'popup_banner': {
      const hasImg = !!cfg.image
      const imgRight = cfg.imagePosition === 'right'
      const bg = cfg.bgColor || '#1a1827'
      const tc = cfg.textColor || '#fff'
      const zoom = cfg.imageZoom || 1
      const px = cfg.imagePosX ?? 50
      const py = cfg.imagePosY ?? 50
      const img = hasImg ? (
        <img src={cfg.image} style={{ width: '45%', flexShrink: 0, alignSelf: 'stretch', display: 'block', objectFit: 'cover', objectPosition: `${px}% ${py}%`, transform: `scale(${zoom})`, transformOrigin: 'center' }} />
      ) : null
      const text = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, justifyContent: 'center', padding: '26px 24px', textAlign: hasImg ? 'left' : 'center', alignItems: hasImg ? 'flex-start' : 'center' }}>
          {cfg.title && <div style={{ fontWeight: 800, fontSize: 20, lineHeight: 1.2 }}>{cfg.title}</div>}
          {cfg.text && <div style={{ fontSize: 13, opacity: 0.88, lineHeight: 1.5 }}>{cfg.text}</div>}
          {cfg.buttonText && <button style={{ background: cfg.buttonColor || '#4F46E5', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>{cfg.buttonText}</button>}
        </div>
      )
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
          <div style={{ position: 'relative', background: bg, color: tc, fontFamily: 'Inter, sans-serif', borderRadius: 14, overflow: 'hidden', width: 380, maxWidth: '92%', boxShadow: '0 20px 60px rgba(0,0,0,.5)', display: 'flex', flexDirection: hasImg ? 'row' : 'column', alignItems: hasImg ? 'stretch' : 'center', minHeight: hasImg ? 190 : undefined }}>
            {hasImg && imgRight ? <>{text}{img}</> : <>{img}{text}</>}
            <span style={{ position: 'absolute', top: 10, right: 12, width: 26, height: 26, borderRadius: '50%', background: 'rgba(0,0,0,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>✕</span>
          </div>
        </div>
      )
    }
    default:
      return <div style={PH}>{type}</div>
  }
}

export default function WidgetPreview({ type, config, onClose }: { type: string; config: any; onClose: () => void }) {
  // El pop-up ya trae su propio fondo/caja; el resto se muestra en un recuadro.
  const isPopup = type === 'popup_banner'
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 16, width: 'min(440px, 92vw)', boxShadow: '0 24px 70px rgba(0,0,0,.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <strong style={{ fontSize: 14, color: '#111827', fontFamily: 'Inter, sans-serif' }}>Vista previa</strong>
          <button onClick={onClose} style={{ border: 'none', background: '#f3f4f6', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: 15, color: '#374151' }}>✕</button>
        </div>
        <div style={{ width: '100%', height: isPopup ? 300 : 280, background: isPopup ? '#eef2f7' : '#fff', borderRadius: 10, overflow: 'hidden' }}>
          <Body type={type} config={config} />
        </div>
        <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 10, fontFamily: 'Inter, sans-serif' }}>
          Así se verá el widget en la publicación. Los envíos reales (formularios/cuestionarios) solo funcionan en el flipbook publicado.
        </p>
      </div>
    </div>
  )
}
