import { useEffect, useState } from 'react'
import { API_BASE } from '../../lib/api'

// Helper: agrega el header Authorization con el token JWT guardado en localStorage
function authH(): HeadersInit {
  const t = localStorage.getItem('token')
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

// Helper genérico para llamar endpoints del admin
async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${API_BASE}/admin${path}`, { ...init, headers: { ...authH(), ...(init.headers ?? {}) } })
  const d = await r.json()
  if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
  return d
}

// ── Tipos ────────────────────────────────────────────────────────────────────

interface Plan {
  id: string
  name: string
  price_usd: number
  max_publications: number | null   // null = ilimitado
  max_pages_per_pub: number | null
  max_storage_mb: number | null
  sound_enabled: boolean
  custom_domain: boolean
  status: 'active' | 'hidden'
  billing_period?: 'monthly' | 'quarterly' | 'annual' | 'custom'
  period_days?: number
  tenant_count: number
}

// Días de vigencia por frecuencia (custom = el admin escribe los días)
const PERIOD_DAYS: Record<string, number> = { monthly: 30, quarterly: 90, annual: 365 }

// Formulario de plan — usa string para los campos numéricos para poder escribir "ilimitado"
interface PlanForm {
  name: string
  price_usd: string
  max_publications: string       // número o "" para ilimitado
  max_pages_per_pub: string
  max_storage_mb: string
  sound_enabled: boolean
  custom_domain: boolean
  status: 'active' | 'hidden'
  billing_period: 'monthly' | 'quarterly' | 'annual' | 'custom'
  period_days: string
}

const EMPTY_FORM: PlanForm = {
  name: '',
  price_usd: '',
  max_publications: '',
  max_pages_per_pub: '',
  max_storage_mb: '',
  sound_enabled: false,
  custom_domain: false,
  status: 'active',
  billing_period: 'monthly',
  period_days: '30',
}

function planToForm(p: Plan): PlanForm {
  return {
    name:              p.name,
    price_usd:         String(p.price_usd),
    max_publications:  p.max_publications  == null ? '' : String(p.max_publications),
    max_pages_per_pub: p.max_pages_per_pub == null ? '' : String(p.max_pages_per_pub),
    max_storage_mb:    p.max_storage_mb    == null ? '' : String(p.max_storage_mb),
    sound_enabled:     p.sound_enabled,
    custom_domain:     p.custom_domain,
    status:            p.status,
    billing_period:    p.billing_period ?? 'monthly',
    period_days:       p.period_days == null ? '30' : String(p.period_days),
  }
}

// Convierte el formulario al body JSON que espera la API
function formToBody(f: PlanForm) {
  return {
    name:              f.name.trim(),
    price_usd:         Number(f.price_usd) || 0,
    // Campo vacío o "ilimitado" → null (sin límite)
    max_publications:  f.max_publications.trim() === '' ? null : Number(f.max_publications),
    max_pages_per_pub: f.max_pages_per_pub.trim() === '' ? null : Number(f.max_pages_per_pub),
    max_storage_mb:    f.max_storage_mb.trim() === '' ? null : Number(f.max_storage_mb),
    sound_enabled:     f.sound_enabled,
    custom_domain:     f.custom_domain,
    status:            f.status,
    billing_period:    f.billing_period,
    // monthly/quarterly/annual usan días fijos; custom usa lo que escribió el admin
    period_days:       f.billing_period === 'custom'
                         ? (Number(f.period_days) || 30)
                         : PERIOD_DAYS[f.billing_period],
  }
}

// ── Componente Modal genérico ─────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={ms.overlay} onClick={onClose}>
      <div style={ms.box} onClick={(e) => e.stopPropagation()}>
        <div style={ms.header}>
          <span style={ms.title}>{title}</span>
          <button onClick={onClose} style={ms.close}>✕</button>
        </div>
        <div style={ms.body}>{children}</div>
      </div>
    </div>
  )
}

// ── Componente formulario de plan ─────────────────────────────────────────────

function PlanFormFields({
  form,
  onChange,
}: {
  form: PlanForm
  onChange: (updated: PlanForm) => void
}) {
  function set<K extends keyof PlanForm>(key: K, value: PlanForm[K]) {
    onChange({ ...form, [key]: value })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      <div style={s.fieldGroup}>
        <label style={s.fieldLabel}>Nombre del plan *</label>
        <input type="text" style={s.fieldInput} placeholder="Ej: Basic" value={form.name}
          onChange={(e) => set('name', e.target.value)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={s.fieldGroup}>
          <label style={s.fieldLabel}>Precio (USD)</label>
          <input type="number" min={0} step="0.01" style={s.fieldInput} placeholder="0.00" value={form.price_usd}
            onChange={(e) => set('price_usd', e.target.value)} />
        </div>
        <div style={s.fieldGroup}>
          <label style={s.fieldLabel}>Frecuencia de facturación</label>
          <select style={s.fieldSelect} value={form.billing_period}
            onChange={(e) => set('billing_period', e.target.value as PlanForm['billing_period'])}>
            <option value="monthly">Mensual (30 días)</option>
            <option value="quarterly">Trimestral (90 días)</option>
            <option value="annual">Anual (365 días)</option>
            <option value="custom">Personalizado</option>
          </select>
        </div>
      </div>

      {form.billing_period === 'custom' && (
        <div style={s.fieldGroup}>
          <label style={s.fieldLabel}>Días de vigencia (personalizado)</label>
          <input type="number" min={1} style={s.fieldInput} placeholder="Ej: 180" value={form.period_days}
            onChange={(e) => set('period_days', e.target.value)} />
          <span style={s.fieldHint}>Cantidad de días que dura el plan tras cada pago.</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={s.fieldGroup}>
          <label style={s.fieldLabel}>Publicaciones máx.</label>
          <input type="number" min={0} style={s.fieldInput} placeholder="vacío = ilimitado" value={form.max_publications}
            onChange={(e) => set('max_publications', e.target.value)} />
          <span style={s.fieldHint}>Vacío = ilimitado</span>
        </div>
        <div style={s.fieldGroup}>
          <label style={s.fieldLabel}>Páginas máx. / pub.</label>
          <input type="number" min={0} style={s.fieldInput} placeholder="vacío = ilimitado" value={form.max_pages_per_pub}
            onChange={(e) => set('max_pages_per_pub', e.target.value)} />
          <span style={s.fieldHint}>Vacío = ilimitado</span>
        </div>
      </div>

      <div style={s.fieldGroup}>
        <label style={s.fieldLabel}>Storage máx. (MB)</label>
        <input type="number" min={0} style={s.fieldInput} placeholder="vacío = ilimitado" value={form.max_storage_mb}
          onChange={(e) => set('max_storage_mb', e.target.value)} />
        <span style={s.fieldHint}>Vacío = ilimitado</span>
      </div>

      <div style={{ display: 'flex', gap: 20 }}>
        <label style={s.checkLabel}>
          <input type="checkbox" checked={form.sound_enabled} onChange={(e) => set('sound_enabled', e.target.checked)} style={{ marginRight: 6 }} />
          Sonido habilitado
        </label>
        <label style={s.checkLabel}>
          <input type="checkbox" checked={form.custom_domain} onChange={(e) => set('custom_domain', e.target.checked)} style={{ marginRight: 6 }} />
          Dominio personalizado
        </label>
      </div>

      <div style={s.fieldGroup}>
        <label style={s.fieldLabel}>Estado del plan</label>
        <select style={s.fieldSelect} value={form.status} onChange={(e) => set('status', e.target.value as 'active' | 'hidden')}>
          <option value="active">Activo (visible para nuevos usuarios)</option>
          <option value="hidden">Oculto (solo usuarios existentes)</option>
        </select>
      </div>

      <p style={{ fontSize: 12, color: '#f59e0b', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 7, padding: '8px 12px', margin: 0 }}>
        Los cambios en límites se aplican a todos los tenants en este plan (salvo que tengan limites personalizados).
      </p>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function AdminPlans() {
  const [plans, setPlans]     = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg]         = useState('')
  const [msgType, setMsgType] = useState<'ok' | 'err'>('ok')

  // Modal de edición/creación
  const [modalPlan, setModalPlan] = useState<Plan | null | 'new'>(null)  // null = cerrado, 'new' = crear, Plan = editar
  const [form, setForm]           = useState<PlanForm>(EMPTY_FORM)
  const [saving, setSaving]       = useState(false)

  function loadPlans() {
    return adminFetch<{ data: Plan[] }>('/plans')
      .then((r) => setPlans(r.data))
      .catch((e) => flash(e.message, 'err'))
  }

  useEffect(() => {
    loadPlans().finally(() => setLoading(false))
  }, [])

  // Toast temporal
  function flash(text: string, type: 'ok' | 'err' = 'ok') {
    setMsg(text)
    setMsgType(type)
    setTimeout(() => setMsg(''), 3500)
  }

  function openNew() {
    setForm(EMPTY_FORM)
    setModalPlan('new')
  }

  function openEdit(plan: Plan) {
    setForm(planToForm(plan))
    setModalPlan(plan)
  }

  function closeModal() {
    if (saving) return
    setModalPlan(null)
  }

  async function handleSave() {
    if (!form.name.trim()) { flash('El nombre del plan es obligatorio.', 'err'); return }
    setSaving(true)
    try {
      const body = formToBody(form)

      if (modalPlan === 'new') {
        await adminFetch('/plans', { method: 'POST', body: JSON.stringify(body) })
        await loadPlans()
        flash('Plan creado correctamente.')
      } else if (modalPlan) {
        await adminFetch(`/plans/${(modalPlan as Plan).id}`, { method: 'PUT', body: JSON.stringify(body) })
        await loadPlans()
        flash('Plan actualizado correctamente.')
      }

      setModalPlan(null)
    } catch (e: any) {
      flash(e.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) return <div style={{ padding: '3rem', color: '#666' }}>Cargando planes...</div>

  return (
    <div style={s.page}>

      {/* Toast */}
      {msg && (
        <div style={{ ...s.toast, background: msgType === 'err' ? '#ef4444' : '#1f2937' }}>{msg}</div>
      )}

      {/* Header */}
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.h1}>Planes</h1>
          <p style={s.sub}>{plans.length} planes configurados</p>
        </div>
        <button onClick={openNew} style={s.btnPrimary}>+ Nuevo plan</button>
      </div>

      {/* Tabla de planes */}
      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              {['Nombre', 'Precio / mes', 'Publicaciones máx.', 'Páginas máx.', 'Storage MB', 'Sonido', 'Dom. custom', 'Estado', 'Tenants', ''].map((h) => (
                <th key={h} style={s.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plans.length === 0 && (
              <tr><td colSpan={10} style={{ textAlign: 'center', padding: '2rem', color: '#9ca3af', fontSize: 13 }}>No hay planes. Crea el primero.</td></tr>
            )}
            {plans.map((plan) => (
              <tr
                key={plan.id}
                style={{ ...s.tr, cursor: 'pointer' }}
                onClick={() => openEdit(plan)}
                title="Clic para editar este plan"
              >
                <td style={s.td}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#111827' }}>{plan.name}</div>
                  <div style={{ fontSize: 11, color: '#9ca3af' }}>ID: {plan.id}</div>
                </td>
                <td style={{ ...s.td, fontWeight: 600 }}>
                  {plan.price_usd === 0 ? <span style={{ color: '#6b7280' }}>Gratis</span> : `$${Number(plan.price_usd).toFixed(2)}`}
                </td>
                <td style={{ ...s.td, textAlign: 'center' as const }}>
                  {plan.max_publications == null ? <span style={s.unlimited}>Ilimitado</span> : plan.max_publications}
                </td>
                <td style={{ ...s.td, textAlign: 'center' as const }}>
                  {plan.max_pages_per_pub == null ? <span style={s.unlimited}>Ilimitado</span> : plan.max_pages_per_pub}
                </td>
                <td style={{ ...s.td, textAlign: 'center' as const }}>
                  {plan.max_storage_mb == null ? <span style={s.unlimited}>Ilimitado</span> : plan.max_storage_mb}
                </td>
                <td style={{ ...s.td, textAlign: 'center' as const }}>
                  <span style={{ fontSize: 16 }}>{plan.sound_enabled ? '✅' : '—'}</span>
                </td>
                <td style={{ ...s.td, textAlign: 'center' as const }}>
                  <span style={{ fontSize: 16 }}>{plan.custom_domain ? '✅' : '—'}</span>
                </td>
                <td style={s.td}>
                  <span style={{
                    ...s.statusBadge,
                    background: plan.status === 'active' ? '#d1fae5' : '#f3f4f6',
                    color:      plan.status === 'active' ? '#065f46' : '#6b7280',
                  }}>
                    {plan.status === 'active' ? 'Activo' : 'Oculto'}
                  </span>
                </td>
                <td style={{ ...s.td, textAlign: 'center' as const, fontWeight: 600 }}>{plan.tenant_count ?? 0}</td>
                <td style={s.td}>
                  <button
                    onClick={(e) => { e.stopPropagation(); openEdit(plan) }}
                    style={s.btnEdit}
                  >
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Nota informativa */}
      <div style={s.infoBox}>
        <strong>Nota:</strong> Al editar los límites de un plan, los cambios aplican automáticamente a todos los tenants que tengan ese plan
        (salvo que tengan límites personalizados configurados individualmente en su perfil).
      </div>

      {/* ── Modal: Crear / Editar plan ── */}
      {modalPlan !== null && (
        <Modal
          title={modalPlan === 'new' ? 'Nuevo plan' : `Editar plan: ${(modalPlan as Plan).name}`}
          onClose={closeModal}
        >
          <PlanFormFields form={form} onChange={setForm} />

          <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
            <button onClick={closeModal} style={s.btnSecondary} disabled={saving}>Cancelar</button>
            <button onClick={handleSave} style={s.btnPrimary} disabled={saving || !form.name.trim()}>
              {saving ? 'Guardando...' : 'Guardar plan'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Estilos ──────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page:        { padding: '2rem 1.5rem' },
  pageHeader:  { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap' as const, gap: 12 },
  h1:          { fontSize: '1.5rem', fontWeight: 800, color: '#111827', margin: 0 },
  sub:         { color: '#6b7280', fontSize: 13, margin: '4px 0 0' },

  tableWrap:   { background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'auto' },
  table:       { width: '100%', borderCollapse: 'collapse' as const, minWidth: 860 },
  th:          { padding: '10px 12px', textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: '#6b7280', borderBottom: '1px solid #e5e7eb', background: '#f9fafb', whiteSpace: 'nowrap' as const },
  tr:          { borderBottom: '1px solid #f9fafb', transition: 'background .12s' },
  td:          { padding: '11px 12px', fontSize: 13, verticalAlign: 'middle' as const },

  statusBadge: { fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 10 },
  unlimited:   { fontSize: 12, color: '#4f46e5', fontWeight: 600 },

  btnEdit:     { background: '#e0e7ff', color: '#4338ca', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  btnPrimary:  { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnSecondary:{ background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer' },

  infoBox:     { marginTop: 16, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '10px 16px', fontSize: 12, color: '#1e40af' },

  toast:       { position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', color: '#fff', padding: '9px 22px', borderRadius: 8, fontSize: 13, zIndex: 999, whiteSpace: 'nowrap' as const },

  fieldGroup:  { display: 'flex', flexDirection: 'column' as const, gap: 5 },
  fieldLabel:  { fontSize: 12, fontWeight: 600, color: '#374151' },
  fieldHint:   { fontSize: 11, color: '#9ca3af' },
  fieldInput:  { border: '1px solid #d1d5db', borderRadius: 7, padding: '8px 10px', fontSize: 13, outline: 'none', fontFamily: 'inherit' },
  fieldSelect: { border: '1px solid #d1d5db', borderRadius: 7, padding: '8px 10px', fontSize: 13, background: '#fff', cursor: 'pointer', outline: 'none' },
  checkLabel:  { fontSize: 13, color: '#374151', display: 'flex', alignItems: 'center', cursor: 'pointer' },
}

const ms: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' },
  box:     { background: '#fff', borderRadius: 14, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' as const, boxShadow: '0 20px 60px rgba(0,0,0,.2)' },
  header:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #e5e7eb', position: 'sticky' as const, top: 0, background: '#fff', zIndex: 1 },
  title:   { fontWeight: 700, fontSize: 15, color: '#111827' },
  close:   { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#9ca3af', lineHeight: 1, padding: 4 },
  body:    { padding: '20px' },
}
