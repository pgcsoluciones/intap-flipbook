import { useEffect, useState } from 'react'
import { api, API_BASE } from '../lib/api'

function toSlug(text: string) {
  return text
    .replace(/ñ/gi, 'n')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export default function ProfilePage() {
  const [user, setUser]         = useState<any>(null)
  const [name, setName]         = useState('')
  const [slug, setSlug]         = useState('')
  const [email, setEmail]       = useState('')
  const [currentPw, setCurrent] = useState('')
  const [newPw, setNewPw]       = useState('')
  const [confirmPw, setConfirm] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPw, setSavingPw]           = useState(false)
  const [msgProfile, setMsgProfile]       = useState<{ text: string; ok: boolean } | null>(null)
  const [msgPw, setMsgPw]                 = useState<{ text: string; ok: boolean } | null>(null)
  const [watermarkTenant, setWatermarkTenant] = useState<string | null>(null)
  const [savingWm, setSavingWm]               = useState(false)
  const [msgWm, setMsgWm]                     = useState<{ text: string; ok: boolean } | null>(null)

  useEffect(() => {
    api.auth.me().then((r) => {
      setUser(r.data)
      setName(r.data.name ?? '')
      setSlug(r.data.slug ?? '')
      setEmail(r.data.email ?? '')
      setWatermarkTenant(r.data.watermark_tenant ?? null)
    })
  }, [])

  async function handleSaveWatermark(value: string | null) {
    setSavingWm(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_BASE}/auth/me/watermark`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ watermark_tenant: value }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al guardar')
      setWatermarkTenant(value)
      setMsgWm({ text: 'Preferencia guardada.', ok: true })
    } catch (e: any) {
      setMsgWm({ text: e.message, ok: false })
    } finally {
      setSavingWm(false)
      setTimeout(() => setMsgWm(null), 3000)
    }
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    setSavingProfile(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_BASE}/auth/me`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, slug: slug.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al guardar')
      setUser(data.data)
      setMsgProfile({ text: 'Perfil actualizado correctamente.', ok: true })
    } catch (e: any) {
      setMsgProfile({ text: e.message, ok: false })
    } finally {
      setSavingProfile(false)
      setTimeout(() => setMsgProfile(null), 4000)
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (newPw !== confirmPw) {
      setMsgPw({ text: 'Las contraseñas nuevas no coinciden.', ok: false })
      return
    }
    if (newPw.length < 8) {
      setMsgPw({ text: 'La contraseña debe tener al menos 8 caracteres.', ok: false })
      return
    }
    setSavingPw(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_BASE}/auth/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ current_password: currentPw, new_password: newPw }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al cambiar contraseña')
      setMsgPw({ text: 'Contraseña actualizada correctamente.', ok: true })
      setCurrent(''); setNewPw(''); setConfirm('')
    } catch (e: any) {
      setMsgPw({ text: e.message, ok: false })
    } finally {
      setSavingPw(false)
      setTimeout(() => setMsgPw(null), 4000)
    }
  }

  if (!user) return <div style={{ padding: '3rem', color: '#666' }}>Cargando...</div>

  const initial = (user.name || user.email || '?')[0].toUpperCase()

  return (
    <div style={styles.page}>
      <h1 style={styles.h1}>Mi Perfil</h1>
      <p style={styles.subtitle}>Administrá tu información personal y credenciales.</p>

      {/* Avatar */}
      <div style={styles.avatarSection}>
        <div style={styles.avatar}>{initial}</div>
        <div>
          <p style={styles.avatarName}>{user.name || '(sin nombre)'}</p>
          <p style={styles.avatarEmail}>{user.email}</p>
          <span style={styles.planBadge}>{user.plan_id?.toUpperCase() ?? 'FREE'}</span>
        </div>
      </div>

      {/* Información personal */}
      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>Información personal</h2>
        {msgProfile && (
          <div style={{ ...styles.alert, background: msgProfile.ok ? '#d1fae5' : '#fee2e2', color: msgProfile.ok ? '#065f46' : '#991b1b' }}>
            {msgProfile.text}
          </div>
        )}
        <form onSubmit={handleSaveProfile} style={styles.form}>
          <label style={styles.label}>
            Nombre
            <input
              style={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tu nombre o empresa"
              maxLength={100}
            />
          </label>
          <label style={styles.label}>
            URL pública (slug)
            <input
              style={styles.input}
              value={slug}
              onChange={(e) => setSlug(toSlug(e.target.value))}
              placeholder="mi-empresa"
              maxLength={60}
            />
            <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
              flip.intaprd.com/<strong>{slug || '(sin slug)'}</strong>
            </span>
          </label>
          <label style={styles.label}>
            Correo electrónico
            <input
              style={{ ...styles.input, background: '#f9fafb', color: '#9ca3af' }}
              value={email}
              disabled
              title="El email no se puede modificar"
            />
            <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>El email no se puede cambiar.</span>
          </label>
          <button type="submit" disabled={savingProfile} style={styles.btnPrimary}>
            {savingProfile ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </form>
      </section>

      {/* Cambiar contraseña */}
      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>Cambiar contraseña</h2>
        {msgPw && (
          <div style={{ ...styles.alert, background: msgPw.ok ? '#d1fae5' : '#fee2e2', color: msgPw.ok ? '#065f46' : '#991b1b' }}>
            {msgPw.text}
          </div>
        )}
        <form onSubmit={handleChangePassword} style={styles.form}>
          <label style={styles.label}>
            Contraseña actual
            <input
              type="password"
              style={styles.input}
              value={currentPw}
              onChange={(e) => setCurrent(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          <label style={styles.label}>
            Nueva contraseña
            <input
              type="password"
              style={styles.input}
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          <label style={styles.label}>
            Confirmar nueva contraseña
            <input
              type="password"
              style={styles.input}
              value={confirmPw}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
            />
          </label>
          <button type="submit" disabled={savingPw} style={styles.btnPrimary}>
            {savingPw ? 'Cambiando...' : 'Cambiar contraseña'}
          </button>
        </form>
      </section>

      {/* Marca de agua — solo visible en planes basic/pro */}
      {user?.plan_id !== 'free' && (
        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>Marca de agua en mis flipbooks</h2>
          <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: '1rem' }}>
            Controlá si la marca "Intap Flipbook" aparece en tus publicaciones. Tu elección tiene prioridad sobre la configuración general del sistema.
            {user?.plan_id === 'basic' && <><br /><span style={{ color: '#92400e' }}>En el plan Basic está activa por defecto. Podés desactivarla.</span></>}
            {user?.plan_id === 'pro'   && <><br /><span style={{ color: '#065f46' }}>En el plan Pro está inactiva por defecto. Podés activarla si lo deseás (ej. si sos sponsor).</span></>}
          </p>
          {msgWm && (
            <div style={{ ...styles.alert, background: msgWm.ok ? '#d1fae5' : '#fee2e2', color: msgWm.ok ? '#065f46' : '#991b1b', marginBottom: '1rem' }}>
              {msgWm.text}
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {[
              { value: null,   label: 'Por defecto del plan', desc: user?.plan_id === 'basic' ? 'Activa' : 'Inactiva' },
              { value: 'show', label: 'Siempre mostrar',      desc: 'Aparece en todas mis publicaciones' },
              { value: 'hide', label: 'Siempre ocultar',      desc: 'No aparece en ninguna publicación' },
            ].map((opt) => {
              const active = watermarkTenant === opt.value
              return (
                <button
                  key={String(opt.value)}
                  disabled={savingWm}
                  onClick={() => handleSaveWatermark(opt.value)}
                  style={{
                    border: active ? '2px solid #4f46e5' : '1px solid #d1d5db',
                    background: active ? '#eef2ff' : '#fff',
                    borderRadius: 10,
                    padding: '0.65rem 1rem',
                    cursor: savingWm ? 'default' : 'pointer',
                    textAlign: 'left',
                    minWidth: 160,
                    opacity: savingWm ? 0.6 : 1,
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', color: active ? '#4338ca' : '#111827' }}>{opt.label}</div>
                  <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 2 }}>{opt.desc}</div>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* Cerrar sesión */}
      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>Sesión</h2>
        <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '1rem' }}>
          Al cerrar sesión deberás volver a iniciar con tu email y contraseña.
        </p>
        <button
          onClick={() => { localStorage.removeItem('token'); window.location.href = '/login' }}
          style={styles.btnSecondary}
        >
          Cerrar sesión
        </button>
      </section>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page:         { padding: '2rem 1.5rem', fontFamily: 'Inter, system-ui, sans-serif', maxWidth: 640, margin: '0 auto' },
  h1:           { fontSize: '1.5rem', fontWeight: 800, color: '#111827', margin: '0 0 0.25rem' },
  subtitle:     { color: '#6b7280', fontSize: '0.9rem', margin: '0 0 1.5rem' },
  avatarSection:{ display: 'flex', alignItems: 'center', gap: '1.25rem', marginBottom: '1.5rem', background: '#fff', borderRadius: 12, padding: '1.25rem', border: '1px solid #e5e7eb' },
  avatar:       { width: 64, height: 64, borderRadius: '50%', background: '#4f46e5', color: '#fff', fontSize: '1.75rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarName:   { fontWeight: 700, color: '#111827', margin: '0 0 0.2rem', fontSize: '1rem' },
  avatarEmail:  { color: '#6b7280', fontSize: '0.875rem', margin: '0 0 0.4rem' },
  planBadge:    { fontSize: '0.7rem', fontWeight: 700, background: '#4f46e5', color: '#fff', borderRadius: 10, padding: '2px 8px' },
  card:         { background: '#fff', borderRadius: 12, padding: '1.5rem', border: '1px solid #e5e7eb', marginBottom: '1rem' },
  sectionTitle: { fontSize: '1rem', fontWeight: 700, color: '#111827', margin: '0 0 1rem' },
  alert:        { borderRadius: 8, padding: '0.6rem 1rem', fontSize: '0.875rem', marginBottom: '1rem' },
  form:         { display: 'flex', flexDirection: 'column', gap: '1rem' },
  label:        { display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.875rem', fontWeight: 500, color: '#374151' },
  input:        { border: '1px solid #d1d5db', borderRadius: 8, padding: '0.5rem 0.75rem', fontSize: '0.9rem', outline: 'none', fontFamily: 'inherit', background: '#fff' },
  btnPrimary:   { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '0.6rem 1.25rem', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem', alignSelf: 'flex-start' },
  btnSecondary: { background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 8, padding: '0.6rem 1.25rem', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem' },
}
