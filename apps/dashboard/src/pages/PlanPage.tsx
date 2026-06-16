import { useEffect, useState } from 'react'
import { api } from '../lib/api'

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: 'siempre gratis',
    color: '#6b7280',
    features: ['1 publicación', '10 páginas por flipbook', '50 MB de almacenamiento', 'Viewer público'],
    cta: null,
  },
  {
    id: 'basic',
    name: 'Basic',
    price: '$9.99',
    period: '/mes',
    color: '#4f46e5',
    features: ['5 publicaciones', '50 páginas por flipbook', '500 MB de almacenamiento', 'Sonido al voltear páginas', 'Viewer público'],
    cta: 'Actualizar a Basic',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$29.99',
    period: '/mes',
    color: '#7c3aed',
    features: ['Publicaciones ilimitadas', 'Páginas ilimitadas', '5 GB de almacenamiento', 'Sonido al voltear páginas', 'Dominio personalizado', 'Viewer público'],
    cta: 'Actualizar a Pro',
  },
]

function UsageBar({ label, used, max, unlimited }: { label: string; used: number; max: number | null; unlimited?: boolean }) {
  const pct = unlimited || !max ? 0 : Math.min((used / max) * 100, 100)
  const danger  = pct >= 90
  const warning = pct >= 70

  return (
    <div style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#374151', marginBottom: '0.35rem' }}>
        <span>{label}</span>
        <span style={{ color: danger ? '#dc2626' : warning ? '#d97706' : '#6b7280' }}>
          {unlimited ? `${used} / ∞` : `${used} / ${max}`}
        </span>
      </div>
      <div style={{ height: 6, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: unlimited ? '5%' : `${pct}%`,
          background: danger ? '#dc2626' : warning ? '#f59e0b' : '#4f46e5',
          borderRadius: 4,
          transition: 'width .4s',
        }} />
      </div>
    </div>
  )
}

export default function PlanPage() {
  const [usage, setUsage] = useState<any>(null)

  useEffect(() => {
    api.plan.usage().then((r) => setUsage(r.data))
  }, [])

  const currentPlanId = usage?.plan_id ?? 'free'

  return (
    <div style={styles.page}>
      <h1 style={styles.h1}>Mi Plan</h1>
      <p style={styles.subtitle}>Administrá tu suscripción y revisá el uso de tu cuenta.</p>

      {usage && (
        <section style={styles.card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <div>
              <h2 style={styles.sectionTitle}>Uso actual</h2>
              <p style={{ fontSize: '0.8rem', color: '#9ca3af', margin: 0 }}>Plan activo: <strong>{usage.plan_name}</strong></p>
            </div>
            <span style={{
              background: currentPlanId === 'pro' ? '#7c3aed' : currentPlanId === 'basic' ? '#4f46e5' : '#6b7280',
              color: '#fff', borderRadius: 12, padding: '4px 12px', fontWeight: 700, fontSize: '0.8rem',
            }}>
              {usage.plan_name}
            </span>
          </div>
          <UsageBar
            label="Publicaciones"
            used={usage.publications.used}
            max={usage.publications.max}
            unlimited={usage.publications.unlimited}
          />
          <UsageBar
            label="Almacenamiento"
            used={parseFloat(usage.storage.used_mb.toFixed(1))}
            max={usage.storage.max_mb}
          />
          <div style={styles.featureList}>
            <FeatureItem active={usage.features.sound_enabled} label="Sonido al voltear páginas" />
            <FeatureItem active={usage.features.custom_domain}  label="Dominio personalizado" />
            <FeatureItem active label={`Hasta ${usage.features.max_pages_per_pub ?? '∞'} páginas por flipbook`} />
          </div>
        </section>
      )}

      {/* Plan cards */}
      <h2 style={{ ...styles.sectionTitle, marginBottom: '1rem' }}>Planes disponibles</h2>
      <div style={styles.planGrid}>
        {PLANS.map((plan) => {
          const isCurrent = plan.id === currentPlanId
          return (
            <div key={plan.id} style={{
              ...styles.planCard,
              borderColor: isCurrent ? plan.color : '#e5e7eb',
              boxShadow: isCurrent ? `0 0 0 2px ${plan.color}` : 'none',
            }}>
              {isCurrent && <div style={{ ...styles.currentBadge, background: plan.color }}>Plan actual</div>}
              <h3 style={{ color: plan.color, fontWeight: 800, fontSize: '1.25rem', margin: '0 0 0.25rem' }}>{plan.name}</h3>
              <p style={{ margin: '0 0 1rem' }}>
                <span style={{ fontSize: '1.75rem', fontWeight: 700, color: '#111827' }}>{plan.price}</span>
                <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>{plan.period}</span>
              </p>
              <ul style={styles.featureUl}>
                {plan.features.map((f) => (
                  <li key={f} style={styles.featureLi}>
                    <span style={{ color: plan.color, marginRight: 6 }}>✓</span>{f}
                  </li>
                ))}
              </ul>
              {plan.cta && !isCurrent && (
                <button
                  style={{ ...styles.ctaBtn, background: plan.color }}
                  onClick={() => alert('Pagos con Stripe — próximamente 🚀')}
                >
                  {plan.cta}
                </button>
              )}
              {isCurrent && (
                <p style={{ textAlign: 'center', color: '#9ca3af', fontSize: '0.8rem', margin: '0.5rem 0 0' }}>Estás en este plan</p>
              )}
            </div>
          )
        })}
      </div>

      <p style={styles.note}>
        Para cambiar de plan o cancelar tu suscripción, contactá a soporte en <strong>soporte@intapflipbook.com</strong>
      </p>
    </div>
  )
}

function FeatureItem({ active, label }: { active: boolean; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0', fontSize: '0.875rem', color: active ? '#374151' : '#9ca3af' }}>
      <span style={{ fontSize: '1rem' }}>{active ? '✅' : '❌'}</span>
      {label}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page:         { padding: '2rem 1.5rem', fontFamily: 'Inter, system-ui, sans-serif', maxWidth: 900, margin: '0 auto' },
  h1:           { fontSize: '1.5rem', fontWeight: 800, color: '#111827', margin: '0 0 0.25rem' },
  subtitle:     { color: '#6b7280', fontSize: '0.9rem', margin: '0 0 1.5rem' },
  card:         { background: '#fff', borderRadius: 12, padding: '1.5rem', border: '1px solid #e5e7eb', marginBottom: '2rem' },
  sectionTitle: { fontSize: '1rem', fontWeight: 700, color: '#111827', margin: '0 0 0.5rem' },
  featureList:  { borderTop: '1px solid #f3f4f6', marginTop: '0.75rem', paddingTop: '0.75rem' },
  planGrid:     { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '1.5rem' },
  planCard:     { background: '#fff', borderRadius: 12, padding: '1.5rem', border: '2px solid #e5e7eb', position: 'relative', display: 'flex', flexDirection: 'column', gap: '0' },
  currentBadge: { position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', color: '#fff', fontSize: '0.7rem', fontWeight: 700, padding: '3px 12px', borderRadius: 12, whiteSpace: 'nowrap' },
  featureUl:    { listStyle: 'none', padding: 0, margin: '0 0 1rem', flex: 1 },
  featureLi:    { fontSize: '0.85rem', color: '#374151', padding: '0.25rem 0' },
  ctaBtn:       { color: '#fff', border: 'none', borderRadius: 8, padding: '0.65rem', fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem', width: '100%', marginTop: 'auto' },
  note:         { fontSize: '0.8rem', color: '#9ca3af', textAlign: 'center' },
}
