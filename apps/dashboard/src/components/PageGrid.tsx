interface Page {
  id: string
  page_number: number
  image_url: string
  title?: string
  price?: string
}

interface Props {
  pages: Page[]
  onDelete: (id: string) => void
  onReorder: (pages: Page[]) => void
}

export default function PageGrid({ pages, onDelete, onReorder }: Props) {
  function moveUp(index: number) {
    if (index === 0) return
    const next = [...pages]
    ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
    onReorder(next)
  }

  function moveDown(index: number) {
    if (index === pages.length - 1) return
    const next = [...pages]
    ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
    onReorder(next)
  }

  if (pages.length === 0) {
    return <p style={{ color: '#999', textAlign: 'center', padding: '2rem 0' }}>Sin páginas aún. Agrega imágenes arriba.</p>
  }

  return (
    <div style={styles.grid}>
      {pages.map((page, index) => (
        <div key={page.id} style={{ ...styles.card, ...(index === 0 ? styles.coverCard : {}) }}>
          {index === 0 && <div style={styles.coverBadge}>📖 Portada</div>}
          <img src={page.image_url} alt={page.title ?? `Página ${index + 1}`} style={styles.img} />
          <div style={styles.footer}>
            <span style={styles.num}>{index === 0 ? 'Portada' : `#${index}`}</span>
            <div style={styles.actions}>
              <button style={styles.btn} onClick={() => moveUp(index)} disabled={index === 0}>↑</button>
              <button style={styles.btn} onClick={() => moveDown(index)} disabled={index === pages.length - 1}>↓</button>
              <button style={{ ...styles.btn, color: '#e53e3e' }} onClick={() => onDelete(page.id)}>✕</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.75rem' },
  card: { borderRadius: 8, overflow: 'hidden', border: '1px solid #eee', background: '#fafafa', position: 'relative' },
  coverCard: { border: '2px solid #4f46e5' },
  coverBadge: { position: 'absolute', top: 6, left: 6, background: '#4f46e5', color: '#fff', fontSize: '0.65rem', fontWeight: 600, padding: '2px 6px', borderRadius: 4, zIndex: 1 },
  img: { width: '100%', aspectRatio: '0.707', objectFit: 'cover', display: 'block' },
  footer: { padding: '0.4rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff' },
  num: { fontSize: '0.75rem', color: '#666' },
  actions: { display: 'flex', gap: '0.25rem' },
  btn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', padding: '2px 4px' },
}
