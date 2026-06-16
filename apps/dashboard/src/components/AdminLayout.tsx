import { NavLink, useNavigate } from 'react-router-dom'

const NAV = [
  { to: '/admin',               icon: '📊', label: 'Dashboard' },
  { to: '/admin/tenants',       icon: '👥', label: 'Tenants' },
  { to: '/admin/plans',         icon: '💎', label: 'Planes' },
  { to: '/admin/payments',      icon: '💳', label: 'Pagos' },
  { to: '/admin/gateways',      icon: '🔌', label: 'Pasarelas' },
  { to: '/admin/modules',       icon: '🧩', label: 'Módulos' },
  { to: '/admin/resources',     icon: '🗂️',  label: 'Recursos' },
  { to: '/admin/promotions',    icon: '🎁', label: 'Promociones' },
  { to: '/admin/referrals',     icon: '🤝', label: 'Referidos' },
  { to: '/admin/branding',      icon: '🎨', label: 'Marca de agua' },
  { to: '/admin/notifications', icon: '🔔', label: 'Notificaciones' },
  { to: '/admin/stats',         icon: '📈', label: 'Estadísticas' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Sidebar negro */}
      <aside style={s.sidebar}>
        <div style={s.logo}>
          <span style={{ fontSize: 20 }}>🛡️</span>
          <div>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>Super Admin</div>
            <div style={{ color: '#71717a', fontSize: 11 }}>Intap Flipbook</div>
          </div>
        </div>

        <nav style={s.nav}>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/admin'}
              style={({ isActive }) => ({
                ...s.navItem,
                background: isActive ? 'rgba(79,70,229,.3)' : 'transparent',
                color: isActive ? '#818cf8' : '#a1a1aa',
                fontWeight: isActive ? 600 : 400,
              })}
            >
              <span style={{ width: 20, textAlign: 'center' as const }}>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div style={s.footer}>
          <button
            onClick={() => navigate('/dashboard')}
            style={s.backBtn}
          >
            ← Volver al panel
          </button>
          <button
            onClick={() => { localStorage.removeItem('token'); navigate('/login') }}
            style={s.logoutBtn}
          >
            Salir
          </button>
        </div>
      </aside>

      {/* Contenido */}
      <main style={s.main}>{children}</main>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  sidebar:  { width: 220, minWidth: 220, background: '#09090B', display: 'flex', flexDirection: 'column', position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 100, overflowY: 'auto' },
  logo:     { display: 'flex', alignItems: 'center', gap: 10, padding: '20px 16px 16px', borderBottom: '1px solid #27272a' },
  nav:      { flex: 1, padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 2 },
  navItem:  { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 7, fontSize: 13, transition: 'all .15s', textDecoration: 'none' },
  footer:   { padding: '12px 10px', borderTop: '1px solid #27272a', display: 'flex', flexDirection: 'column', gap: 6 },
  backBtn:  { background: 'transparent', border: '1px solid #3f3f46', color: '#a1a1aa', borderRadius: 7, padding: '6px 10px', fontSize: 12, cursor: 'pointer', textAlign: 'left' as const },
  logoutBtn:{ background: 'transparent', border: 'none', color: '#71717a', fontSize: 12, cursor: 'pointer', textAlign: 'left' as const, padding: '4px 10px' },
  main:     { marginLeft: 220, flex: 1, background: '#f8fafc', minHeight: '100vh', overflowX: 'hidden' },
}
