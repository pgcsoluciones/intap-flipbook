import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import UnitsPanel from './UnitsPanel'

const CATEGORIES = [
  { value: 'catalogo',   label: 'Catálogo de productos' },
  { value: 'menu',       label: 'Menú de restaurante' },
  { value: 'portafolio', label: 'Portafolio' },
  { value: 'revista',    label: 'Revista / Magazine' },
  { value: 'folleto',    label: 'Folleto / Brochure' },
  { value: 'otro',       label: 'Otro' },
]

export default function Settings() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [pub, setPub]               = useState<any>(null)
  const [title, setTitle]           = useState('')
  const [description, setDesc]      = useState('')
  const [category, setCategory]     = useState('')
  const [soundEnabled, setSound]    = useState(false)
  const [saving, setSaving]         = useState(false)
  const [deleting, setDeleting]     = useState(false)
  const [msg, setMsg]               = useState<{ text: string; ok: boolean } | null>(null)
  const [confirmDelete, setConfirm] = useState(false)
  const [usage, setUsage]           = useState<any>(null)

  // Campos CMS del proyecto inmobiliario
  const [projectDeveloper, setProjectDeveloper] = useState('')
  const [projectPhone, setProjectPhone]         = useState('')
  const [projectWhatsapp, setProjectWhatsapp]   = useState('')
  const [projectLocation, setProjectLocation]   = useState('')
  const [projectAddress, setProjectAddress]     = useState('')
  const [projectWebsite, setProjectWebsite]     = useState('')
  const [savingProject, setSavingProject]       = useState(false)

  useEffect(() => {
    if (!id) return
    api.publications.get(id).then((r) => {
      const p = r.data
      setPub(p)
      setTitle(p.title ?? '')
      setDesc(p.description ?? '')
      setCategory(p.category ?? '')
      setSound(!!p.sound_enabled)
      setProjectDeveloper(p.project_developer ?? '')
      setProjectPhone(p.project_phone ?? '')
      setProjectWhatsapp(p.project_whatsapp ?? '')
      setProjectLocation(p.project_location ?? '')
      setProjectAddress(p.project_address ?? '')
      setProjectWebsite(p.project_website ?? '')
    })
    api.plan.usage().then((r) => setUsage(r.data))
  }, [id])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!id) return
    setSaving(true)
    try {
      const res = await api.publications.update(id, {
        title,
        description,
        category,
        sound_enabled: soundEnabled,
      })
      setPub(res.data)
      setMsg({ text: 'Cambios guardados correctamente.', ok: true })
      if ((res as any).warning) setMsg({ text: (res as any).warning, ok: false })
    } catch (e: any) {
      setMsg({ text: e.message ?? 'Error al guardar', ok: false })
    } finally {
      setSaving(false)
      setTimeout(() => setMsg(null), 4000)
    }
  }

  async function handleDelete() {
    if (!id) return
    setDeleting(true)
    try {
      await api.publications.delete(id)
      navigate('/publications')
    } catch (e: any) {
      setMsg({ text: e.message ?? 'Error al eliminar', ok: false })
      setDeleting(false)
    }
  }

  async function handleSaveProject(e: React.FormEvent) {
    e.preventDefault()
    if (!id) return
    setSavingProject(true)
    try {
      const res = await api.publications.update(id, {
        project_developer: projectDeveloper || undefined,
        project_phone:     projectPhone || undefined,
        project_whatsapp:  projectWhatsapp || undefined,
        project_location:  projectLocation || undefined,
        project_address:   projectAddress || undefined,
        project_website:   projectWebsite || undefined,
      })
      setPub(res.data)
      setMsg({ text: 'Datos del proyecto guardados correctamente.', ok: true })
    } catch (e: any) {
      setMsg({ text: e.message ?? 'Error al guardar', ok: false })
    } finally {
      setSavingProject(false)
      setTimeout(() => setMsg(null), 4000)
    }
  }

  if (!pub) return <div style={{ padding: '3rem', color: '#666' }}>Cargando...</div>

  const soundAllowed = usage?.features?.sound_enabled ?? false

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.breadcrumb}>
          <Link to="/publications" style={styles.crumbLink}>Publicaciones</Link>
          <span style={styles.sep}>/</span>
          <Link to={`/publications/${id}/editor`} style={styles.crumbLink}>{pub.title}</Link>
          <span style={styles.sep}>/</span>
          <span style={{ color: '#111827' }}>Configuración</span>
        </div>
        <div style={styles.tabBar}>
          <Link to={`/publications/${id}/editor`}   style={styles.tab}>Editor</Link>
          <Link to={`/publications/${id}/preview`}  style={styles.tab}>Vista previa</Link>
          <span style={{ ...styles.tab, ...styles.tabActive }}>Configuración</span>
        </div>
      </div>

      {msg && (
        <div style={{ ...styles.toast, background: msg.ok ? '#059669' : '#dc2626' }}>
          {msg.text}
        </div>
      )}

      <div style={styles.body}>
        {/* Información general */}
        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>Información general</h2>
          <form onSubmit={handleSave} style={styles.form}>
            <label style={styles.label}>
              Título <span style={styles.required}>*</span>
              <input
                style={styles.input}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={120}
              />
            </label>

            <label style={styles.label}>
              Descripción
              <textarea
                style={{ ...styles.input, height: 90, resize: 'vertical' }}
                value={description}
                onChange={(e) => setDesc(e.target.value)}
                maxLength={500}
              />
            </label>

            <label style={styles.label}>
              Categoría
              <select
                style={styles.input}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">Sin categoría</option>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>

            <button type="submit" disabled={saving} style={styles.btnPrimary}>
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </form>
        </section>

        {/* Opciones del flipbook */}
        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>Opciones del flipbook</h2>

          <div style={styles.toggleRow}>
            <div>
              <p style={styles.toggleLabel}>Sonido al voltear páginas</p>
              <p style={styles.toggleHint}>
                {soundAllowed
                  ? 'Activa el efecto de sonido al pasar páginas.'
                  : 'Disponible en plan Basic y Pro.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!soundAllowed) return
                setSound(!soundEnabled)
              }}
              disabled={!soundAllowed}
              style={{
                ...styles.toggle,
                background: soundEnabled && soundAllowed ? '#4f46e5' : '#d1d5db',
                opacity: soundAllowed ? 1 : 0.5,
              }}
            >
              <span style={{
                ...styles.toggleThumb,
                transform: soundEnabled && soundAllowed ? 'translateX(20px)' : 'translateX(2px)',
              }} />
            </button>
          </div>

          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Slug público</span>
            <code style={styles.infoValue}>{pub.public_slug ?? '—'}</code>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Estado</span>
            <span style={{
              ...styles.badge,
              background: pub.status === 'published' ? '#059669' : '#6b7280',
            }}>
              {pub.status === 'published' ? 'Publicado' : 'Borrador'}
            </span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Creado</span>
            <span style={styles.infoValue}>{new Date(pub.created_at).toLocaleDateString('es-AR')}</span>
          </div>

          {soundEnabled !== !!pub.sound_enabled && (
            <button
              onClick={handleSave as any}
              disabled={saving}
              style={{ ...styles.btnPrimary, marginTop: '1rem' }}
            >
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          )}
        </section>

        {/* Datos del Proyecto */}
        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>Datos del Proyecto</h2>
          <p style={{ color: '#6b7280', fontSize: '0.8rem', marginBottom: '1rem', marginTop: 0 }}>
            Información de contacto y ubicación que puede mostrarse en el flipbook.
          </p>
          <form onSubmit={handleSaveProject} style={styles.form}>
            <label style={styles.label}>
              Desarrolladora / Empresa
              <input
                style={styles.input}
                value={projectDeveloper}
                onChange={(e) => setProjectDeveloper(e.target.value)}
                maxLength={120}
                placeholder="Nombre de la empresa o desarrolladora"
              />
            </label>

            <label style={styles.label}>
              Teléfono del proyecto
              <input
                style={styles.input}
                value={projectPhone}
                onChange={(e) => setProjectPhone(e.target.value)}
                maxLength={40}
                placeholder="+54 11 1234-5678"
              />
            </label>

            <label style={styles.label}>
              WhatsApp del proyecto
              <input
                style={styles.input}
                value={projectWhatsapp}
                onChange={(e) => setProjectWhatsapp(e.target.value)}
                maxLength={40}
                placeholder="+54 9 11 1234-5678"
              />
            </label>

            <label style={styles.label}>
              Ubicación / Barrio
              <input
                style={styles.input}
                value={projectLocation}
                onChange={(e) => setProjectLocation(e.target.value)}
                maxLength={120}
                placeholder="Palermo, Buenos Aires"
              />
            </label>

            <label style={styles.label}>
              Dirección completa
              <input
                style={styles.input}
                value={projectAddress}
                onChange={(e) => setProjectAddress(e.target.value)}
                maxLength={200}
                placeholder="Av. Corrientes 1234, CABA"
              />
            </label>

            <label style={styles.label}>
              Sitio web
              <input
                style={styles.input}
                value={projectWebsite}
                onChange={(e) => setProjectWebsite(e.target.value)}
                maxLength={200}
                placeholder="https://www.miproyecto.com"
                type="url"
              />
            </label>

            <button type="submit" disabled={savingProject} style={styles.btnPrimary}>
              {savingProject ? 'Guardando...' : 'Guardar datos del proyecto'}
            </button>
          </form>
        </section>

        {/* Gestión de Unidades — disponible para cualquier publicación */}
        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>Gestión de Unidades</h2>
          <p style={{ color: '#6b7280', fontSize: '0.8rem', marginBottom: '1rem', marginTop: 0 }}>
            Registrá los departamentos, locales u otras unidades de este proyecto. Podés cambiar
            su estado (Disponible / Reservada / Vendida) con un solo clic.
          </p>
          <UnitsPanel publicationId={id!} />
        </section>

        {/* Zona peligrosa */}
        <section style={{ ...styles.card, borderColor: '#fca5a5' }}>
          <h2 style={{ ...styles.sectionTitle, color: '#dc2626' }}>Zona peligrosa</h2>
          <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '1rem' }}>
            Eliminar esta publicación borrará también todas sus páginas. Esta acción no se puede deshacer.
          </p>
          {!confirmDelete ? (
            <button onClick={() => setConfirm(true)} style={styles.btnDanger}>
              Eliminar publicación
            </button>
          ) : (
            <div style={styles.confirmBox}>
              <p style={{ color: '#dc2626', fontWeight: 600, margin: '0 0 0.75rem' }}>
                ¿Estás seguro? Esta acción es irreversible.
              </p>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button onClick={handleDelete} disabled={deleting} style={styles.btnDanger}>
                  {deleting ? 'Eliminando...' : 'Sí, eliminar'}
                </button>
                <button onClick={() => setConfirm(false)} style={styles.btnSecondary}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page:         { fontFamily: 'Inter, system-ui, sans-serif', minHeight: '100vh', background: '#f8fafc' },
  header:       { background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '0.75rem 1.5rem 0' },
  breadcrumb:   { display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', marginBottom: '0.75rem' },
  crumbLink:    { color: '#4f46e5', textDecoration: 'none' },
  sep:          { color: '#d1d5db' },
  tabBar:       { display: 'flex', gap: 0 },
  tab:          { padding: '0.5rem 1rem', fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none', borderBottom: '2px solid transparent' },
  tabActive:    { color: '#4f46e5', borderBottom: '2px solid #4f46e5', fontWeight: 600 },
  toast:        { position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', color: '#fff', padding: '0.6rem 1.25rem', borderRadius: 8, fontSize: '0.875rem', zIndex: 100 },
  body:         { maxWidth: 680, margin: '0 auto', padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' },
  card:         { background: '#fff', borderRadius: 12, padding: '1.5rem', border: '1px solid #e5e7eb' },
  sectionTitle: { fontSize: '1rem', fontWeight: 700, color: '#111827', margin: '0 0 1.25rem' },
  form:         { display: 'flex', flexDirection: 'column', gap: '1rem' },
  label:        { display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.875rem', fontWeight: 500, color: '#374151' },
  required:     { color: '#dc2626' },
  input:        { border: '1px solid #d1d5db', borderRadius: 8, padding: '0.5rem 0.75rem', fontSize: '0.9rem', outline: 'none', fontFamily: 'inherit', background: '#fff' },
  btnPrimary:   { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '0.6rem 1.25rem', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem', alignSelf: 'flex-start' },
  btnDanger:    { background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, padding: '0.6rem 1.25rem', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem' },
  btnSecondary: { background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 8, padding: '0.6rem 1.25rem', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem' },
  toggleRow:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' },
  toggleLabel:  { fontWeight: 600, fontSize: '0.9rem', color: '#111827', margin: '0 0 0.25rem' },
  toggleHint:   { fontSize: '0.8rem', color: '#9ca3af', margin: 0 },
  toggle:       { width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0 },
  toggleThumb:  { position: 'absolute', top: 2, width: 20, height: 20, background: '#fff', borderRadius: '50%', transition: 'transform .2s', display: 'block' },
  infoRow:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0', borderTop: '1px solid #f3f4f6' },
  infoLabel:    { fontSize: '0.875rem', color: '#6b7280' },
  infoValue:    { fontSize: '0.875rem', color: '#374151', background: '#f9fafb', padding: '2px 8px', borderRadius: 4 },
  badge:        { fontSize: '0.7rem', color: '#fff', borderRadius: 12, padding: '2px 8px', fontWeight: 600 },
  confirmBox:   { background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '1rem' },
}
