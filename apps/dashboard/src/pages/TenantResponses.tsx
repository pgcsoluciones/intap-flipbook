import { useEffect, useState } from 'react'
import { api } from '../lib/api'

/**
 * TenantResponses — repositorio de respuestas de formularios y cuestionarios.
 *
 * Cada vez que un visitante envía un formulario de contacto o responde un
 * cuestionario en una publicación, queda registrado aquí. El tenant (dueño)
 * puede leerlas, marcarlas como leídas o eliminarlas.
 */
type ResponseRow = {
  id: number
  publication_id: string
  publication_title: string | null
  kind: 'contact' | 'quiz'
  widget_key: string | null
  payload: string
  is_read: number
  created_at: string
}

export default function TenantResponses() {
  const [rows, setRows] = useState<ResponseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'contact' | 'quiz' | 'unread'>('all')

  function load() {
    setLoading(true)
    api.responses.list()
      .then((r) => setRows(r.data ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  async function markRead(id: number) {
    await api.responses.markRead(id).catch(() => {})
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, is_read: 1 } : r)))
  }
  async function remove(id: number) {
    if (!confirm('¿Eliminar esta respuesta?')) return
    await api.responses.remove(id).catch(() => {})
    setRows((prev) => prev.filter((r) => r.id !== id))
  }

  const filtered = rows.filter((r) =>
    filter === 'all' ? true : filter === 'unread' ? r.is_read === 0 : r.kind === filter,
  )
  const unread = rows.filter((r) => r.is_read === 0).length

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Respuestas</h1>
          <p style={s.subtitle}>Mensajes de formularios y respuestas de cuestionarios de tus publicaciones.</p>
        </div>
        <button style={s.reload} onClick={load}>↻ Actualizar</button>
      </div>

      <div style={s.tabs}>
        {([
          { k: 'all', label: `Todas (${rows.length})` },
          { k: 'unread', label: `Sin leer (${unread})` },
          { k: 'contact', label: 'Formularios' },
          { k: 'quiz', label: 'Cuestionarios' },
        ] as const).map((t) => (
          <button key={t.k} style={{ ...s.tab, ...(filter === t.k ? s.tabActive : {}) }} onClick={() => setFilter(t.k)}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={s.empty}>Cargando…</p>
      ) : filtered.length === 0 ? (
        <p style={s.empty}>No hay respuestas todavía. Cuando un visitante complete un formulario o cuestionario, aparecerá aquí.</p>
      ) : (
        <div style={s.list}>
          {filtered.map((r) => <Card key={r.id} row={r} onRead={markRead} onRemove={remove} />)}
        </div>
      )}
    </div>
  )
}

function Card({ row, onRead, onRemove }: { row: ResponseRow; onRead: (id: number) => void; onRemove: (id: number) => void }) {
  let parsed: any = {}
  try { parsed = JSON.parse(row.payload) } catch {}

  return (
    <div style={{ ...s.card, ...(row.is_read ? {} : s.cardUnread) }}>
      <div style={s.cardHead}>
        <span style={{ ...s.badge, background: row.kind === 'quiz' ? '#7c3aed' : '#0ea5e9' }}>
          {row.kind === 'quiz' ? '📝 Cuestionario' : '✉️ Formulario'}
        </span>
        <span style={s.pub}>{row.publication_title ?? 'Publicación'}</span>
        <span style={s.date}>{new Date(row.created_at + 'Z').toLocaleString()}</span>
      </div>

      <div style={s.body}>
        {row.kind === 'contact' ? (
          <table style={s.kv}>
            <tbody>
              {Object.entries(parsed).map(([k, v]) => (
                (v ? (
                  <tr key={k}><td style={s.kvKey}>{cap(k)}</td><td style={s.kvVal}>{String(v)}</td></tr>
                ) : null)
              ))}
            </tbody>
          </table>
        ) : (
          <div>
            {parsed.titulo && <div style={s.quizTitle}>{parsed.titulo}</div>}
            {(parsed.respuestas ?? []).map((qa: any, i: number) => (
              <div key={i} style={s.qa}>
                <div style={s.qaQ}>{i + 1}. {qa.pregunta}</div>
                <div style={s.qaA}>→ {qa.respuesta}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={s.actions}>
        {!row.is_read && <button style={s.actRead} onClick={() => onRead(row.id)}>Marcar leída</button>}
        <button style={s.actDel} onClick={() => onRemove(row.id)}>Eliminar</button>
      </div>
    </div>
  )
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1) }

const s: Record<string, React.CSSProperties> = {
  wrap: { padding: 24, maxWidth: 900, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 },
  title: { fontSize: 24, fontWeight: 800, color: '#111827', margin: 0 },
  subtitle: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  reload: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#374151' },
  tabs: { display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  tab: { background: '#f3f4f6', border: 'none', borderRadius: 20, padding: '7px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#6b7280' },
  tabActive: { background: '#4f46e5', color: '#fff' },
  empty: { color: '#9ca3af', fontSize: 14, textAlign: 'center', padding: '40px 0' },
  list: { display: 'flex', flexDirection: 'column', gap: 12 },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16 },
  cardUnread: { borderColor: '#c7d2fe', boxShadow: '0 0 0 3px rgba(79,70,229,0.08)' },
  cardHead: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' },
  badge: { color: '#fff', borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 700 },
  pub: { fontSize: 13, fontWeight: 700, color: '#374151' },
  date: { fontSize: 11, color: '#9ca3af', marginLeft: 'auto' },
  body: { borderTop: '1px solid #f3f4f6', paddingTop: 10 },
  kv: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  kvKey: { color: '#6b7280', fontWeight: 600, padding: '3px 10px 3px 0', verticalAlign: 'top', whiteSpace: 'nowrap' },
  kvVal: { color: '#111827', padding: '3px 0' },
  quizTitle: { fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 8 },
  qa: { marginBottom: 8 },
  qaQ: { fontSize: 13, fontWeight: 600, color: '#374151' },
  qaA: { fontSize: 13, color: '#4f46e5', marginLeft: 8 },
  actions: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 },
  actRead: { background: '#eef2ff', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#4f46e5' },
  actDel: { background: '#fef2f2', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#dc2626' },
}
