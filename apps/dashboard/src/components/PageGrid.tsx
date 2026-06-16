import { useState } from 'react'

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
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  if (pages.length === 0) {
    return <p style={{ color: '#999', textAlign: 'center', padding: '2rem 0' }}>Sin páginas aún. Agrega imágenes arriba.</p>
  }

  function handleDragStart(e: React.DragEvent, index: number) {
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setOverIndex(index)
  }

  function handleDrop(e: React.DragEvent, targetIndex: number) {
    e.preventDefault()
    if (dragIndex === null || dragIndex === targetIndex) { reset(); return }
    const next = [...pages]
    const [moved] = next.splice(dragIndex, 1)
    next.splice(targetIndex, 0, moved)
    onReorder(next)
    reset()
  }

  function handleDragEnd() { reset() }

  function reset() { setDragIndex(null); setOverIndex(null) }

  function moveToPosition(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return
    const next = [...pages]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    onReorder(next)
  }

  const cover = pages[0]
  const backCover = pages.length > 1 ? pages[pages.length - 1] : null
  const inner = pages.slice(1, pages.length > 1 ? pages.length - 1 : undefined)

  return (
    <div>
      {/* Slots portada / contraportada */}
      <div style={styles.coversRow}>
        <CoverSlot
          label="📖 Portada"
          subtitle="Primera imagen del flipbook"
          page={cover}
          pageIndex={0}
          totalPages={pages.length}
          onMakeFirst={() => {}}
          onDelete={onDelete}
          dragIndex={dragIndex}
          overIndex={overIndex}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
          onMoveToPosition={moveToPosition}
          isCover
        />
        {backCover && (
          <CoverSlot
            label="📕 Contraportada"
            subtitle="Última imagen del flipbook"
            page={backCover}
            pageIndex={pages.length - 1}
            totalPages={pages.length}
            onMakeFirst={() => {}}
            onDelete={onDelete}
            dragIndex={dragIndex}
            overIndex={overIndex}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            onMoveToPosition={moveToPosition}
            isBackCover
          />
        )}
      </div>

      {/* Páginas interiores */}
      {inner.length > 0 && (
        <>
          <p style={styles.innerLabel}>Páginas interiores — arrastrá para reordenar</p>
          <div style={styles.grid}>
            {inner.map((page, i) => {
              const realIndex = i + 1
              const isDragging = dragIndex === realIndex
              const isOver = overIndex === realIndex
              return (
                <div
                  key={page.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, realIndex)}
                  onDragOver={(e) => handleDragOver(e, realIndex)}
                  onDrop={(e) => handleDrop(e, realIndex)}
                  onDragEnd={handleDragEnd}
                  style={{
                    ...styles.card,
                    opacity: isDragging ? 0.4 : 1,
                    outline: isOver ? '2px dashed #4f46e5' : 'none',
                    cursor: 'grab',
                  }}
                >
                  <div style={styles.dragHandle}>⠿</div>
                  <img src={page.image_url} alt={`Página ${realIndex}`} style={styles.img} />
                  <div style={styles.footer}>
                    <span style={styles.num}>Pág {realIndex}</span>
                    <div style={styles.actions}>
                      <button
                        style={{ ...styles.btn, fontSize: '0.65rem', color: '#4f46e5' }}
                        title="Mover a portada"
                        onClick={() => moveToPosition(realIndex, 0)}
                      >↑ Portada</button>
                      <button
                        style={{ ...styles.btn, fontSize: '0.65rem', color: '#666' }}
                        title="Mover a contraportada"
                        onClick={() => moveToPosition(realIndex, pages.length - 1)}
                      >↓ Contra</button>
                      <button style={{ ...styles.btn, color: '#e53e3e' }} onClick={() => onDelete(page.id)}>✕</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

interface CoverSlotProps {
  label: string
  subtitle: string
  page: Page
  pageIndex: number
  totalPages: number
  onMakeFirst: () => void
  onDelete: (id: string) => void
  dragIndex: number | null
  overIndex: number | null
  onDragStart: (e: React.DragEvent, index: number) => void
  onDragOver: (e: React.DragEvent, index: number) => void
  onDrop: (e: React.DragEvent, index: number) => void
  onDragEnd: () => void
  onMoveToPosition: (from: number, to: number) => void
  isCover?: boolean
  isBackCover?: boolean
}

function CoverSlot({ label, subtitle, page, pageIndex, totalPages, onDelete, dragIndex, overIndex, onDragStart, onDragOver, onDrop, onDragEnd, onMoveToPosition, isCover, isBackCover }: CoverSlotProps) {
  const isDragging = dragIndex === pageIndex
  const isOver = overIndex === pageIndex
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, pageIndex)}
      onDragOver={(e) => onDragOver(e, pageIndex)}
      onDrop={(e) => onDrop(e, pageIndex)}
      onDragEnd={onDragEnd}
      style={{
        ...styles.coverSlot,
        opacity: isDragging ? 0.4 : 1,
        outline: isOver ? '2px dashed #4f46e5' : '2px solid ' + (isCover ? '#4f46e5' : '#9ca3af'),
      }}
    >
      <div style={{ ...styles.coverBadge, background: isCover ? '#4f46e5' : '#6b7280' }}>{label}</div>
      <p style={styles.coverSubtitle}>{subtitle}</p>
      <img src={page.image_url} alt={label} style={styles.coverImg} />
      <div style={styles.coverActions}>
        {isBackCover && (
          <button style={styles.coverBtn} onClick={() => onMoveToPosition(pageIndex, 0)}>
            ↑ Mover a portada
          </button>
        )}
        {isCover && totalPages > 1 && (
          <button style={{ ...styles.coverBtn, color: '#6b7280' }} onClick={() => onMoveToPosition(0, totalPages - 1)}>
            ↓ Mover a contraportada
          </button>
        )}
        <button style={{ ...styles.coverBtn, color: '#e53e3e' }} onClick={() => onDelete(page.id)}>
          Eliminar
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  coversRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' },
  coverSlot: { borderRadius: 10, padding: '0.75rem', background: '#f8f9ff', textAlign: 'center', cursor: 'grab' },
  coverBadge: { display: 'inline-block', color: '#fff', fontSize: '0.7rem', fontWeight: 700, padding: '3px 10px', borderRadius: 20, marginBottom: '0.3rem' },
  coverSubtitle: { fontSize: '0.7rem', color: '#888', margin: '0 0 0.5rem' },
  coverImg: { width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 6, display: 'block' },
  coverActions: { display: 'flex', gap: '0.4rem', marginTop: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' },
  coverBtn: { background: 'none', border: '1px solid #ddd', borderRadius: 6, fontSize: '0.7rem', padding: '3px 8px', cursor: 'pointer', color: '#4f46e5' },
  innerLabel: { fontSize: '0.8rem', color: '#888', margin: '0 0 0.75rem', fontWeight: 500 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '0.75rem' },
  card: { borderRadius: 8, overflow: 'hidden', border: '1px solid #eee', background: '#fafafa', position: 'relative' },
  dragHandle: { position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,.35)', color: '#fff', borderRadius: 4, fontSize: '0.7rem', padding: '1px 4px', lineHeight: 1.4, zIndex: 1 },
  img: { width: '100%', aspectRatio: '0.707', objectFit: 'cover', display: 'block' },
  footer: { padding: '0.4rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', flexWrap: 'wrap', gap: '0.2rem' },
  num: { fontSize: '0.72rem', color: '#666' },
  actions: { display: 'flex', gap: '0.2rem', flexWrap: 'wrap' },
  btn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', padding: '2px 4px' },
}
