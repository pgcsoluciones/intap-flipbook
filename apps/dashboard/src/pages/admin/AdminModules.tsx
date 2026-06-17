import { useEffect, useState } from 'react'
import { API_BASE } from '../../lib/api'

function authH() {
  const t = localStorage.getItem('token')
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}
async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${API_BASE}/admin${path}`, { ...init, headers: { ...authH(), ...(init.headers ?? {}) } })
  const d = await r.json()
  if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
  return d
}

type Module = {
  key:         string
  name:        string
  description: string
  active:      boolean
  plans:       string[]
}

// Módulos iniciales (se muestran aunque la API no los tenga aún)
const SEED_MODULES: Omit<Module, 'active' | 'plans'>[] = [
  { key: 'sound',           name: 'Sonido al voltear',       description: 'Efecto de sonido al pasar páginas en el viewer' },
  { key: 'editor',          name: 'Editor en línea',          description: 'Editor visual de páginas con canvas interactivo' },
  { key: 'links',           name: 'Links activos',            description: 'Botones y enlaces clicables dentro del flipbook' },
  { key: 'contact_form',    name: 'Formulario de contacto',   description: 'Formulario de contacto embebido en el viewer' },
  { key: 'qr',              name: 'Código QR',                description: 'Código QR descargable generado automáticamente' },
  { key: 'share_buttons',   name: 'Botones de compartir',     description: 'Botones para compartir en redes sociales' },
  { key: 'stats_advanced',  name: 'Estadísticas avanzadas',   description: 'Métricas detalladas de visualizaciones y clics' },
  { key: 'custom_domain',   name: 'Dominio personalizado',    description: 'URL propia para el viewer del flipbook' },
  { key: 'watermark_hide',  name: 'Ocultar marca de agua',    description: 'Ocultar la marca de agua de Intap en el viewer' },
  { key: 'templates_basic', name: 'Plantillas Basic',         description: 'Acceso a plantillas del plan Basic' },
  { key: 'templates_pro',   name: 'Plantillas Pro',           description: 'Acceso a plantillas del plan Pro' },
]

const PLANS = ['free', 'basic', 'pro'] as const
type Plan = typeof PLANS[number]

const PLAN_COLORS: Record<Plan, { bg: string; text: string; activeBg: string; activeText: string }> = {
  free:  { bg: '#f3f4f6', text: '#6b7280',  activeBg: '#f3f4f6', activeText: '#374151' },
  basic: { bg: '#eff6ff', text: '#93c5fd',  activeBg: '#dbeafe',  activeText: '#1e40af' },
  pro:   { bg: '#faf5ff', text: '#c4b5fd',  activeBg: '#ede9fe',  activeText: '#5b21b6' },
}

export default function AdminModules() {
  const [modules, setModules] = useState<Module[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg]         = useState('')
  const [error, setError]     = useState('')
  const [saving, setSaving]   = useState<Record<string, boolean>>({})

  useEffect(() => {
    adminFetch<{ data: Module[] }>('/modules')
      .then((r) => {
        // Merge con SEED_MODULES: garantiza que todos existan en el listado
        const byKey: Record<string, Module> = {}
        r.data.forEach((m) => { byKey[m.key] = m })

        const merged: Module[] = SEED_MODULES.map((seed) =>
          byKey[seed.key] ?? { ...seed, active: false, plans: [] }
        )
        // Añadir módulos extras que la API tenga pero no estén en SEED
        r.data.forEach((m) => {
          if (!merged.find((x) => x.key === m.key)) merged.push(m)
        })
        setModules(merged)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(''), 3000) }

  async function handleToggleGlobal(m: Module) {
    const newActive = !m.active
    setSaving((prev) => ({ ...prev, [`global_${m.key}`]: true }))
    setError('')
    try {
      await adminFetch(`/modules/${m.key}/global`, {
        method: 'PUT',
        body:   JSON.stringify({ active: newActive, name: m.name, description: m.description }),
      })
      setModules((prev) => prev.map((mod) => mod.key === m.key ? { ...mod, active: newActive } : mod))
      flash(`Módulo "${m.name}" ${newActive ? 'activado' : 'desactivado'} globalmente.`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving((prev) => ({ ...prev, [`global_${m.key}`]: false }))
    }
  }

  async function handleTogglePlan(m: Module, plan: Plan) {
    const alreadyIn = m.plans.includes(plan)
    const newPlans  = alreadyIn ? m.plans.filter((p) => p !== plan) : [...m.plans, plan]
    setSaving((prev) => ({ ...prev, [`plan_${m.key}_${plan}`]: true }))
    setError('')
    try {
      await adminFetch(`/modules/${m.key}/plans`, {
        method: 'PUT',
        body:   JSON.stringify({ plans: newPlans, name: m.name, description: m.description }),
      })
      setModules((prev) => prev.map((mod) => mod.key === m.key ? { ...mod, plans: newPlans } : mod))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving((prev) => ({ ...prev, [`plan_${m.key}_${plan}`]: false }))
    }
  }

  if (loading) return <div style={{ padding: '3rem', color: '#666' }}>Cargando...</div>

  return (
    <div style={s.page}>
      {msg && <div style={s.toast}>{msg}</div>}

      <div style={s.header}>
        <div>
          <h1 style={s.h1}>Módulos del sistema</h1>
          <p style={s.sub}>Controla qué funcionalidades están disponibles y en qué planes</p>
        </div>
      </div>

      {error && <div style={s.errBanner}>{error}</div>}

      {/* Cabecera de columnas */}
      <div style={s.colHeader}>
        <div style={{ flex: 1 }}>Módulo</div>
        <div style={s.colToggle}>Activo globalmente</div>
        <div style={s.colPlans}>Planes incluidos</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {modules.map((m) => (
          <div key={m.key} style={s.card}>
            {/* Info del módulo */}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>{m.name}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{m.description}</div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2, fontFamily: 'monospace' }}>{m.key}</div>
            </div>

            {/* Toggle global */}
            <div style={s.colToggle}>
              <button
                onClick={() => handleToggleGlobal(m)}
                disabled={saving[`global_${m.key}`]}
                style={{
                  ...s.toggle,
                  background: m.active ? '#4f46e5' : '#d1d5db',
                  opacity: saving[`global_${m.key}`] ? 0.6 : 1,
                }}
                title={m.active ? 'Desactivar globalmente' : 'Activar globalmente'}
              >
                <span style={{
                  ...s.toggleKnob,
                  transform: m.active ? 'translateX(18px)' : 'translateX(2px)',
                }} />
              </button>
              <span style={{ fontSize: 12, color: m.active ? '#4f46e5' : '#9ca3af', fontWeight: 600, marginTop: 4 }}>
                {m.active ? 'Activo' : 'Inactivo'}
              </span>
            </div>

            {/* Checkboxes de planes */}
            <div style={s.colPlans}>
              {PLANS.map((plan) => {
                const included = m.plans.includes(plan)
                const isSaving = saving[`plan_${m.key}_${plan}`]
                const colors   = PLAN_COLORS[plan]
                return (
                  <button
                    key={plan}
                    onClick={() => handleTogglePlan(m, plan)}
                    disabled={isSaving}
                    title={included ? `Quitar de ${plan}` : `Agregar a ${plan}`}
                    style={{
                      ...s.planBtn,
                      background: included ? colors.activeBg : colors.bg,
                      color:      included ? colors.activeText : colors.text,
                      border:     `1.5px solid ${included ? colors.activeText : 'transparent'}`,
                      opacity:    isSaving ? 0.6 : 1,
                    }}
                  >
                    {included ? '✓ ' : ''}{plan}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Leyenda */}
      <div style={s.legend}>
        <strong>Activo globalmente:</strong> si está inactivo, el módulo no estará disponible para ningún tenant independientemente del plan.
        &nbsp; <strong>Planes incluidos:</strong> haz clic en un plan para agregarlo o quitarlo del módulo.
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page:       { padding: '2rem 1.5rem', background: '#f8fafc', minHeight: '100vh' },
  header:     { marginBottom: '1.25rem' },
  h1:         { fontSize: '1.5rem', fontWeight: 800, color: '#111827', margin: 0 },
  sub:        { color: '#6b7280', fontSize: 13, margin: '4px 0 0' },
  toast:      { position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', background: '#1f2937', color: '#fff', padding: '8px 20px', borderRadius: 8, fontSize: 13, zIndex: 200 },
  errBanner:  { background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 12 },
  colHeader:  { display: 'flex', alignItems: 'center', padding: '6px 16px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 4 },
  colToggle:  { width: 140, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', flexShrink: 0 },
  colPlans:   { width: 200, display: 'flex', gap: 6, flexShrink: 0, justifyContent: 'flex-end' },
  card:       { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: 16 },
  toggle:     { width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0 },
  toggleKnob: { position: 'absolute', top: 2, width: 18, height: 18, background: '#fff', borderRadius: '50%', transition: 'transform 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' },
  planBtn:    { borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase' as const, transition: 'all 0.15s', minWidth: 54 },
  legend:     { marginTop: 20, fontSize: 12, color: '#6b7280', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 14px', lineHeight: 1.6 },
}
