import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE } from '../lib/api'

function authH() {
  const t = localStorage.getItem('token')
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

type ReferralConfig = {
  active: number | boolean
  reward_type: 'dias_gratis' | 'descuento_%'
  reward_value: number
  condition: 'solo_registro' | 'plan_pagado'
}

type Referral = {
  id: number
  referred_email: string
  created_at: string
  status: 'pendiente' | 'aprobado' | 'rechazado'
  reward_applied: boolean
}

type ReferralStats = {
  referral_code: string
  total_referred: number
  active_referred: number
  rewards_earned: number
  referrals: Referral[]
}

function rewardLabel(config: ReferralConfig) {
  if (config.reward_type === 'dias_gratis') return `${config.reward_value} días gratis`
  return `${config.reward_value}% de descuento`
}

function conditionLabel(config: ReferralConfig) {
  if (config.condition === 'plan_pagado') return 'cuando activen un plan pago'
  return 'al registrarse'
}

function statusBadge(status: string) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    pendiente:  { bg: '#fef3c7', color: '#92400e', label: 'Pendiente' },
    aprobado:   { bg: '#d1fae5', color: '#065f46', label: 'Aprobado' },
    rechazado:  { bg: '#fee2e2', color: '#991b1b', label: 'Rechazado' },
  }
  const st = map[status] ?? map.pendiente
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: st.bg, color: st.color }}>
      {st.label}
    </span>
  )
}

// TODO: reemplazar con datos reales cuando los endpoints de referidos para tenant estén implementados
const MOCK_CONFIG: ReferralConfig = { active: 1, reward_type: 'dias_gratis', reward_value: 7, condition: 'solo_registro' }
const MOCK_STATS: ReferralStats = {
  referral_code: 'DEMO123',
  total_referred: 3,
  active_referred: 2,
  rewards_earned: 2,
  referrals: [
    { id: 1, referred_email: 'amigo@ejemplo.com', created_at: new Date(Date.now() - 5 * 86400000).toISOString(), status: 'aprobado', reward_applied: true },
    { id: 2, referred_email: 'vecino@ejemplo.com', created_at: new Date(Date.now() - 2 * 86400000).toISOString(), status: 'pendiente', reward_applied: false },
    { id: 3, referred_email: 'colega@ejemplo.com', created_at: new Date(Date.now() - 86400000).toISOString(), status: 'rechazado', reward_applied: false },
  ],
}

const VIEWER_BASE = import.meta.env.VITE_VIEWER_BASE_URL ?? 'https://intap-flipbook-dashboard.pages.dev'

export default function TenantReferrals() {
  const navigate = useNavigate()
  const [config, setConfig]   = useState<ReferralConfig | null>(null)
  const [stats, setStats]     = useState<ReferralStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied]   = useState(false)

  useEffect(() => {
    if (!localStorage.getItem('token')) { navigate('/login'); return }
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const [cr, sr] = await Promise.all([
        fetch(`${API_BASE}/api/referral-config`, { headers: authH() }),
        fetch(`${API_BASE}/api/referrals/my`, { headers: authH() }),
      ])
      if (cr.ok && sr.ok) {
        const cd = await cr.json()
        const sd = await sr.json()
        setConfig(cd.data)
        setStats(sd.data)
      } else {
        setConfig(MOCK_CONFIG)
        setStats(MOCK_STATS)
      }
    } catch {
      setConfig(MOCK_CONFIG)
      setStats(MOCK_STATS)
    } finally {
      setLoading(false)
    }
  }

  function buildRefUrl(code: string) {
    return `${VIEWER_BASE}/register?ref=${code}`
  }

  async function copyLink() {
    if (!stats) return
    try {
      await navigator.clipboard.writeText(buildRefUrl(stats.referral_code))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Si el portapapeles no está disponible, no hacer nada
    }
  }

  function shareWhatsApp() {
    if (!stats) return
    const text = encodeURIComponent(`Unite a Intap Flipbook usando mi link: ${buildRefUrl(stats.referral_code)}`)
    window.open(`https://wa.me/?text=${text}`, '_blank')
  }

  if (loading) return <div style={s.loading}>Cargando programa de referidos...</div>

  if (!config || !Number(config.active)) {
    return (
      <div style={s.page}>
        <div style={s.inner}>
          <div style={s.empty}>
            <div style={s.emptyIcon}>🔗</div>
            <p style={{ fontWeight: 600, color: '#374151', fontSize: 16, margin: '0 0 8px' }}>
              Programa de referidos no disponible
            </p>
            <p style={{ color: '#9ca3af', margin: 0, fontSize: 14 }}>
              El programa de referidos no está disponible actualmente.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const refUrl = stats ? buildRefUrl(stats.referral_code) : ''

  return (
    <div style={s.page}>
      <div style={s.inner}>
        <div style={s.pageHeader}>
          <h1 style={s.h1}>Programa de referidos</h1>
          <p style={s.sub}>Invitá amigos y ganás recompensas</p>
        </div>

        <div style={s.twoCol}>
          <div style={s.card}>
            <h2 style={s.cardTitle}>Tu link de referido</h2>
            <div style={s.linkBox}>
              <span style={s.linkText}>{refUrl}</span>
            </div>
            <div style={s.shareRow}>
              <button onClick={copyLink} style={s.btnPrimary}>
                {copied ? '✓ Copiado' : '📋 Copiar link'}
              </button>
              <button onClick={shareWhatsApp} style={s.btnWhatsapp}>
                💬 Compartir por WhatsApp
              </button>
            </div>
          </div>

          {config && (
            <div style={s.card}>
              <h2 style={s.cardTitle}>Tu recompensa</h2>
              <div style={s.rewardBox}>
                <span style={s.rewardValue}>{rewardLabel(config)}</span>
                <p style={s.rewardDesc}>
                  Recibís {rewardLabel(config)} {conditionLabel(config)}.
                </p>
              </div>
            </div>
          )}
        </div>

        {stats && (
          <div style={s.statsRow}>
            <StatCard label="Referidos registrados" value={stats.total_referred} icon="👥" />
            <StatCard label="Referidos activos" value={stats.active_referred} icon="✅" />
            <StatCard label="Recompensas ganadas" value={stats.rewards_earned} icon="🎁" />
          </div>
        )}

        {stats && stats.referrals.length > 0 && (
          <div style={s.card}>
            <h2 style={s.cardTitle}>Historial de referidos</h2>
            <table style={s.table}>
              <thead>
                <tr>
                  {['Email del referido', 'Fecha', 'Estado'].map((h) => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.referrals.map((r) => (
                  <tr key={r.id} style={s.tr}>
                    <td style={s.td}>{r.referred_email}</td>
                    <td style={s.td}>{new Date(r.created_at).toLocaleDateString('es-AR')}</td>
                    <td style={s.td}>{statusBadge(r.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {stats && stats.referrals.length === 0 && (
          <div style={{ ...s.card, textAlign: 'center', padding: '2rem', color: '#9ca3af' }}>
            Aún no tenés referidos. ¡Compartí tu link y empezá a ganar recompensas!
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <div style={s.statCard}>
      <span style={s.statIcon}>{icon}</span>
      <span style={s.statValue}>{value}</span>
      <span style={s.statLabel}>{label}</span>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page:       { minHeight: '100vh', background: '#f8fafc' },
  loading:    { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#6b7280' },
  inner:      { maxWidth: 900, margin: '0 auto', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' },
  pageHeader: { display: 'flex', flexDirection: 'column', gap: 4 },
  h1:         { fontSize: '1.5rem', fontWeight: 800, color: '#111827', margin: 0 },
  sub:        { color: '#6b7280', fontSize: 14, margin: 0 },
  empty:      { textAlign: 'center', padding: '4rem', color: '#9ca3af', background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb' },
  emptyIcon:  { fontSize: 48, marginBottom: 12 },
  twoCol:     { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' },
  card:       { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '1.25rem 1.5rem' },
  cardTitle:  { fontSize: 15, fontWeight: 700, color: '#111827', margin: '0 0 1rem' },
  linkBox:    { background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 14px', marginBottom: 12, wordBreak: 'break-all' },
  linkText:   { fontSize: 13, color: '#374151', fontFamily: 'monospace' },
  shareRow:   { display: 'flex', gap: 10, flexWrap: 'wrap' },
  btnPrimary: { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 600, cursor: 'pointer', fontSize: 13 },
  btnWhatsapp:{ background: '#25D366', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 600, cursor: 'pointer', fontSize: 13 },
  rewardBox:  { background: '#eef2ff', borderRadius: 10, padding: '1rem', display: 'flex', flexDirection: 'column', gap: 8 },
  rewardValue:{ fontSize: '1.3rem', fontWeight: 800, color: '#4f46e5' },
  rewardDesc: { fontSize: 13, color: '#374151', margin: 0 },
  statsRow:   { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' },
  statCard:   { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '1.25rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center' },
  statIcon:   { fontSize: 28 },
  statValue:  { fontSize: '2rem', fontWeight: 800, color: '#111827', lineHeight: 1 },
  statLabel:  { fontSize: 12, color: '#6b7280' },
  table:      { width: '100%', borderCollapse: 'collapse' },
  th:         { padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#6b7280', borderBottom: '1px solid #f3f4f6', background: '#fafafa' },
  tr:         { borderBottom: '1px solid #f9fafb' },
  td:         { padding: '10px 10px', fontSize: 13, verticalAlign: 'middle' },
}
