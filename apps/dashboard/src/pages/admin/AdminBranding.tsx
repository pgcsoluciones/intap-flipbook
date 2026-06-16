import { useEffect, useState } from 'react'
import { API_BASE } from '../../lib/api'

function authH() {
  const t = localStorage.getItem('token')
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

type BrandingConfig = {
  watermark_text: string
  watermark_url: string
  position: 'bottom-right' | 'bottom-left' | 'bottom-center'
  opacity: number
  visibility: {
    free: boolean      // always true, readonly
    basic: boolean
    pro: boolean
  }
}

const POSITION_MAP: Record<BrandingConfig['position'], React.CSSProperties> = {
  'bottom-right':  { bottom: 10, right: 10 },
  'bottom-left':   { bottom: 10, left: 10 },
  'bottom-center': { bottom: 10, left: '50%', transform: 'translateX(-50%)' },
}

const DEFAULT_CONFIG: BrandingConfig = {
  watermark_text: 'Creado con Intap Flipbook',
  watermark_url: 'https://intapflipbook.com',
  position: 'bottom-right',
  opacity: 80,
  visibility: { free: true, basic: true, pro: false },
}

export default function AdminBranding() {
  const [config, setConfig]   = useState<BrandingConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [msg, setMsg]         = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const r = await fetch(`${API_BASE}/admin/branding`, { headers: authH() })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
      setConfig({ ...DEFAULT_CONFIG, ...d.data })
    } catch (e: any) {
      // si no hay config aún, usar defaults sin mostrar error
      if (!String(e.message).includes('404')) flash(e.message)
    } finally { setLoading(false) }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const r = await fetch(`${API_BASE}/admin/branding`, {
        method: 'PUT',
        headers: authH(),
        body: JSON.stringify(config),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
      flash('Configuración guardada.')
    } catch (e: any) { flash(e.message) }
    finally { setSaving(false) }
  }

  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(''), 3500) }

  if (loading) return <div style={{ padding: '3rem', color: '#666' }}>Cargando...</div>

  const posStyle = POSITION_MAP[config.position] ?? POSITION_MAP['bottom-right']

  return (
    <div style={s.page}>
      {msg && <div style={s.toast}>{msg}</div>}

      <div style={s.header}>
        <div>
          <h1 style={s.h1}>Marca de agua</h1>
          <p style={s.sub}>Configura la marca de agua global que aparece en los flipbooks</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '1.5rem', alignItems: 'start' }}>
        {/* Formulario */}
        <section style={s.card}>
          <h2 style={s.cardTitle}>Configuración</h2>
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <label style={s.label}>
              Texto de la marca de agua
              <input
                style={s.input}
                value={config.watermark_text}
                onChange={(e) => setConfig({ ...config, watermark_text: e.target.value })}
                placeholder="Creado con Intap Flipbook"
              />
            </label>

            <label style={s.label}>
              URL destino al hacer click
              <input
                style={s.input}
                type="url"
                value={config.watermark_url}
                onChange={(e) => setConfig({ ...config, watermark_url: e.target.value })}
                placeholder="https://intapflipbook.com"
              />
            </label>

            <label style={s.label}>
              Posición
              <select
                style={s.input}
                value={config.position}
                onChange={(e) => setConfig({ ...config, position: e.target.value as BrandingConfig['position'] })}
              >
                <option value="bottom-right">Esquina inferior derecha</option>
                <option value="bottom-left">Esquina inferior izquierda</option>
                <option value="bottom-center">Inferior centro</option>
              </select>
            </label>

            <div style={s.label}>
              Opacidad: <strong>{config.opacity}%</strong>
              <input
                type="range"
                min={10}
                max={100}
                value={config.opacity}
                onChange={(e) => setConfig({ ...config, opacity: Number(e.target.value) })}
                style={{ marginTop: 6, accentColor: '#4f46e5' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                <span>10% (casi transparente)</span>
                <span>100% (opaco)</span>
              </div>
            </div>

            <div style={s.label}>
              Visibilidad por plan
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
                {/* Free — siempre visible, readonly */}
                <div style={s.planRow}>
                  <div style={s.planToggleOff}>
                    <span style={{ fontSize: 11, color: '#6b7280' }}>Siempre visible</span>
                  </div>
                  <div>
                    <span style={s.planName}>Free</span>
                    <span style={s.planNote}>No se puede ocultar</span>
                  </div>
                </div>

                {/* Basic */}
                <div style={s.planRow}>
                  <div
                    onClick={() => setConfig({ ...config, visibility: { ...config.visibility, basic: !config.visibility.basic } })}
                    style={{ ...s.toggle, background: config.visibility.basic ? '#4f46e5' : '#d1d5db' }}
                  >
                    <div style={{ ...s.toggleKnob, transform: config.visibility.basic ? 'translateX(20px)' : 'translateX(2px)' }} />
                  </div>
                  <div>
                    <span style={s.planName}>Basic</span>
                    <span style={s.planNote}>
                      {config.visibility.basic ? 'Visible por defecto (tenant puede ocultarla)' : 'Oculta por defecto'}
                    </span>
                  </div>
                </div>

                {/* Pro */}
                <div style={s.planRow}>
                  <div
                    onClick={() => setConfig({ ...config, visibility: { ...config.visibility, pro: !config.visibility.pro } })}
                    style={{ ...s.toggle, background: config.visibility.pro ? '#4f46e5' : '#d1d5db' }}
                  >
                    <div style={{ ...s.toggleKnob, transform: config.visibility.pro ? 'translateX(20px)' : 'translateX(2px)' }} />
                  </div>
                  <div>
                    <span style={s.planName}>Pro</span>
                    <span style={s.planNote}>
                      {config.visibility.pro ? 'Visible' : 'Oculta por defecto'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <button type="submit" disabled={saving} style={s.primaryBtn}>
                {saving ? 'Guardando...' : 'Guardar configuración'}
              </button>
            </div>
          </form>
        </section>

        {/* Preview en vivo */}
        <section style={s.card}>
          <h2 style={s.cardTitle}>Vista previa</h2>
          <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 12px' }}>
            Así se verá la marca de agua sobre una página del flipbook.
          </p>
          <div
            style={{
              width: '100%',
              height: 420,
              background: '#374151',
              borderRadius: 8,
              position: 'relative' as const,
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* Simulación de página */}
            <div style={{ color: '#6b7280', fontSize: 13, textAlign: 'center' as const, userSelect: 'none' as const }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>📄</div>
              <div>Página del flipbook</div>
            </div>

            {/* Marca de agua */}
            <div
              style={{
                position: 'absolute' as const,
                ...posStyle,
                opacity: config.opacity / 100,
                background: 'rgba(0,0,0,0.55)',
                color: '#fff',
                fontSize: 11,
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: 6,
                whiteSpace: 'nowrap' as const,
                cursor: 'pointer',
                maxWidth: '90%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {config.watermark_text || 'Creado con Intap Flipbook'}
            </div>
          </div>
          <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>
            Posición: <strong>{config.position}</strong> — Opacidad: <strong>{config.opacity}%</strong>
          </p>
        </section>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page:        { padding: '2rem 1.5rem', maxWidth: 1100, margin: '0 auto' },
  header:      { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' },
  h1:          { fontSize: '1.5rem', fontWeight: 800, color: '#111827', margin: 0 },
  sub:         { color: '#6b7280', fontSize: 13, margin: '4px 0 0' },
  toast:       { position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', background: '#1f2937', color: '#fff', padding: '8px 20px', borderRadius: 8, fontSize: 13, zIndex: 200 },
  card:        { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '1.25rem', marginBottom: '1rem' },
  cardTitle:   { fontSize: 15, fontWeight: 700, color: '#111827', margin: '0 0 1rem' },
  label:       { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: 13, fontWeight: 500, color: '#374151' },
  input:       { border: '1px solid #d1d5db', borderRadius: 7, padding: '7px 10px', fontSize: 13, color: '#111827', outline: 'none', fontFamily: 'inherit' },
  primaryBtn:  { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  toggle:      { width: 42, height: 24, borderRadius: 12, cursor: 'pointer', position: 'relative' as const, transition: 'background .2s', flexShrink: 0 },
  toggleKnob:  { position: 'absolute' as const, top: 2, width: 20, height: 20, background: '#fff', borderRadius: '50%', transition: 'transform .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' },
  planRow:     { display: 'flex', alignItems: 'center', gap: 12 },
  planToggleOff: { width: 42, height: 24, borderRadius: 12, background: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  planName:    { fontSize: 13, fontWeight: 600, color: '#111827', marginRight: 6 },
  planNote:    { fontSize: 11, color: '#6b7280' },
}
