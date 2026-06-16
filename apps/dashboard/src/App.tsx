import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import Layout from './components/Layout'
import AdminLayout from './components/AdminLayout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import NewPublication from './pages/NewPublication'
import EditPublication from './pages/EditPublication'
import Preview from './pages/Preview'
import Publications from './pages/Publications'
import Settings from './pages/Settings'
import PlanPage from './pages/PlanPage'
import ProfilePage from './pages/ProfilePage'
import ComingSoon from './pages/ComingSoon'

// Admin pages
import AdminDashboard    from './pages/admin/AdminDashboard'
import AdminTenants      from './pages/admin/AdminTenants'
import AdminTenantProfile from './pages/admin/AdminTenantProfile'
import AdminPlans        from './pages/admin/AdminPlans'
import AdminPayments     from './pages/admin/AdminPayments'
import AdminGateways     from './pages/admin/AdminGateways'
import AdminModules      from './pages/admin/AdminModules'
import AdminResources    from './pages/admin/AdminResources'
import AdminPromotions   from './pages/admin/AdminPromotions'
import AdminReferrals    from './pages/admin/AdminReferrals'
import AdminBranding     from './pages/admin/AdminBranding'
import AdminNotifications from './pages/admin/AdminNotifications'
import AdminStats        from './pages/admin/AdminStats'

function LegacyRedirect({ pattern }: { pattern: string }) {
  const { id } = useParams()
  return <Navigate to={pattern.replace('{id}', id!)} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* Publicaciones */}
        <Route path="/dashboard"                 element={<Layout><Dashboard /></Layout>} />
        <Route path="/publications"              element={<Layout><Publications /></Layout>} />
        <Route path="/publications/new"          element={<Layout><NewPublication /></Layout>} />
        <Route path="/publications/:id/editor"   element={<Layout><EditPublication /></Layout>} />
        <Route path="/publications/:id/preview"  element={<Layout><Preview /></Layout>} />
        <Route path="/publications/:id/settings" element={<Layout><Settings /></Layout>} />

        {/* Cuenta */}
        <Route path="/plan"    element={<Layout><PlanPage /></Layout>} />
        <Route path="/profile" element={<Layout><ProfilePage /></Layout>} />

        {/* Coming soon */}
        <Route path="/templates"  element={<Layout><ComingSoon title="Plantillas" description="Galería de plantillas prediseñadas por categoría y plan." /></Layout>} />
        <Route path="/resources"  element={<Layout><ComingSoon title="Recursos" description="Íconos, fondos, formas y botones para el editor." /></Layout>} />
        <Route path="/tutorials"  element={<Layout><ComingSoon title="Tutoriales" description="Guías y videos para sacar el máximo provecho." /></Layout>} />
        <Route path="/stats"      element={<Layout><ComingSoon title="Estadísticas" description="Vistas por flipbook, página y dispositivo." /></Layout>} />
        <Route path="/promotions" element={<Layout><ComingSoon title="Promociones" description="Ofertas activas para tu plan." /></Layout>} />
        <Route path="/referrals"  element={<Layout><ComingSoon title="Referidos" description="Tu link de referido y estado de recompensas." /></Layout>} />

        {/* Admin */}
        <Route path="/admin"                    element={<AdminLayout><AdminDashboard /></AdminLayout>} />
        <Route path="/admin/tenants"            element={<AdminLayout><AdminTenants /></AdminLayout>} />
        <Route path="/admin/tenants/:id"        element={<AdminLayout><AdminTenantProfile /></AdminLayout>} />
        <Route path="/admin/plans"              element={<AdminLayout><AdminPlans /></AdminLayout>} />
        <Route path="/admin/payments"           element={<AdminLayout><AdminPayments /></AdminLayout>} />
        <Route path="/admin/gateways"           element={<AdminLayout><AdminGateways /></AdminLayout>} />
        <Route path="/admin/modules"            element={<AdminLayout><AdminModules /></AdminLayout>} />
        <Route path="/admin/resources"          element={<AdminLayout><AdminResources /></AdminLayout>} />
        <Route path="/admin/promotions"         element={<AdminLayout><AdminPromotions /></AdminLayout>} />
        <Route path="/admin/referrals"          element={<AdminLayout><AdminReferrals /></AdminLayout>} />
        <Route path="/admin/branding"           element={<AdminLayout><AdminBranding /></AdminLayout>} />
        <Route path="/admin/notifications"      element={<AdminLayout><AdminNotifications /></AdminLayout>} />
        <Route path="/admin/stats"              element={<AdminLayout><AdminStats /></AdminLayout>} />

        {/* Rutas legacy */}
        <Route path="/new"         element={<Navigate to="/publications/new" replace />} />
        <Route path="/edit/:id"    element={<LegacyRedirect pattern="/publications/{id}/editor" />} />
        <Route path="/preview/:id" element={<LegacyRedirect pattern="/publications/{id}/preview" />} />

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
