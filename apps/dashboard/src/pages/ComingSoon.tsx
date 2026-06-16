interface Props { title: string; description?: string }

export default function ComingSoon({ title, description }: Props) {
  return (
    <div style={{ padding: '3rem 2rem', textAlign: 'center', color: 'var(--color-muted)' }}>
      <div style={{ fontSize: 48, marginBottom: '1rem' }}>🚧</div>
      <h2 style={{ color: 'var(--color-text)', marginBottom: '0.5rem' }}>{title}</h2>
      <p style={{ fontSize: 'var(--text-sm)' }}>{description ?? 'Esta sección está en desarrollo.'}</p>
    </div>
  )
}
