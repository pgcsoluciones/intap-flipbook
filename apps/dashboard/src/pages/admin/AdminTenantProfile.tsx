import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
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

interface Tenant {
  id: string
  name: string
  email: string
  plan_id: string
  status: string
  max_publications: number | null
  max_pages_per_pub: number | null
  max_storage_mb: number | null
  created_at: string
}

interface Payment {
  id: string
  amount: number
  currency: string
  method: string
  reference: string
  notes: string
  plan_paid: string
  created_at: string
}

// Colores de badge de estado
const STATUS_COLORS: Record<string, string> = {
  active:    '#d1fae5',
  degraded:  '#fef3c7',
  suspended: '#fee2e2',
}
const STATUS_TEXT: Record<string, string> = {
  active:    '#065f46',
  degraded:  '#92400e',
  suspended: '#991b1b',
}
const STATUS_LABELS: Record<string, string> = {
  active:    'Activo',
  degraded:  'Degradado',
  suspended: 'Suspendido',
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

// ── Componente principal ──────────────────────────────────────────────────────

export default function AdminTenantProfile() {
  // useParams extrae el segmento :id de la URL /admin/tenants/:id
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [tenant, setTenant]   = useState<Tenant | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg]         = useState('')
  const [msgType, setMsgType] = useState<'ok' | 'err'>('ok')

  // Estado solicitud pendiente de cambio de plan
  const [pendingReq, setPendingReq] = useState<any>(null)

  // Estados del formulario inline de pago para solicitud pendiente
  const [payReq, setPayReq] = useState({ amount: '', currency: 'USD', method: 'transfer', reference: '', notes: '' })
  const [rejectReason, setRejectReason] = useState('')
  const [showReject, setShowReject] = useState(false)
  const [reqLoading, setReqLoading] = useState(false)

  // Estados de modales
  const [showPlanModal, setShowPlanModal]   = useState(false)
  const [showPayModal, setShowPayModal]     = useState(false)

  // Estado del formulario de plan
  const [newPlan, setNewPlan] = useState('')

  // Estado de límites editables inline
  const [limits, setLimits] = useState({ max_publications: '', max_pages_per_pub: '', max_storage_mb: '' })
  const [limitsEdited, setLimitsEdited] = useState(false)

  // Estado del formulario de pago manual
  const [payForm, setPayForm] = useState({
    amount: '',
    currency: 'USD',
    method: 'transfer',
    reference: '',
    notes: '',
  })
  const [payLoading, setPayLoading] = useState(false)

  // Carga inicial: datos del tenant + historial de pagos + solicitud pendiente
  useEffect(() => {
    if (!id) return
    Promise.all([
      adminFetch<{ data: Tenant }>(`/users/${id}`),
      adminFetch<{ data: Payment[] }>(`/users/${id}/payments`).catch(() => ({ data: [] as Payment[] })),
    ])
      .then(([u, p]) => {
        setTenant(u.data)
        setNewPlan(u.data.plan_id)
        setLimits({
          max_publications:  String(u.data.max_publications  ?? ''),
          max_pages_per_pub: String(u.data.max_pages_per_pub ?? ''),
          max_storage_mb:    String(u.data.max_storage_mb    ?? ''),
        })
        setPayments(p.data)
      })
      .catch((e) => flash(e.message, 'err'))
      .finally(() => setLoading(false))

    adminFetch<{ data: any[] }>('/plan-requests')
      .then((r) => {
        const req = r.data.find((x: any) => x.user_id === id && x.status === 'pending')
        setPendingReq(req ?? null)
      })
      .catch(() => {})
  }, [id])

  // Toast temporal: muestra un mensaje 3 segundos y luego desaparece
  function flash(text: string, type: 'ok' | 'err' = 'ok') {
    setMsg(text)
    setMsgType(type)
    setTimeout(() => setMsg(''), 3500)
  }

  // ── Handlers ───────────────────────────────────────────────────────────────

  async function handleSavePlan() {
    try {
      await adminFetch(`/users/${id}/plan`, { method: 'PUT', body: JSON.stringify({ plan_id: newPlan }) })
      setTenant((prev) => prev ? { ...prev, plan_id: newPlan } : prev)
      setShowPlanModal(false)
      flash('Plan actualizado correctamente.')
    } catch (e: any) {
      flash(e.message, 'err')
    }
  }

  async function handleChangeStatus(status: 'active' | 'suspended') {
    if (!confirm(`¿Cambiar estado a "${STATUS_LABELS[status]}"?`)) return
    try {
      await adminFetch(`/users/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) })
      setTenant((prev) => prev ? { ...prev, status } : prev)
      flash(`Estado cambiado a ${STATUS_LABELS[status]}.`)
    } catch (e: any) {
      flash(e.message, 'err')
    }
  }

  async function handleSaveLimits() {
    try {
      const body = {
        max_publications:  limits.max_publications  !== '' ? Number(limits.max_publications)  : null,
        max_pages_per_pub: limits.max_pages_per_pub !== '' ? Number(limits.max_pages_per_pub) : null,
        max_storage_mb:    limits.max_storage_mb    !== '' ? Number(limits.max_storage_mb)    : null,
      }
      await adminFetch(`/users/${id}/limits`, { method: 'PUT', body: JSON.stringify(body) })
      setLimitsEdited(false)
      flash('Límites guardados.')
    } catch (e: any) {
      flash(e.message, 'err')
    }
  }

  async function handleRegisterPayment() {
    setPayLoading(true)
    try {
      const body = {
        user_id:   id,
        amount:    Number(payForm.amount),
        currency:  payForm.currency,
        method:    payForm.method,
        reference: payForm.reference,
        notes:     payForm.notes,
        plan_paid: tenant?.plan_id ?? '',
      }
      const res = await adminFetch<{ data: Payment }>('/payments', { method: 'POST', body: JSON.stringify(body) })
      setPayments((prev) => [res.data, ...prev])
      setShowPayModal(false)
      setPayForm({ amount: '', currency: 'USD', method: 'transfer', reference: '', notes: '' })
      flash('Pago registrado.')
    } catch (e: any) {
      flash(e.message, 'err')
    } finally {
      setPayLoading(false)
    }
  }

  async function handleActivateWithPayment() {
    if (!pendingReq) return
    setReqLoading(true)
    try {
      await adminFetch('/payments', {
        method: 'POST',
        body: JSON.stringify({
          user_id: id,
          amount: Number(payReq.amount),
          currency: payReq.currency,
          method: payReq.method,
          reference: payReq.reference,
          notes: payReq.notes,
          plan_paid: pendingReq.requested_plan,
        }),
      })
      await adminFetch(`/plan-requests/${pendingReq.id}`, {
        method: 'PUT',
        body: JSON.stringify({ action: 'approve' }),
      })
      setTenant((t) => t ? { ...t, plan_id: pendingReq.requested_plan } as any : t)
      setPendingReq(null)
      setPayReq({ amount: '', currency: 'USD', method: 'transfer', reference: '', notes: '' })
      flash('¡Plan activado y pago registrado!')
    } catch (e: any) {
      flash(e.message ?? 'Error', 'err')
    } finally {
      setReqLoading(false)
    }
  }

  async function handleRejectRequest() {
    if (!pendingReq) return
    setReqLoading(true)
    try {
      await adminFetch(`/plan-requests/${pendingReq.id}`, {
        method: 'PUT',
        body: JSON.stringify({ action: 'reject', notes: rejectReason }),
      })
      setPendingReq(null)
      setShowReject(false)
      setRejectReason('')
      flash('Solicitud rechazada.')
    } catch (e: any) {
      flash(e.message ?? 'Error', 'err')
    } finally {
      setReqLoading(false)
    }
  }

  async function handleSendPaymentInstructions() {
    try {
      await adminFetch('/notifications', {
        method: 'POST',
        body: JSON.stringify({
          user_id: id,
          title: 'Instrucciones de pago',
          message: `Para activar tu plan ${pendingReq?.requested_plan ?? ''}, enviá tu comprobante de pago a soporte@intapflipbook.com indicando tu email registrado.`,
          type: 'payment_instructions',
        }),
      })
      flash('Instrucciones enviadas al tenant.')
    } catch (e: any) {
      flash(e.message ?? 'Error', 'err')
    }
  }

  async function handleDelete() {
    if (!confirm(`¿Eliminar permanentemente la cuenta de ${tenant?.email}? Esta acción no se puede deshacer.`)) return
    if (!confirm('Confirmar: ¿está SEGURO? Se borrarán todas sus publicaciones y datos.')) return
    try {
      await adminFetch(`/users/${id}`, { method: 'DELETE' })
      navigate('/admin/tenants')
    } catch (e: any) {
      flash(e.message, 'err')
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) return <div style={{ padding: '3rem', color: '#666' }}>Cargando perfil...</div>
  if (!tenant) return <div style={{ padding: '3rem', color: '#ef4444' }}>Tenant no encontrado.</div>

  const storageMB = ((tenant as any).total_bytes ?? 0) / 1024 / 1024

  return (
    <div style={s.page}>

      {/* Toast */}
      {msg && (
        <div style={{ ...s.toast, background: msgType === 'err' ? '#ef4444' : '#1f2937' }}>{msg}</div>
      )}

      {/* Breadcrumb */}
      <div style={s.breadcrumb}>
        <Link to="/admin/tenants" style={s.breadLink}>Tenants</Link>
        <span style={s.breadSep}>/</span>
        <span style={s.breadCurrent}>{tenant.email}</span>
      </div>

      {/* Header */}
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.h1}>{tenant.name || '(sin nombre)'}</h1>
          <p style={s.sub}>{tenant.email}</p>
        </div>
        <button onClick={() => navigate('/admin/tenants')} style={s.backBtn}>← Volver a Tenants</button>
      </div>

      <div style={s.grid}>

        {/* ── Card: Info básica ── */}
        <div style={s.card}>
          <h2 style={s.cardTitle}>Información básica</h2>
          <div style={s.row}><span style={s.label}>Nombre</span><span style={s.value}>{tenant.name || '—'}</span></div>
          <div style={s.row}><span style={s.label}>Email</span><span style={s.value}>{tenant.email}</span></div>
          <div style={s.row}>
            <span style={s.label}>Registrado</span>
            <span style={s.value}>{new Date(tenant.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
          </div>
          <div style={s.row}><span style={s.label}>Storage usado</span><span style={s.value}>{storageMB.toFixed(1)} MB</span></div>
        </div>

        {/* ── Card: Plan ── */}
        <div style={s.card}>
          <h2 style={s.cardTitle}>Plan actual</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <span style={{ ...s.planBadge, ...PLAN_COLORS[tenant.plan_id] ?? PLAN_COLORS.free }}>
              {(tenant.plan_id ?? 'free').toUpperCase()}
            </span>
          </div>
          <button onClick={() => setShowPlanModal(true)} style={s.btnPrimary}>Cambiar plan</button>
          <button
            onClick={async () => {
              try {
                const adminToken = localStorage.getItem('token') ?? ''
                const r = await adminFetch<{ data: { token: string } }>(`/users/${id}/impersonate`, { method: 'POST' })
                localStorage.setItem('admin_token', adminToken)
                localStorage.setItem('token', r.data.token)
                navigate('/dashboard')
              } catch (e: any) {
                setMsg(e.message ?? 'Error al impersonar'); setMsgType('err')
              }
            }}
            style={{ ...s.btnSecondary, marginTop: 8 }}
          >
            🕵️ Ver como tenant
          </button>

          {/* Marca de agua: forzar mostrar/ocultar para este tenant */}
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #f3f4f6' }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              Marca de agua
            </label>
            <select
              value={(tenant as any).watermark_override ?? 'plan'}
              onChange={async (e) => {
                const value = e.target.value
                try {
                  await adminFetch(`/users/${id}/watermark`, { method: 'PUT', body: JSON.stringify({ watermark_override: value }) })
                  setTenant((t) => t ? ({ ...t, watermark_override: value } as Tenant) : t)
                  setMsg('Marca de agua actualizada'); setMsgType('ok')
                } catch (err: any) { setMsg(err.message ?? 'Error'); setMsgType('err') }
              }}
              style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 13 }}
            >
              <option value="plan">Según el plan (free: muestra · pago: oculta)</option>
              <option value="force_show">Forzar mostrar siempre</option>
              <option value="force_hide">Forzar ocultar siempre</option>
            </select>
            <p style={{ fontSize: 11, color: '#9ca3af', margin: '6px 0 0' }}>
              Para verla en un plan Pro, elegí "Forzar mostrar siempre".
            </p>
          </div>
        </div>

        {/* ── Card: Estado ── */}
        <div style={s.card}>
          <h2 style={s.cardTitle}>Estado de cuenta</h2>
          <div style={{ marginBottom: 16 }}>
            <span style={{ ...s.statusBadge, background: STATUS_COLORS[tenant.status ?? 'active'], color: STATUS_TEXT[tenant.status ?? 'active'] }}>
              {STATUS_LABELS[tenant.status ?? 'active']}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {tenant.status !== 'active' && (
              <button onClick={() => handleChangeStatus('active')} style={s.btnSuccess}>Activar</button>
            )}
            {tenant.status !== 'suspended' && (
              <button onClick={() => handleChangeStatus('suspended')} style={s.btnWarn}>Suspender</button>
            )}
          </div>
        </div>

        {/* ── Card: Límites editables ── */}
        <div style={s.card}>
          <h2 style={s.cardTitle}>Límites personalizados</h2>
          <p style={s.hint}>Dejar vacío para usar los del plan. Sobreescriben los límites del plan para este tenant.</p>

          <div style={s.limitRow}>
            <label style={s.limitLabel}>Publicaciones máx.</label>
            <input
              type="number"
              min={0}
              style={s.limitInput}
              placeholder="(del plan)"
              value={limits.max_publications}
              onChange={(e) => { setLimits((l) => ({ ...l, max_publications: e.target.value })); setLimitsEdited(true) }}
            />
          </div>
          <div style={s.limitRow}>
            <label style={s.limitLabel}>Páginas máx. por pub.</label>
            <input
              type="number"
              min={0}
              style={s.limitInput}
              placeholder="(del plan)"
              value={limits.max_pages_per_pub}
              onChange={(e) => { setLimits((l) => ({ ...l, max_pages_per_pub: e.target.value })); setLimitsEdited(true) }}
            />
          </div>
          <div style={s.limitRow}>
            <label style={s.limitLabel}>Storage máx. (MB)</label>
            <input
              type="number"
              min={0}
              style={s.limitInput}
              placeholder="(del plan)"
              value={limits.max_storage_mb}
              onChange={(e) => { setLimits((l) => ({ ...l, max_storage_mb: e.target.value })); setLimitsEdited(true) }}
            />
          </div>

          {limitsEdited && (
            <button onClick={handleSaveLimits} style={{ ...s.btnPrimary, marginTop: 12 }}>Guardar límites</button>
          )}
        </div>

      </div>

      {pendingReq && (
        <div style={{ ...s.card, borderLeft: '4px solid #f59e0b', gridColumn: '1 / -1', marginTop: 20 }}>
          <h2 style={s.cardTitle}>⚠️ Solicitud de cambio de plan pendiente</h2>
          <div style={s.row}>
            <span style={s.label}>Plan solicitado</span>
            <span style={{ ...s.value, fontWeight: 700, color: '#4f46e5', textTransform: 'uppercase' }}>{pendingReq.requested_plan}</span>
          </div>
          <div style={s.row}>
            <span style={s.label}>Dirección</span>
            <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: pendingReq.direction === 'upgrade' ? '#d1fae5' : '#fee2e2', color: pendingReq.direction === 'upgrade' ? '#065f46' : '#991b1b' }}>{pendingReq.direction}</span>
          </div>
          <div style={s.row}>
            <span style={s.label}>Fecha de solicitud</span>
            <span style={s.value}>{new Date(pendingReq.created_at).toLocaleDateString('es-AR')}</span>
          </div>
          {pendingReq.notes && (
            <div style={{ ...s.row, alignItems: 'flex-start' }}>
              <span style={s.label}>Mensaje del tenant</span>
              <span style={{ ...s.value, fontStyle: 'italic', color: '#6b7280' }}>{pendingReq.notes}</span>
            </div>
          )}
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #f3f4f6' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 12 }}>Registrar pago y activar plan</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div>
                <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 4 }}>Monto</label>
                <input type="number" placeholder="0.00" value={payReq.amount} onChange={(e) => setPayReq(p => ({ ...p, amount: e.target.value }))} style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box' as const }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 4 }}>Moneda</label>
                <select value={payReq.currency} onChange={(e) => setPayReq(p => ({ ...p, currency: e.target.value }))} style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 13 }}>
                  <option value="USD">USD</option>
                  <option value="ARS">ARS</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 4 }}>Método</label>
                <select value={payReq.method} onChange={(e) => setPayReq(p => ({ ...p, method: e.target.value }))} style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 13 }}>
                  <option value="transfer">Transferencia</option>
                  <option value="cash">Efectivo</option>
                  <option value="card">Tarjeta</option>
                  <option value="crypto">Crypto</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 4 }}>Referencia</label>
                <input type="text" placeholder="N° comprobante" value={payReq.reference} onChange={(e) => setPayReq(p => ({ ...p, reference: e.target.value }))} style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box' as const }} />
              </div>
            </div>
            <input type="text" placeholder="Notas del pago (opcional)" value={payReq.notes} onChange={(e) => setPayReq(p => ({ ...p, notes: e.target.value }))} style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 13, marginBottom: 10, boxSizing: 'border-box' as const }} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={handleActivateWithPayment} disabled={reqLoading || !payReq.amount} style={{ background: '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13, opacity: (!payReq.amount || reqLoading) ? 0.5 : 1 }}>
                {reqLoading ? '...' : '✓ Activar plan con pago registrado'}
              </button>
              <button onClick={handleSendPaymentInstructions} style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                📨 Enviar instrucciones de pago
              </button>
              <button onClick={() => setShowReject(!showReject)} style={{ background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                ✗ Rechazar
              </button>
            </div>
            {showReject && (
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="Motivo del rechazo..."
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  style={{ flex: 1, padding: '7px 10px', borderRadius: 7, border: '1px solid #fca5a5', fontSize: 13 }}
                />
                <button onClick={handleRejectRequest} disabled={reqLoading} style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                  Confirmar rechazo
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Historial de pagos ── */}
      <div style={{ ...s.card, marginTop: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ ...s.cardTitle, margin: 0 }}>Historial de pagos</h2>
          <button onClick={() => setShowPayModal(true)} style={s.btnPrimary}>+ Registrar pago manual</button>
        </div>

        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                {['Fecha', 'Monto', 'Moneda', 'Método', 'Referencia', 'Plan pagado', 'Notas'].map((h) => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '1.5rem', color: '#9ca3af', fontSize: 13 }}>Sin pagos registrados</td></tr>
              )}
              {payments.map((p) => (
                <tr key={p.id} style={s.tr}>
                  <td style={s.td}>{new Date(p.created_at).toLocaleDateString('es-AR')}</td>
                  <td style={{ ...s.td, fontWeight: 600 }}>${Number(p.amount).toFixed(2)}</td>
                  <td style={s.td}>{p.currency}</td>
                  <td style={s.td}>{METHOD_LABELS[p.method] ?? p.method}</td>
                  <td style={{ ...s.td, color: '#6b7280' }}>{p.reference || '—'}</td>
                  <td style={s.td}>{(p.plan_paid ?? '').toUpperCase() || '—'}</td>
                  <td style={{ ...s.td, color: '#6b7280', maxWidth: 200 }}>{p.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Zona peligro ── */}
      <div style={s.dangerCard}>
        <div>
          <h3 style={{ margin: 0, color: '#991b1b', fontSize: 14, fontWeight: 700 }}>Zona de peligro</h3>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#b91c1c' }}>Eliminar la cuenta borra permanentemente todas las publicaciones y datos del tenant.</p>
        </div>
        <button onClick={handleDelete} style={s.btnDanger}>Eliminar cuenta</button>
      </div>

      {/* ── Modal: Cambiar plan ── */}
      {showPlanModal && (
        <Modal title="Cambiar plan" onClose={() => setShowPlanModal(false)}>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0 }}>Selecciona el nuevo plan para <strong>{tenant.email}</strong>.</p>
          <label style={s.fieldLabel}>Plan</label>
          <select style={s.fieldSelect} value={newPlan} onChange={(e) => setNewPlan(e.target.value)}>
            <option value="free">Free</option>
            <option value="basic">Basic</option>
            <option value="pro">Pro</option>
          </select>
          <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowPlanModal(false)} style={s.btnSecondary}>Cancelar</button>
            <button onClick={handleSavePlan} style={s.btnPrimary}>Guardar</button>
          </div>
        </Modal>
      )}

      {/* ── Modal: Registrar pago ── */}
      {showPayModal && (
        <Modal title="Registrar pago manual" onClose={() => setShowPayModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <div style={s.fieldGroup}>
              <label style={s.fieldLabel}>Monto *</label>
              <input type="number" min={0} step="0.01" style={s.fieldInput} placeholder="0.00"
                value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ ...s.fieldGroup, flex: 1 }}>
                <label style={s.fieldLabel}>Moneda</label>
                <select style={s.fieldSelect} value={payForm.currency} onChange={(e) => setPayForm((f) => ({ ...f, currency: e.target.value }))}>
                  <option value="USD">USD</option>
                  <option value="DOP">DOP</option>
                </select>
              </div>
              <div style={{ ...s.fieldGroup, flex: 2 }}>
                <label style={s.fieldLabel}>Método</label>
                <select style={s.fieldSelect} value={payForm.method} onChange={(e) => setPayForm((f) => ({ ...f, method: e.target.value }))}>
                  <option value="transfer">Transferencia</option>
                  <option value="deposit">Depósito</option>
                  <option value="paypal">PayPal</option>
                  <option value="readdy">Readdy</option>
                  <option value="other">Otro</option>
                </select>
              </div>
            </div>

            <div style={s.fieldGroup}>
              <label style={s.fieldLabel}>Referencia</label>
              <input type="text" style={s.fieldInput} placeholder="Número de transacción, comprobante..."
                value={payForm.reference} onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))} />
            </div>

            <div style={s.fieldGroup}>
              <label style={s.fieldLabel}>Notas</label>
              <textarea style={{ ...s.fieldInput, height: 64, resize: 'vertical' as const }}
                placeholder="Observaciones adicionales..."
                value={payForm.notes} onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>

            <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
              Plan que se pagará: <strong>{(tenant.plan_id ?? 'free').toUpperCase()}</strong>
            </p>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowPayModal(false)} style={s.btnSecondary} disabled={payLoading}>Cancelar</button>
              <button onClick={handleRegisterPayment} style={s.btnPrimary} disabled={payLoading || !payForm.amount}>
                {payLoading ? 'Guardando...' : 'Registrar pago'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Constantes de colores ────────────────────────────────────────────────────

const PLAN_COLORS: Record<string, React.CSSProperties> = {
  free:  { background: '#f3f4f6', color: '#374151' },
  basic: { background: '#dbeafe', color: '#1e40af' },
  pro:   { background: '#ede9fe', color: '#5b21b6' },
}

const METHOD_LABELS: Record<string, string> = {
  transfer: 'Transferencia',
  deposit:  'Depósito',
  paypal:   'PayPal',
  readdy:   'Readdy',
  other:    'Otro',
}

// ── Estilos ──────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page:        { padding: '2rem 1.5rem', maxWidth: 1100 },
  breadcrumb:  { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, fontSize: 13 },
  breadLink:   { color: '#4f46e5', textDecoration: 'none', fontWeight: 500 },
  breadSep:    { color: '#9ca3af' },
  breadCurrent:{ color: '#6b7280' },
  pageHeader:  { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap' as const, gap: 12 },
  h1:          { fontSize: '1.5rem', fontWeight: 800, color: '#111827', margin: 0 },
  sub:         { color: '#6b7280', fontSize: 13, margin: '4px 0 0' },
  backBtn:     { background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer', color: '#374151', fontWeight: 500 },

  grid:        { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' },

  card:        { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '1.25rem' },
  cardTitle:   { fontSize: 14, fontWeight: 700, color: '#111827', margin: '0 0 14px' },
  row:         { display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 },
  label:       { color: '#6b7280', fontWeight: 500 },
  value:       { color: '#111827', fontWeight: 500, textAlign: 'right' as const, maxWidth: '65%', wordBreak: 'break-all' as const },
  hint:        { fontSize: 12, color: '#9ca3af', marginTop: 0, marginBottom: 12 },

  planBadge:   { fontSize: 13, fontWeight: 700, padding: '4px 14px', borderRadius: 20, letterSpacing: '0.03em' },
  statusBadge: { fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 10 },

  limitRow:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  limitLabel:  { fontSize: 13, color: '#374151', flex: 1 },
  limitInput:  { border: '1px solid #d1d5db', borderRadius: 7, padding: '5px 10px', fontSize: 13, width: 110, outline: 'none' },

  tableWrap:   { overflowX: 'auto' as const },
  table:       { width: '100%', borderCollapse: 'collapse' as const, minWidth: 600 },
  th:          { padding: '9px 12px', textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: '#6b7280', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' },
  tr:          { borderBottom: '1px solid #f9fafb' },
  td:          { padding: '9px 12px', fontSize: 13, verticalAlign: 'middle' as const },

  dangerCard:  { marginTop: 20, background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 12, padding: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' as const },

  toast:       { position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', color: '#fff', padding: '9px 22px', borderRadius: 8, fontSize: 13, zIndex: 999, whiteSpace: 'nowrap' as const },

  btnPrimary:  { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnSecondary:{ background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  btnSuccess:  { background: '#d1fae5', color: '#065f46', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnWarn:     { background: '#fef3c7', color: '#92400e', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnDanger:   { background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },

  fieldGroup:  { display: 'flex', flexDirection: 'column' as const, gap: 5 },
  fieldLabel:  { fontSize: 12, fontWeight: 600, color: '#374151' },
  fieldInput:  { border: '1px solid #d1d5db', borderRadius: 7, padding: '8px 10px', fontSize: 13, outline: 'none', fontFamily: 'inherit' },
  fieldSelect: { border: '1px solid #d1d5db', borderRadius: 7, padding: '8px 10px', fontSize: 13, background: '#fff', cursor: 'pointer', outline: 'none' },
}

// Estilos del modal (prefijo ms para distinguirlos)
const ms: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' },
  box:     { background: '#fff', borderRadius: 14, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,.2)' },
  header:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #e5e7eb' },
  title:   { fontWeight: 700, fontSize: 15, color: '#111827' },
  close:   { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#9ca3af', lineHeight: 1, padding: 4 },
  body:    { padding: '20px' },
}
