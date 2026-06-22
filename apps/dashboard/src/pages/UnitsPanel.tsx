import { useEffect, useState } from 'react'

// ── Tipos ─────────────────────────────────────────────────────────────────────
// Una "Unidad" representa un departamento, local, oficina u otro espacio dentro
// de un proyecto inmobiliario. Tiene estado de venta/disponibilidad y datos físicos.
interface Unit {
  id: string
  publication_id: string
  name: string
  floor: number | null
  unit_number: string | null
  area_m2: number | null
  bedrooms: number | null
  bathrooms: number | null
  price: number | null
  status: 'available' | 'reserved' | 'sold'
  description: string | null
  created_at: string
  updated_at: string
}

// Formulario para crear o editar una unidad
interface UnitForm {
  name: string
  floor: string
  unit_number: string
  bedrooms: string
  bathrooms: string
  area_m2: string
  price: string
  status: 'available' | 'reserved' | 'sold'
  description: string
}

const EMPTY_FORM: UnitForm = {
  name: '',
  floor: '',
  unit_number: '',
  bedrooms: '',
  bathrooms: '',
  area_m2: '',
  price: '',
  status: 'available',
  description: '',
}

// Ciclo de estados al hacer clic en "Cambiar estado"
const STATUS_CYCLE: Record<string, 'available' | 'reserved' | 'sold'> = {
  available: 'reserved',
  reserved: 'sold',
  sold: 'available',
}

// ── Badge de estado ───────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; bg: string }> = {
    available: { label: 'Disponible', bg: '#16a34a' },
    reserved:  { label: 'Reservada',  bg: '#ca8a04' },
    sold:      { label: 'Vendida',    bg: '#dc2626' },
  }
  const c = config[status] ?? { label: status, bg: '#6b7280' }
  return (
    <span style={{
      background: c.bg,
      color: '#fff',
      borderRadius: 12,
      padding: '2px 10px',
      fontSize: '0.72rem',
      fontWeight: 700,
      whiteSpace: 'nowrap',
    }}>
      {c.label}
    </span>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────
interface UnitsPanelProps {
  publicationId: string
}

export default function UnitsPanel({ publicationId }: UnitsPanelProps) {
  const [units, setUnits]           = useState<Unit[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [showForm, setShowForm]     = useState(false)
  const [form, setForm]             = useState<UnitForm>(EMPTY_FORM)
  const [saving, setSaving]         = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmId, setConfirmId]   = useState<string | null>(null)
  const [msg, setMsg]               = useState<{ text: string; ok: boolean } | null>(null)

  // ── Fetch inicial ─────────────────────────────────────────────────────────
  async function loadUnits() {
    setLoading(true)
    setError(null)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(
        `${import.meta.env.VITE_API_BASE_URL}/api/units?publication_id=${publicationId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const data = await res.json()
      if (!data.success) throw new Error(data.error ?? 'Error al cargar unidades')
      setUnits(data.data ?? [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadUnits() }, [publicationId])

  // ── Mostrar mensaje temporal ──────────────────────────────────────────────
  function flash(text: string, ok: boolean) {
    setMsg({ text, ok })
    setTimeout(() => setMsg(null), 3500)
  }

  // ── Cambiar estado (cicla: disponible → reservada → vendida → disponible) ─
  async function handleToggleStatus(unit: Unit) {
    const nextStatus = STATUS_CYCLE[unit.status] ?? 'available'
    setTogglingId(unit.id)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(
        `${import.meta.env.VITE_API_BASE_URL}/api/units/${unit.id}/status`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ status: nextStatus }),
        }
      )
      const data = await res.json()
      if (!data.success) throw new Error(data.error ?? 'Error al cambiar estado')
      setUnits((prev) =>
        prev.map((u) => (u.id === unit.id ? { ...u, status: nextStatus } : u))
      )
    } catch (e: any) {
      flash(e.message, false)
    } finally {
      setTogglingId(null)
    }
  }

  // ── Eliminar unidad ───────────────────────────────────────────────────────
  async function handleDelete(unitId: string) {
    setDeletingId(unitId)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(
        `${import.meta.env.VITE_API_BASE_URL}/api/units/${unitId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }
      )
      const data = await res.json()
      if (!data.success) throw new Error(data.error ?? 'Error al eliminar')
      setUnits((prev) => prev.filter((u) => u.id !== unitId))
      setConfirmId(null)
      flash('Unidad eliminada.', true)
    } catch (e: any) {
      flash(e.message, false)
    } finally {
      setDeletingId(null)
    }
  }

  // ── Crear nueva unidad ────────────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const token = localStorage.getItem('token')
      const body = {
        publication_id: publicationId,
        name:        form.name.trim(),
        floor:       form.floor       ? Number(form.floor)       : undefined,
        unit_number: form.unit_number || undefined,
        bedrooms:    form.bedrooms    ? Number(form.bedrooms)    : undefined,
        bathrooms:   form.bathrooms   ? Number(form.bathrooms)   : undefined,
        area_m2:     form.area_m2     ? Number(form.area_m2)     : undefined,
        price:       form.price       ? Number(form.price)       : undefined,
        status:      form.status,
        description: form.description || undefined,
      }
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/units`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error ?? 'Error al crear unidad')
      setUnits((prev) => [...prev, data.data])
      setForm(EMPTY_FORM)
      setShowForm(false)
      flash('Unidad creada correctamente.', true)
    } catch (e: any) {
      flash(e.message, false)
    } finally {
      setSaving(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* Mensaje flash */}
      {msg && (
        <div style={{
          background: msg.ok ? '#15803d' : '#b91c1c',
          color: '#fff',
          padding: '0.5rem 1rem',
          borderRadius: 8,
          marginBottom: '1rem',
          fontSize: '0.875rem',
        }}>
          {msg.text}
        </div>
      )}

      {/* Barra de acciones */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: 0 }}>
          {units.length} unidad{units.length !== 1 ? 'es' : ''} registrada{units.length !== 1 ? 's' : ''}
        </p>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{
            background: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '0.45rem 1rem',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '0.875rem',
          }}
        >
          {showForm ? 'Cancelar' : '+ Agregar unidad'}
        </button>
      </div>

      {/* Formulario de nueva unidad */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          style={{
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: 10,
            padding: '1.25rem',
            marginBottom: '1.25rem',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: '0.75rem',
          }}
        >
          {/* Nombre (campo obligatorio) */}
          <label style={frmLabel}>
            Nombre <span style={{ color: '#f87171' }}>*</span>
            <input
              style={frmInput}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ej. Depto 3A"
              required
            />
          </label>

          <label style={frmLabel}>
            Piso
            <input
              type="number"
              style={frmInput}
              value={form.floor}
              onChange={(e) => setForm({ ...form, floor: e.target.value })}
              placeholder="1"
              min={0}
            />
          </label>

          <label style={frmLabel}>
            N° de unidad
            <input
              style={frmInput}
              value={form.unit_number}
              onChange={(e) => setForm({ ...form, unit_number: e.target.value })}
              placeholder="3A"
            />
          </label>

          <label style={frmLabel}>
            m²
            <input
              type="number"
              style={frmInput}
              value={form.area_m2}
              onChange={(e) => setForm({ ...form, area_m2: e.target.value })}
              placeholder="65"
              min={0}
              step="0.01"
            />
          </label>

          <label style={frmLabel}>
            Dormitorios
            <input
              type="number"
              style={frmInput}
              value={form.bedrooms}
              onChange={(e) => setForm({ ...form, bedrooms: e.target.value })}
              placeholder="2"
              min={0}
            />
          </label>

          <label style={frmLabel}>
            Baños
            <input
              type="number"
              style={frmInput}
              value={form.bathrooms}
              onChange={(e) => setForm({ ...form, bathrooms: e.target.value })}
              placeholder="1"
              min={0}
            />
          </label>

          <label style={frmLabel}>
            Precio (USD)
            <input
              type="number"
              style={frmInput}
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              placeholder="85000"
              min={0}
              step="0.01"
            />
          </label>

          <label style={frmLabel}>
            Estado
            <select
              style={frmInput}
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as UnitForm['status'] })}
            >
              <option value="available">Disponible</option>
              <option value="reserved">Reservada</option>
              <option value="sold">Vendida</option>
            </select>
          </label>

          <label style={{ ...frmLabel, gridColumn: '1 / -1' }}>
            Descripción / notas
            <textarea
              style={{ ...frmInput, height: 60, resize: 'vertical' }}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Orientación norte, vista al río..."
            />
          </label>

          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '0.5rem' }}>
            <button
              type="submit"
              disabled={saving}
              style={{
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '0.45rem 1.1rem',
                fontWeight: 700,
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              {saving ? 'Guardando...' : 'Guardar unidad'}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setForm(EMPTY_FORM) }}
              style={{
                background: '#334155',
                color: '#cbd5e1',
                border: 'none',
                borderRadius: 8,
                padding: '0.45rem 1rem',
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Estado de carga / error */}
      {loading && (
        <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Cargando unidades...</p>
      )}
      {error && (
        <p style={{ color: '#f87171', fontSize: '0.875rem' }}>Error: {error}</p>
      )}

      {/* Tabla de unidades */}
      {!loading && !error && units.length === 0 && (
        <div style={{
          background: '#1e293b',
          border: '1px dashed #334155',
          borderRadius: 10,
          padding: '2rem',
          textAlign: 'center',
          color: '#64748b',
          fontSize: '0.875rem',
        }}>
          No hay unidades cargadas aún. Hacé clic en "+ Agregar unidad" para comenzar.
        </div>
      )}

      {!loading && units.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '0.82rem',
            color: '#e2e8f0',
          }}>
            <thead>
              <tr style={{ background: '#0f172a', borderBottom: '2px solid #334155' }}>
                {['Nombre', 'Piso', 'N°', 'm²', 'Dorm.', 'Precio', 'Estado', 'Acciones'].map((h) => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {units.map((unit, i) => (
                <tr
                  key={unit.id}
                  style={{
                    background: i % 2 === 0 ? '#1e293b' : '#172033',
                    borderBottom: '1px solid #334155',
                  }}
                >
                  <td style={tdStyle}>{unit.name}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{unit.floor ?? '—'}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{unit.unit_number ?? '—'}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {unit.area_m2 != null ? `${unit.area_m2} m²` : '—'}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{unit.bedrooms ?? '—'}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {unit.price != null
                      ? `$${Number(unit.price).toLocaleString('es-AR')}`
                      : '—'}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <StatusBadge status={unit.status} />
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    {/* Botón cambiar estado */}
                    <button
                      onClick={() => handleToggleStatus(unit)}
                      disabled={togglingId === unit.id}
                      title="Cicla entre Disponible → Reservada → Vendida"
                      style={{
                        background: '#334155',
                        color: '#94a3b8',
                        border: 'none',
                        borderRadius: 6,
                        padding: '3px 8px',
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                        marginRight: 6,
                      }}
                    >
                      {togglingId === unit.id ? '...' : 'Cambiar estado'}
                    </button>

                    {/* Botón eliminar */}
                    {confirmId === unit.id ? (
                      <>
                        <button
                          onClick={() => handleDelete(unit.id)}
                          disabled={deletingId === unit.id}
                          style={{
                            background: '#b91c1c',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 6,
                            padding: '3px 8px',
                            cursor: 'pointer',
                            fontSize: '0.75rem',
                            marginRight: 4,
                          }}
                        >
                          {deletingId === unit.id ? '...' : 'Confirmar'}
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          style={{
                            background: '#334155',
                            color: '#94a3b8',
                            border: 'none',
                            borderRadius: 6,
                            padding: '3px 8px',
                            cursor: 'pointer',
                            fontSize: '0.75rem',
                          }}
                        >
                          No
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmId(unit.id)}
                        style={{
                          background: 'transparent',
                          color: '#f87171',
                          border: '1px solid #f87171',
                          borderRadius: 6,
                          padding: '3px 8px',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                        }}
                      >
                        Eliminar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Estilos auxiliares ────────────────────────────────────────────────────────
const frmLabel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
  fontSize: '0.8rem',
  fontWeight: 600,
  color: '#94a3b8',
}

const frmInput: React.CSSProperties = {
  background: '#0f172a',
  border: '1px solid #475569',
  borderRadius: 6,
  padding: '0.4rem 0.6rem',
  color: '#e2e8f0',
  fontSize: '0.85rem',
  fontFamily: 'inherit',
  outline: 'none',
}

const thStyle: React.CSSProperties = {
  padding: '0.6rem 0.75rem',
  textAlign: 'left',
  fontWeight: 700,
  color: '#94a3b8',
  fontSize: '0.78rem',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

const tdStyle: React.CSSProperties = {
  padding: '0.55rem 0.75rem',
  verticalAlign: 'middle',
}
