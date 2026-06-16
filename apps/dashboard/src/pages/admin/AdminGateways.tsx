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

// Tipos para cada tipo de pasarela
type GatewayType = 'transfer' | 'deposit' | 'paypal' | 'readdy' | 'custom'

type Gateway = {
  id: string
  type: GatewayType
  active: boolean
  config_json: Record<string, string>
  instructions: string
}

// Definición estática de las pasarelas soportadas y sus campos de configuración
const GATEWAY_DEFS: { type: GatewayType; label: string; fields: { key: string; label: string; placeholder?: string; type?: string }[] }[] = [
  {
    type:   'transfer',
    label:  'Transferencia bancaria',
    fields: [
      { key: 'bank',    label: 'Banco',    placeholder: 'Ej: Banco Popular' },
      { key: 'holder',  label: 'Titular',  placeholder: 'Nombre del titular' },
      { key: 'account', label: 'Cuenta',   placeholder: 'Número de cuenta' },
    ],
  },
  {
    type:   'deposit',
    label:  'Depósito en efectivo',
    fields: [
      { key: 'bank',    label: 'Banco',    placeholder: 'Ej: Banreservas' },
      { key: 'holder',  label: 'Titular',  placeholder: 'Nombre del titular' },
      { key: 'account', label: 'Cuenta',   placeholder: 'Número de cuenta' },
    ],
  },
  {
    type:   'paypal',
    label:  'PayPal',
    fields: [
      { key: 'client_id', label: 'Client ID',     placeholder: 'AXxxxxxxxxxxxxxxxx' },
      { key: 'secret',    label: 'Secret',         placeholder: 'EXxxxxxxxxxxxxxxxx', type: 'password' },
      { key: 'mode',      label: 'Modo',            placeholder: 'sandbox | production' },
    ],
  },
  {
    type:   'readdy',
    label:  'Readdy (CardNet)',
    fields: [
      { key: 'api_key',     label: 'API Key',     placeholder: 'xxxxxxxxxxxxxxxx', type: 'password' },
      { key: 'merchant_id', label: 'Merchant ID', placeholder: 'MERxxxxxxxx' },
      { key: 'mode',        label: 'Modo',         placeholder: 'sandbox | production' },
    ],
  },
  {
    type:   'custom',
    label:  'Otro / Custom',
    fields: [
      { key: 'name', label: 'Nombre del método', placeholder: 'Ej: Transferencia Zelle' },
    ],
  },
]

export default function AdminGateways() {
  const [gateways, setGateways] = useState<Gateway[]>([])
  const [loading, setLoading]   = useState(true)
  const [msg, setMsg]           = useState('')
  const [error, setError]       = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Estado local de edición para cada gateway
  const [drafts, setDrafts]     = useState<Record<string, { config_json: Record<string, string>; instructions: string }>>({})
  const [saving, setSaving]     = useState<Record<string, boolean>>({})

  useEffect(() => {
    adminFetch<{ data: Gateway[] }>('/gateways')
      .then((r) => {
        // Asegurar que todos los tipos definidos existan, aunque la API devuelva menos
        const byType: Record<string, Gateway> = {}
        r.data.forEach((g) => { byType[g.type] = g })

        const merged: Gateway[] = GATEWAY_DEFS.map((def) =>
          byType[def.type] ?? {
            id:           def.type,   // id provisional hasta que se guarde
            type:         def.type,
            active:       false,
            config_json:  {},
            instructions: '',
          }
        )
        setGateways(merged)
        // Inicializar drafts
        const d: Record<string, { config_json: Record<string, string>; instructions: string }> = {}
        merged.forEach((g) => { d[g.type] = { config_json: { ...g.config_json }, instructions: g.instructions } })
        setDrafts(d)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(''), 3000) }

  function toggleExpand(type: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(type) ? next.delete(type) : next.add(type)
      return next
    })
  }

  async function handleToggle(g: Gateway) {
    const newActive = !g.active
    try {
      await adminFetch(`/gateways/${g.id}/toggle`, {
        method: 'PATCH',
        body:   JSON.stringify({ active: newActive }),
      })
      setGateways((prev) => prev.map((gw) => gw.type === g.type ? { ...gw, active: newActive } : gw))
      flash(`${GATEWAY_DEFS.find((d) => d.type === g.type)?.label ?? g.type} ${newActive ? 'activada' : 'desactivada'}.`)
    } catch (e: any) {
      setError(e.message)
    }
  }

  function updateDraft(type: string, key: string, value: string) {
    setDrafts((prev) => ({
      ...prev,
      [type]: { ...prev[type], config_json: { ...prev[type]?.config_json, [key]: value } },
    }))
  }

  function updateInstructions(type: string, value: string) {
    setDrafts((prev) => ({ ...prev, [type]: { ...prev[type], instructions: value } }))
  }

  async function handleSave(g: Gateway) {
    setSaving((prev) => ({ ...prev, [g.type]: true }))
    setError('')
    try {
      const draft = drafts[g.type] ?? { config_json: {}, instructions: '' }
      const res = await adminFetch<{ data: Gateway }>(`/gateways/${g.id}`, {
        method: 'PUT',
        body:   JSON.stringify({ config_json: draft.config_json, instructions: draft.instructions }),
      })
      setGateways((prev) => prev.map((gw) => gw.type === g.type ? res.data : gw))
      flash('Configuración guardada.')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving((prev) => ({ ...prev, [g.type]: false }))
    }
  }

  if (loading) return <div style={{ padding: '3rem', color: '#666' }}>Cargando...</div>

  return (
    <div style={s.page}>
      {msg && <div style={s.toast}>{msg}</div>}

      <div style={s.header}>
        <div>
          <h1 style={s.h1}>Pasarelas de pago</h1>
          <p style={s.sub}>Configura los métodos de pago disponibles para los tenants</p>
        </div>
      </div>

      {error && <div style={s.errBanner}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {GATEWAY_DEFS.map((def) => {
          const g    = gateways.find((gw) => gw.type === def.type)
          if (!g) return null
          const open = expanded.has(def.type)
          const draft = drafts[def.type] ?? { config_json: {}, instructions: '' }

          return (
            <div key={def.type} style={s.card}>
              {/* Cabecera del card */}
              <div style={s.cardHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {/* Toggle activo/inactivo */}
                  <button
                    onClick={() => handleToggle(g)}
                    style={{
                      ...s.toggle,
                      background: g.active ? '#4f46e5' : '#d1d5db',
                    }}
                    title={g.active ? 'Desactivar' : 'Activar'}
                  >
                    <span style={{
                      ...s.toggleKnob,
                      transform: g.active ? 'translateX(18px)' : 'translateX(2px)',
                    }} />
                  </button>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>{def.label}</span>
                    <span style={{
                      ...s.badge,
                      marginLeft: 8,
                      background: g.active ? '#d1fae5' : '#f3f4f6',
                      color:      g.active ? '#065f46' : '#6b7280',
                    }}>
                      {g.active ? 'Activa' : 'Inactiva'}
                    </span>
                  </div>
                </div>
                <button onClick={() => toggleExpand(def.type)} style={s.btnToggleExpand}>
                  {open ? 'Contraer ▲' : 'Configurar ▼'}
                </button>
              </div>

              {/* Contenido expandible */}
              {open && (
                <div style={s.cardBody}>
                  {/* Campos de configuración específicos por tipo */}
                  {def.fields.map((field) => (
                    <div key={field.key} style={{ marginBottom: 12 }}>
                      <label style={s.label}>{field.label}</label>
                      <input
                        type={field.type ?? 'text'}
                        style={s.input}
                        placeholder={field.placeholder}
                        value={draft.config_json[field.key] ?? ''}
                        onChange={(e) => updateDraft(def.type, field.key, e.target.value)}
                      />
                    </div>
                  ))}

                  {/* Instrucciones (texto libre, común a todos) */}
                  <div style={{ marginBottom: 12 }}>
                    <label style={s.label}>Instrucciones para el tenant</label>
                    <textarea
                      style={{ ...s.input, minHeight: 90, resize: 'vertical' as const }}
                      placeholder="Describe cómo debe realizar el pago el cliente..."
                      value={draft.instructions}
                      onChange={(e) => updateInstructions(def.type, e.target.value)}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => handleSave(g)}
                      disabled={saving[def.type]}
                      style={{ ...s.btnPrimary, opacity: saving[def.type] ? 0.6 : 1 }}
                    >
                      {saving[def.type] ? 'Guardando...' : 'Guardar configuración'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page:            { padding: '2rem 1.5rem', background: '#f8fafc', minHeight: '100vh' },
  header:          { marginBottom: '1.25rem' },
  h1:              { fontSize: '1.5rem', fontWeight: 800, color: '#111827', margin: 0 },
  sub:             { color: '#6b7280', fontSize: 13, margin: '4px 0 0' },
  toast:           { position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', background: '#1f2937', color: '#fff', padding: '8px 20px', borderRadius: 8, fontSize: 13, zIndex: 200 },
  errBanner:       { background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 12 },
  card:            { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' },
  cardHeader:      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem' },
  cardBody:        { padding: '0 1.25rem 1.25rem', borderTop: '1px solid #f3f4f6' },
  badge:           { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10 },
  toggle:          { width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0 },
  toggleKnob:      { position: 'absolute', top: 2, width: 18, height: 18, background: '#fff', borderRadius: '50%', transition: 'transform 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' },
  btnToggleExpand: { background: 'transparent', border: '1px solid #d1d5db', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', color: '#374151', fontWeight: 600 },
  label:           { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4, marginTop: 12 },
  input:           { border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 13, width: '100%', outline: 'none', boxSizing: 'border-box' as const, background: '#fff' },
  btnPrimary:      { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
}
