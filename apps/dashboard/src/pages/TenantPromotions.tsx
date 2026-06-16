import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE } from '../lib/api'

function authH() {
  const t = localStorage.getItem('token')
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

type Promotion = {
  id: number
  title: string
  description: string
  benefit_type: 'descuento_%' | 'dias_gratis' | 'upgrade' | 'otro'
  benefit_value: string
  cta_label: string
  cta_url: string
  expires_at: string | null
  active: boolean
}

const BENEFIT_LABEL: Record<string, string> = {
  'descuento_%': 'Descuento',
  'dias_gratis': 'Días gratis',
  'upgrade':     'Upgrade',
  'otro':        'Beneficio',
}
const BENEFIT_COLOR: Record<string, string> = {
  'descuento_%': '#4f46e5',
  'dias_gratis': '#059669',
  'upgrade':     '#7c3aed',
  'otro':        '#d97706',
}

function isExpired(expires_at: string | null) {
  if (!expires_at) return false
  return new Date(expires_at) < new Date()
}

// TODO: reemplazar con datos reales cuando GET /api/promotions esté implementado
const MOCK_PROMOTIONS: Promotion[] = [
  {
    id: 1,
    title: '20% OFF en plan Basic',
    description: 'Aprovechá este descuento exclusivo para usuarios del plan Free.',
    benefit_type: 'descuento_%',
    benefit_value: '20%',
    cta_label: 'Activar descuento',
    cta_url: '#',
    expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    active: true,
  },
  {
    id: 2,
    title: '7 días gratis de plan Pro',
    description: 'Probá todas las funciones Pro sin costo por una semana.',
    benefit_type: 'dias_gratis',
    benefit_value: '7 días',
    cta_label: 'Probar gratis',
    cta_url: '#',
    expires_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    active: false,
  },
]

export default function TenantPromotions() {
  const navigate = useNavigate()
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    if (!localStorage.getItem('token')) { navigate('/login'); return }
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const r = await fetch(`${API_BASE}/api/promotions`, { headers: authH() })
      if (r.ok) {
        const d = await r.json()
        setPromotions(d.data ?? [])
      } else {
        setPromotions(MOCK_PROMOTIONS)
      }
    } catch {
      setPromotions(MOCK_PROMOTIONS)
    } finally {
      setLoading(false)
    }
  }

  const active  = promotions.filter((p) => p.active && !isExpired(p.expires_at))
  const expired = promotions.filter((p) => !p.active || isExpired(p.expires_at))

  if (loading) return <div style={s.loading}>Cargando promociones...</div>

  return (
    <div style={s.page}>
      <div style={s.inner}>
        <div style={s.pageHeader}>
          <h1 style={s.h1}>Promociones</h1>
          <p style={s.sub}>Ofertas y beneficios disponibles para tu plan</p>
        </div>

        {active.length === 0 && expired.length === 0 ? (
          <div style={s.empty}>
            <div style={s.emptyIcon}>🎁</div>
            <p>No hay promociones disponibles en este momento.</p>
          </div>
        ) : (
          <>
            {active.length > 0 && (
              <section>
                <h2 style={s.sectionTitle}>Promociones activas</h2>
                <div style={s.list}>
                  {active.map((promo) => (
                    <PromotionCard key={promo.id} promo={promo} faded={false} />
                  ))}
                </div>
              </section>
            )}

            {active.length === 0 && (
              <div style={{ ...s.empty, padding: '2rem' }}>
                <p style={{ margin: 0 }}>No hay promociones disponibles en este momento.</p>
              </div>
            )}

            {expired.length > 0 && (
              <section>
                <h2 style={{ ...s.sectionTitle, color: '#9ca3af' }}>Vencidas</h2>
                <div style={s.list}>
                  {expired.map((promo) => (
                    <PromotionCard key={promo.id} promo={promo} faded={true} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function PromotionCard({ promo, faded }: { promo: Promotion; faded: boolean }) {
  const benefitType = promo.benefit_type as string
  return (
    <div style={{ ...s.card, opacity: faded ? 0.6 : 1 }}>
      <div style={s.cardLeft}>
        <div style={s.cardTop}>
          <h3 style={s.cardTitle}>{promo.title}</h3>
          <span style={{ ...s.benefitBadge, background: faded ? '#9ca3af' : BENEFIT_COLOR[benefitType] }}>
            {BENEFIT_LABEL[benefitType] ?? 'Beneficio'}: {promo.benefit_value}
          </span>
        </div>
        <p style={s.cardDesc}>{promo.description}</p>
        {promo.expires_at && (
          <p style={s.expires}>
            {faded ? 'Venció el' : 'Vence el'}{' '}
            {new Date(promo.expires_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        )}
      </div>
      {!faded && promo.cta_label && promo.cta_url && (
        <a href={promo.cta_url} target="_blank" rel="noopener noreferrer" style={s.ctaBtn}>
          {promo.cta_label}
        </a>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page:         { minHeight: '100vh', background: '#f8fafc' },
  loading:      { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#6b7280' },
  inner:        { maxWidth: 800, margin: '0 auto', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' },
  pageHeader:   { display: 'flex', flexDirection: 'column', gap: 4 },
  h1:           { fontSize: '1.5rem', fontWeight: 800, color: '#111827', margin: 0 },
  sub:          { color: '#6b7280', fontSize: 14, margin: 0 },
  sectionTitle: { fontSize: '1rem', fontWeight: 700, color: '#374151', margin: '0 0 12px' },
  empty:        { textAlign: 'center', padding: '4rem', color: '#9ca3af', background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb' },
  emptyIcon:    { fontSize: 48, marginBottom: 12 },
  list:         { display: 'flex', flexDirection: 'column', gap: 12 },
  card:         { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' },
  cardLeft:     { flex: 1 },
  cardTop:      { display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 6, flexWrap: 'wrap' },
  cardTitle:    { fontWeight: 700, fontSize: 15, color: '#111827', margin: 0 },
  benefitBadge: { fontSize: 11, color: '#fff', borderRadius: 10, padding: '3px 10px', fontWeight: 600, whiteSpace: 'nowrap' },
  cardDesc:     { fontSize: 13, color: '#6b7280', margin: '0 0 6px', lineHeight: 1.5 },
  expires:      { fontSize: 12, color: '#9ca3af', margin: 0 },
  ctaBtn:       { background: '#4f46e5', color: '#fff', borderRadius: 8, padding: '8px 18px', fontWeight: 600, fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 },
}
