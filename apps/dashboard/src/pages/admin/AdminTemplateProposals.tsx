import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

type Status = 'pending' | 'approved' | 'rejected'

const STATUS_LABELS: Record<Status, string> = {
  pending:  'Pendientes',
  approved: 'Aprobadas',
  rejected: 'Rechazadas',
}

const STATUS_COLORS: Record<Status, { bg: string; color: string }> = {
  pending:  { bg: '#fef3c7', color: '#92400e' },
  approved: { bg: '#d1fae5', color: '#065f46' },
  rejected: { bg: '#fee2e2', color: '#991b1b' },
}

export default function AdminTemplateProposals() {
  const [proposals, setProposals] = useState<any[]>([])
  const [loading, setLoading]     = useState(true)
  const [tab, setTab]             = useState<Status>('pending')
  const [rejectNotes, setRejectNotes] = useState<Record<number, string>>({})
  const [rejectOpen, setRejectOpen]   = useState<Record<number, boolean>>({})
  const [working, setWorking]         = useState<number | null>(null)
  const [error, setError]             = useState('')

  useEffect(() => {
    api.proposals.listAll()
      .then((r) => setProposals(r.data ?? []))
      .catch((e) => setError(e.message ?? 'Error al cargar propuestas'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = proposals.filter((p) => p.status === tab)

  async function handleApprove(id: number) {
    setWorking(id); setError('')
    try {
      await api.proposals.approve(id)
      setProposals((prev) => prev.map((p) => p.id === id ? { ...p, status: 'approved' } : p))
    } catch (e: any) {
      setError(e.message ?? 'Error al aprobar')
    } finally {
      setWorking(null)
    }
  }

  async function handleReject(id: number) {
    setWorking(id); setError('')
    try {
      await api.proposals.reject(id, rejectNotes[id] ?? undefined)
      setProposals((prev) => prev.map((p) => p.id === id ? { ...p, status: 'rejected' } : p))
      setRejectOpen((prev) => ({ ...prev, [id]: false }))
    } catch (e: any) {
      setError(e.message ?? 'Error al rechazar')
    } finally {
      setWorking(null)
    }
  }

  function formatDate(dt: string) {
    try { return new Date(dt).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) } catch { return dt }
  }

  if (loading) return <div style={s.loading}>Cargando propuestas...</div>

  return (
    <div style={s.page}>
      <h1 style={s.title}>Propuestas de Plantillas</h1>
      <p style={s.sub}>Los tenants pueden proponer sus publicaciones como plantillas para que otros usuarios las utilicen.</p>

      {error && <div style={s.errBanner}>{error}</div>}

      {/* Tabs */}
      <div style={s.tabs}>
        {(['pending', 'approved', 'rejected'] as Status[]).map((st) => {
          const count = proposals.filter((p) => p.status === st).length
          return (
            <button
              key={st}
              style={{ ...s.tabBtn, ...(tab === st ? s.tabActive : {}) }}
              onClick={() => setTab(st)}
            >
              {STATUS_LABELS[st]} ({count})
            </button>
          )
        })}
      </div>

      {/* Lista */}
      {filtered.length === 0 ? (
        <div style={s.empty}>No hay propuestas en esta categoría.</div>
      ) : (
        <div style={s.list}>
          {filtered.map((p) => (
            <div key={p.id} style={s.card}>
              {/* Portada */}
              {p.cover_url && (
                <img src={p.cover_url} alt={p.title} style={s.cover} />
              )}

              <div style={s.body}>
                <div style={s.row}>
                  <div>
                    <div style={s.name}>{p.title}</div>
                    {p.category && <div style={s.catTag}>{p.category}</div>}
                  </div>
                  <span style={{ ...s.badge, ...STATUS_COLORS[p.status as Status] }}>
                    {STATUS_LABELS[p.status as Status] ?? p.status}
                  </span>
                </div>

                {p.description && <div style={s.desc}>{p.description}</div>}

                <div style={s.meta}>
                  <span>👤 {p.user_name ?? '—'} · {p.user_email}</span>
                  <span>📖 {p.publication_title ?? p.publication_id}</span>
                  <span>📅 {formatDate(p.created_at)}</span>
                </div>

                {/* Acciones — solo para pendientes */}
                {p.status === 'pending' && (
                  <div style={s.actions}>
                    <button
                      style={{ ...s.btnApprove, opacity: working === p.id ? 0.6 : 1 }}
                      disabled={working === p.id}
                      onClick={() => handleApprove(p.id)}
                    >
                      {working === p.id ? 'Procesando...' : '✅ Aprobar'}
                    </button>

                    {rejectOpen[p.id] ? (
                      <div style={s.rejectBox}>
                        <textarea
                          style={s.rejectInput}
                          placeholder="Motivo del rechazo (opcional)..."
                          value={rejectNotes[p.id] ?? ''}
                          onChange={(e) => setRejectNotes((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            style={{ ...s.btnReject, opacity: working === p.id ? 0.6 : 1 }}
                            disabled={working === p.id}
                            onClick={() => handleReject(p.id)}
                          >
                            Confirmar rechazo
                          </button>
                          <button
                            style={s.btnCancel}
                            onClick={() => setRejectOpen((prev) => ({ ...prev, [p.id]: false }))}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        style={s.btnRejectOpen}
                        onClick={() => setRejectOpen((prev) => ({ ...prev, [p.id]: true }))}
                      >
                        ❌ Rechazar
                      </button>
                    )}
                  </div>
                )}

                {/* Notas del admin si fue rechazada */}
                {p.status === 'rejected' && p.admin_notes && (
                  <div style={s.adminNotes}>
                    <strong>Motivo:</strong> {p.admin_notes}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page:    { padding: '2rem', maxWidth: 900, margin: '0 auto' },
  loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#6b7280' },
  title:   { fontSize: 22, fontWeight: 700, color: '#111827', margin: '0 0 4px' },
  sub:     { fontSize: 13, color: '#6b7280', marginBottom: '1.5rem' },
  errBanner: { background: '#fee2e2', color: '#991b1b', padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13 },

  tabs:     { display: 'flex', gap: 0, borderBottom: '2px solid #f3f4f6', marginBottom: '1.5rem' },
  tabBtn:   { background: 'none', border: 'none', borderBottom: '2px solid transparent', padding: '10px 18px', fontSize: 13, fontWeight: 500, color: '#6b7280', cursor: 'pointer', marginBottom: -2 },
  tabActive:{ color: '#4f46e5', borderBottomColor: '#4f46e5', fontWeight: 600 },

  empty: { textAlign: 'center', padding: '60px 20px', color: '#9ca3af', fontSize: 14 },

  list: { display: 'flex', flexDirection: 'column', gap: 16 },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', display: 'flex', gap: 0 },
  cover:{ width: 120, minWidth: 120, objectFit: 'cover', display: 'block', background: '#f8fafc' },
  body: { flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 },

  row:    { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  name:   { fontSize: 15, fontWeight: 700, color: '#111827' },
  catTag: { fontSize: 11, color: '#6b7280', fontWeight: 500, marginTop: 2 },
  badge:  { fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' },
  desc:   { fontSize: 13, color: '#374151', lineHeight: 1.5 },
  meta:   { display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: '#9ca3af' },

  actions:    { display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 4 },
  btnApprove: { background: '#059669', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnRejectOpen: { background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnReject:  { background: '#ef4444', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  btnCancel:  { background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer' },

  rejectBox:  { display: 'flex', flexDirection: 'column', gap: 6, width: '100%' },
  rejectInput:{ border: '1px solid #e5e7eb', borderRadius: 7, padding: '8px 10px', fontSize: 12, outline: 'none', resize: 'vertical', minHeight: 64 },

  adminNotes: { fontSize: 12, color: '#6b7280', background: '#f8fafc', borderRadius: 6, padding: '8px 12px', marginTop: 4 },
}
