import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

type Proposal = {
  id: number
  user_id: string
  publication_id: string
  title: string
  description: string | null
  category: string | null
  cover_url: string | null
  status: 'pending' | 'approved' | 'rejected'
  admin_notes: string | null
  resolved_at: string | null
  created_at: string
  user_name: string
  user_email: string
  publication_title: string | null
}

const STATUS_LABELS: Record<string, string> = {
  pending:  'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
}
const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  pending:  { bg: '#fef9c3', color: '#854d0e' },
  approved: { bg: '#d1fae5', color: '#065f46' },
  rejected: { bg: '#fee2e2', color: '#991b1b' },
}

export default function AdminTemplateProposals() {
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loading, setLoading]     = useState(true)
  const [filter, setFilter]       = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending')
  const [msg, setMsg]             = useState('')
  const [rejectModal, setRejectModal] = useState<{ id: number } | null>(null)
  const [rejectNotes, setRejectNotes] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const res = await api.proposals.listAll()
      setProposals(res.data ?? [])
    } catch (err: any) {
      setMsg('Error al cargar propuestas: ' + (err.message ?? 'desconocido'))
    } finally {
      setLoading(false)
    }
  }

  async function handleApprove(id: number) {
    setMsg('')
    try {
      await api.proposals.approve(id)
      setMsg('✅ Propuesta aprobada y plantilla creada.')
      setProposals((prev) => prev.map((p) => p.id === id ? { ...p, status: 'approved' } : p))
    } catch (err: any) {
      setMsg('Error: ' + (err.message ?? 'desconocido'))
    }
  }

  async function handleReject() {
    if (!rejectModal) return
    setMsg('')
    try {
      await api.proposals.reject(rejectModal.id, rejectNotes.trim() || undefined)
      setMsg('Propuesta rechazada.')
      setProposals((prev) => prev.map((p) => p.id === rejectModal.id ? { ...p, status: 'rejected', admin_notes: rejectNotes || null } : p))
      setRejectModal(null)
      setRejectNotes('')
    } catch (err: any) {
      setMsg('Error: ' + (err.message ?? 'desconocido'))
    }
  }

  const filtered = filter === 'all' ? proposals : proposals.filter((p) => p.status === filter)

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>Propuestas de plantilla</h1>
          <p style={s.sub}>Publicaciones enviadas por tenants para convertirse en plantillas del catálogo</p>
        </div>
        <button onClick={load} style={s.btnRefresh}>↺ Actualizar</button>
      </div>

      {msg && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: msg.startsWith('Error') ? '#fee2e2' : '#d1fae5', color: msg.startsWith('Error') ? '#991b1b' : '#065f46', fontSize: 13 }}>
          {msg}
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {(['all', 'pending', 'approved', 'rejected'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              ...s.filterBtn,
              background: filter === f ? '#4f46e5' : '#fff',
              color: filter === f ? '#fff' : '#374151',
              borderColor: filter === f ? '#4f46e5' : '#d1d5db',
            }}
          >
            {f === 'all' ? 'Todas' : STATUS_LABELS[f]}
            {' '}({f === 'all' ? proposals.length : proposals.filter((p) => p.status === f).length})
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>Cargando...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.4 }}>⭐</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Sin propuestas</div>
          <div style={{ fontSize: 13 }}>Cuando un tenant proponga una plantilla, aparecerá aquí.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map((p) => {
            const sc = STATUS_COLORS[p.status] ?? STATUS_COLORS.pending
            return (
              <div key={p.id} style={s.card}>
                {/* Portada */}
                {p.cover_url && (
                  <img
                    src={p.cover_url}
                    alt={p.title}
                    style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
                  />
                )}
                {!p.cover_url && (
                  <div style={{ width: 80, height: 80, borderRadius: 8, background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ fontSize: 32, opacity: 0.3 }}>📄</span>
                  </div>
                )}

                {/* Info */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>{p.title}</span>
                    <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: sc.bg, color: sc.color }}>
                      {STATUS_LABELS[p.status]}
                    </span>
                    {p.category && (
                      <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, background: '#f3f4f6', color: '#6b7280' }}>{p.category}</span>
                    )}
                  </div>
                  {p.description && <div style={{ fontSize: 13, color: '#4b5563', marginBottom: 4 }}>{p.description}</div>}
                  <div style={{ fontSize: 12, color: '#9ca3af' }}>
                    De: <strong style={{ color: '#6b7280' }}>{p.user_name ?? p.user_email}</strong>
                    {' · '}Flipbook: <em>{p.publication_title ?? p.publication_id}</em>
                    {' · '}{new Date(p.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </div>
                  {p.admin_notes && (
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4, fontStyle: 'italic' }}>
                      Nota admin: {p.admin_notes}
                    </div>
                  )}
                </div>

                {/* Acciones */}
                {p.status === 'pending' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                    <button onClick={() => handleApprove(p.id)} style={s.btnApprove}>✓ Aprobar</button>
                    <button onClick={() => { setRejectModal({ id: p.id }); setRejectNotes('') }} style={s.btnReject}>✕ Rechazar</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal de rechazo */}
      {rejectModal && (
        <div style={s.overlay} onClick={(e) => e.target === e.currentTarget && setRejectModal(null)}>
          <div style={s.modal}>
            <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Rechazar propuesta</h2>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Podés incluir una nota opcional para explicarle al usuario por qué fue rechazada.</p>
            <textarea
              autoFocus
              style={{ width: '100%', minHeight: 80, padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
              placeholder="Nota opcional para el tenant..."
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button onClick={() => setRejectModal(null)} style={s.btnCancel}>Cancelar</button>
              <button onClick={handleReject} style={s.btnReject}>Confirmar rechazo</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page:       { padding: '2rem 1.5rem', maxWidth: 900 },
  header:     { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.25rem' },
  h1:         { fontSize: '1.5rem', fontWeight: 800, color: '#111827', margin: 0 },
  sub:        { color: '#6b7280', fontSize: 13, margin: '4px 0 0' },
  filterBtn:  { padding: '5px 14px', borderRadius: 20, border: '1px solid', cursor: 'pointer', fontSize: 13, fontWeight: 500, transition: 'all .15s' },
  btnRefresh: { padding: '6px 14px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', color: '#374151', cursor: 'pointer', fontSize: 13 },
  card:       { display: 'flex', gap: 16, alignItems: 'flex-start', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16 },
  btnApprove: { padding: '6px 14px', borderRadius: 8, background: '#059669', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btnReject:  { padding: '6px 14px', borderRadius: 8, background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btnCancel:  { padding: '6px 14px', borderRadius: 8, background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', cursor: 'pointer', fontSize: 13 },
  overlay:    { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal:      { background: '#fff', borderRadius: 14, padding: 24, width: 420, maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' },
}
