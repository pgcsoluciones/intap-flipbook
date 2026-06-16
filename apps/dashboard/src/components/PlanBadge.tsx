interface Props {
  plan?: string
}

const COLORS: Record<string, { bg: string; color: string }> = {
  free:  { bg: '#e2e8f0', color: '#4a5568' },
  basic: { bg: '#ebf4ff', color: '#2b6cb0' },
  pro:   { bg: '#faf5ff', color: '#6b21a8' },
}

export default function PlanBadge({ plan = 'free' }: Props) {
  const style = COLORS[plan] ?? COLORS.free
  return (
    <span style={{ ...styles.badge, background: style.bg, color: style.color }}>
      {plan.charAt(0).toUpperCase() + plan.slice(1)}
    </span>
  )
}

const styles: Record<string, React.CSSProperties> = {
  badge: { padding: '0.2rem 0.6rem', borderRadius: 20, fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' },
}
