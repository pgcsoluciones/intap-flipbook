import { useEffect, useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { api } from '../lib/api'
import { useIsMobile } from '../hooks/useIsMobile'

function NavIcon({ name }: { name: string }) {
  const props = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (name === 'home') return <svg {...props}><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>
  if (name === 'book') return <svg {...props}><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>
  if (name === 'mail') return <svg {...props}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 7l10 7 10-7"/></svg>
  if (name === 'grid') return <svg {...props}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
  if (name === 'image') return <svg {...props}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
  if (name === 'play') return <svg {...props}><circle cx="12" cy="12" r="9"/><path d="M10 8l6 4-6 4V8z" fill="currentColor" stroke="none"/></svg>
  if (name === 'bar-chart') return <svg {...props}><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>
  if (name === 'gift') return <svg {...props}><path d="M20 12v10H4V12"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></svg>
  if (name === 'users') return <svg {...props}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
  if (name === 'diamond') return <svg {...props}><path d="M2.7 10.3l9.3 10 9.3-10L17.7 4H6.3L2.7 10.3z"/><path d="M2.7 10.3h18.6"/><path d="M8 4l4 6.3L16 4"/></svg>
  if (name === 'user') return <svg {...props}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
  if (name === 'shield') return <svg {...props}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
  if (name === 'bell') return <svg {...props}><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
  if (name === 'logout') return <svg {...props}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
  return null
}

// Botón de campana reutilizable con burbuja de conteo
function BellButton({ count, onClick, color = '#fff' }: { count: number; onClick: () => void; color?: string }) {
  return (
    <button
      onClick={onClick}
      title="Notificaciones"
      aria-label="Notificaciones"
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 8, position: 'relative', color, display: 'flex', alignItems: 'center' }}
    >
      <NavIcon name="bell" />
      {count > 0 && (
        <span style={{
          position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, padding: '0 4px',
          borderRadius: 8, background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
          boxSizing: 'border-box',
        }}>
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  )
}

const NAV_ITEMS = [
  { to: '/dashboard',    icon: 'home',      label: 'Inicio' },
  { to: '/publications', icon: 'book',      label: 'Mis Flipbooks' },
  { to: '/responses',    icon: 'mail',      label: 'Respuestas' },
  { to: '/templates',    icon: 'grid',      label: 'Plantillas' },
  { to: '/resources',    icon: 'image',     label: 'Recursos' },
  { to: '/tutorials',    icon: 'play',      label: 'Tutoriales' },
  { to: '/stats',        icon: 'bar-chart', label: 'Estadísticas' },
  { to: '/promotions',   icon: 'gift',      label: 'Promociones' },
  { to: '/referrals',    icon: 'users',     label: 'Referidos' },
  { to: '/plan',         icon: 'diamond',   label: 'Mi Plan' },
  { to: '/profile',      icon: 'user',      label: 'Perfil' },
]

const PLAN_LABELS: Record<string, string> = {
  free: 'Free', basic: 'Basic', pro: 'Pro',
}

interface Props {
  children: React.ReactNode
}

function NotifDropdown({
  notifications,
  onMarkRead,
  onClose,
  placement = 'up',
}: {
  notifications: any[]
  onMarkRead: (id: number | string) => void
  onClose: () => void
  placement?: 'up' | 'down'
}) {
  const visible = notifications.slice(0, 5)
  return (
    <div style={{
      position: 'absolute',
      ...(placement === 'down' ? { top: '110%' } : { bottom: '110%' }),
      right: 0,
      width: 280,
      background: '#fff',
      borderRadius: 10,
      boxShadow: '0 4px 24px rgba(0,0,0,.18)',
      zIndex: 200,
      overflow: 'hidden',
      border: '1px solid #e5e7eb',
    }}>
      <div style={{ padding: '10px 14px', fontWeight: 700, fontSize: 13, borderBottom: '1px solid #f3f4f6', color: '#111827' }}>
        Notificaciones
        <button onClick={onClose} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 16, lineHeight: 1 }}>×</button>
      </div>
      {visible.length === 0 ? (
        <div style={{ padding: '1.5rem', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>Sin notificaciones</div>
      ) : (
        visible.map((n) => (
          <div
            key={n.id}
            onClick={() => { if (!n.read) onMarkRead(n.id) }}
            style={{
              padding: '10px 14px',
              borderBottom: '1px solid #f9fafb',
              background: n.read ? '#fff' : '#f0f0ff',
              cursor: n.read ? 'default' : 'pointer',
            }}
          >
            <div style={{ fontWeight: n.read ? 400 : 600, fontSize: 13, color: '#111827', marginBottom: 2 }}>{n.title}</div>
            <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.4 }}>{n.message}</div>
          </div>
        ))
      )}
    </div>
  )
}

export default function Layout({ children }: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  const isMobile = useIsMobile()
  const [user, setUser] = useState<any>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [notifications, setNotifications] = useState<any[]>([])
  const [notifOpen, setNotifOpen] = useState(false)
  const [isImpersonating] = useState(!!localStorage.getItem('admin_token'))

  function exitImpersonation() {
    const adminToken = localStorage.getItem('admin_token')
    if (adminToken) {
      localStorage.setItem('token', adminToken)
      localStorage.removeItem('admin_token')
      navigate('/admin/tenants')
    }
  }

  useEffect(() => {
    if (!localStorage.getItem('token')) { navigate('/login'); return }
    api.auth.me()
      .then((res) => setUser(res.data))
      .catch(() => { localStorage.removeItem('token'); navigate('/login') })
    api.notifications.list()
      .then((res) => setNotifications(res.data ?? []))
      .catch(() => {})
  }, [])

  async function handleMarkRead(id: number | string) {
    await api.notifications.markRead(id).catch(() => {})
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: 1 } : n))
  }

  // Cierra el cajón al navegar a otra página en móvil
  useEffect(() => { setDrawerOpen(false) }, [location.pathname])

  function logout() {
    localStorage.removeItem('token')
    navigate('/login')
  }

  const unreadCount = notifications.filter((n) => !n.read).length

  // En móvil el sidebar es un cajón deslizable; en escritorio queda fijo.
  const sidebarStyle: React.CSSProperties = isMobile
    ? { ...s.sidebar, transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform .25s ease', boxShadow: drawerOpen ? '0 0 40px rgba(0,0,0,.4)' : 'none' }
    : s.sidebar

  return (
    <div style={{ ...s.root, paddingTop: isImpersonating ? 36 : 0 }}>
      {isImpersonating && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999, background: '#7c3aed', color: '#fff', padding: '6px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8rem', height: 36 }}>
          <span>🕵️ Modo impersonación — estás viendo como otro tenant</span>
          <button onClick={exitImpersonation} style={{ background: 'rgba(255,255,255,.25)', border: 'none', borderRadius: 6, color: '#fff', padding: '3px 10px', cursor: 'pointer', fontWeight: 600 }}>Salir</button>
        </div>
      )}
      {/* Barra superior solo en móvil con botón hamburguesa */}
      {isMobile && (
        <header style={s.mobileBar}>
          <button style={s.hamburger} onClick={() => setDrawerOpen(true)} aria-label="Abrir menú">☰</button>
          <span style={s.mobileLogo}>📖 Intap Flipbook</span>
          <div style={{ marginLeft: 'auto', position: 'relative' }}>
            <BellButton count={unreadCount} onClick={() => setNotifOpen((o) => !o)} />
            {notifOpen && (
              <NotifDropdown
                notifications={notifications}
                onMarkRead={handleMarkRead}
                onClose={() => setNotifOpen(false)}
              />
            )}
          </div>
        </header>
      )}

      {/* Barra superior derecha en escritorio: campana de notificaciones */}
      {!isMobile && (
        <div style={{ position: 'fixed', top: isImpersonating ? 36 : 0, right: 0, height: 52, display: 'flex', alignItems: 'center', paddingRight: 20, zIndex: 80 }}>
          <div style={{ position: 'relative' }}>
            <BellButton count={unreadCount} onClick={() => setNotifOpen((o) => !o)} color="#4f46e5" />
            {notifOpen && (
              <NotifDropdown
                notifications={notifications}
                onMarkRead={handleMarkRead}
                onClose={() => setNotifOpen(false)}
                placement="down"
              />
            )}
          </div>
        </div>
      )}

      {/* Fondo oscuro al abrir el cajón en móvil */}
      {isMobile && drawerOpen && <div style={s.backdrop} onClick={() => setDrawerOpen(false)} />}

      {/* Sidebar */}
      <aside style={sidebarStyle}>
        <div style={s.sidebarLogo}>
          <span style={s.logoIcon}>📖</span>
          <span style={s.logoText}>Intap Flipbook</span>
        </div>

        <nav style={s.nav}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({
                ...s.navItem,
                background: isActive ? 'rgba(79,70,229,.35)' : 'transparent',
                color: isActive ? '#fff' : 'rgba(255,255,255,.7)',
                fontWeight: isActive ? 600 : 400,
              })}
            >
              <span style={s.navIcon}><NavIcon name={item.icon} /></span>
              <span>{item.label}</span>
            </NavLink>
          ))}
          {user?.is_admin ? (
            <NavLink
              to="/admin"
              style={({ isActive }) => ({
                ...s.navItem,
                background: isActive ? 'rgba(124,58,237,.4)' : 'rgba(124,58,237,.15)',
                color: isActive ? '#fff' : 'rgba(255,255,255,.85)',
                fontWeight: isActive ? 600 : 500,
                marginTop: 8,
              })}
            >
              <span style={s.navIcon}><NavIcon name="shield" /></span>
              <span>Admin</span>
            </NavLink>
          ) : null}
        </nav>

        {/* Usuario + plan al pie del sidebar */}
        <div style={s.sidebarFooter}>
          {user && (
            <>
              <div style={s.userInfo}>
                <div style={s.userAvatar}>{(user.name || user.email)[0].toUpperCase()}</div>
                <div style={s.userDetails}>
                  <span style={s.userName}>{user.name || user.email.split('@')[0]}</span>
                  <span style={s.userPlan}>{PLAN_LABELS[user.plan_id] ?? user.plan_id}</span>
                </div>
              </div>
              <button style={{ ...s.logoutBtn, display: 'flex', alignItems: 'center' }} onClick={logout} title="Cerrar sesión">
                <NavIcon name="logout" />
              </button>
            </>
          )}
        </div>
      </aside>

      {/* Área principal */}
      <main style={{ ...s.main, marginLeft: isMobile ? 0 : 240, paddingTop: isMobile ? 52 : 0 }}>
        {children}
      </main>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    minHeight: '100vh',
  },
  sidebar: {
    width: 240,
    minWidth: 240,
    background: '#1E1B4B',
    display: 'flex',
    flexDirection: 'column',
    position: 'fixed',
    top: 0,
    left: 0,
    bottom: 0,
    zIndex: 100,
    overflowY: 'auto',
  },
  sidebarLogo: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '24px 20px 20px',
    borderBottom: '1px solid rgba(255,255,255,.08)',
  },
  logoIcon: { fontSize: 22 },
  logoText: { color: '#fff', fontWeight: 700, fontSize: 15 },
  nav: {
    flex: 1,
    padding: '12px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '9px 12px',
    borderRadius: 8,
    fontSize: 14,
    transition: 'background .15s, color .15s',
    textDecoration: 'none',
  },
  navIcon: { width: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  sidebarFooter: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '14px 12px',
    borderTop: '1px solid rgba(255,255,255,.08)',
  },
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    overflow: 'hidden',
  },
  userAvatar: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: '#4F46E5',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 700,
    flexShrink: 0,
  },
  userDetails: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  userName: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  userPlan: {
    color: 'rgba(255,255,255,.5)',
    fontSize: 11,
  },
  logoutBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,.5)',
    fontSize: 18,
    cursor: 'pointer',
    padding: '4px 6px',
    borderRadius: 6,
    flexShrink: 0,
    transition: 'color .15s',
  },
  main: {
    flex: 1,
    minHeight: '100vh',
    background: 'var(--color-surface)',
    overflowX: 'hidden',
  },
  mobileBar: {
    position: 'fixed',
    top: 0, left: 0, right: 0,
    height: 52,
    background: '#1E1B4B',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '0 16px',
    zIndex: 90,
  },
  hamburger: {
    background: 'none',
    border: 'none',
    color: '#fff',
    fontSize: 24,
    cursor: 'pointer',
    lineHeight: 1,
    padding: 0,
  },
  mobileLogo: { color: '#fff', fontWeight: 700, fontSize: 15 },
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,.45)',
    zIndex: 99,
  },
  notifDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#ef4444',
    border: '1.5px solid #1E1B4B',
  },
}
