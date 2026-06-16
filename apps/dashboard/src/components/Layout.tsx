import { useEffect, useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { api } from '../lib/api'
import { useIsMobile } from '../hooks/useIsMobile'

const NAV_ITEMS = [
  { to: '/dashboard',    icon: '🏠', label: 'Inicio' },
  { to: '/publications', icon: '📚', label: 'Mis Flipbooks' },
  { to: '/templates',    icon: '🎨', label: 'Plantillas' },
  { to: '/resources',    icon: '🖼️',  label: 'Recursos' },
  { to: '/tutorials',    icon: '🎓', label: 'Tutoriales' },
  { to: '/stats',        icon: '📊', label: 'Estadísticas' },
  { to: '/promotions',   icon: '🎁', label: 'Promociones' },
  { to: '/referrals',    icon: '🤝', label: 'Referidos' },
  { to: '/plan',         icon: '💎', label: 'Mi Plan' },
  { to: '/profile',      icon: '👤', label: 'Perfil' },
]

const PLAN_LABELS: Record<string, string> = {
  free: 'Free', basic: 'Basic', pro: 'Pro',
}

interface Props {
  children: React.ReactNode
}

export default function Layout({ children }: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  const isMobile = useIsMobile()
  const [user, setUser] = useState<any>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem('token')) { navigate('/login'); return }
    api.auth.me()
      .then((res) => setUser(res.data))
      .catch(() => { localStorage.removeItem('token'); navigate('/login') })
  }, [])

  // Cierra el cajón al navegar a otra página en móvil
  useEffect(() => { setDrawerOpen(false) }, [location.pathname])

  function logout() {
    localStorage.removeItem('token')
    navigate('/login')
  }

  // En móvil el sidebar es un cajón deslizable; en escritorio queda fijo.
  const sidebarStyle: React.CSSProperties = isMobile
    ? { ...s.sidebar, transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform .25s ease', boxShadow: drawerOpen ? '0 0 40px rgba(0,0,0,.4)' : 'none' }
    : s.sidebar

  return (
    <div style={s.root}>
      {/* Barra superior solo en móvil con botón hamburguesa */}
      {isMobile && (
        <header style={s.mobileBar}>
          <button style={s.hamburger} onClick={() => setDrawerOpen(true)} aria-label="Abrir menú">☰</button>
          <span style={s.mobileLogo}>📖 Intap Flipbook</span>
        </header>
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
              <span style={s.navIcon}>{item.icon}</span>
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
              <span style={s.navIcon}>🛡️</span>
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
              <button style={s.logoutBtn} onClick={logout} title="Cerrar sesión">⇠</button>
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
  navIcon: { fontSize: 16, width: 20, textAlign: 'center' as const },
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
}
