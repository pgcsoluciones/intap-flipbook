import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import Layout from './components/Layout'
import AdminLayout from './components/AdminLayout'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import NewPublication from './pages/NewPublication'
import EditPublication from './pages/EditPublication'
import Preview from './pages/Preview'
import Publications from './pages/Publications'
import Settings from './pages/Settings'
import PlanPage from './pages/PlanPage'
import ProfilePage from './pages/ProfilePage'
import TenantTemplates  from './pages/TenantTemplates'
import TenantResponses  from './pages/TenantResponses'
import TenantResources  from './pages/TenantResources'
import TenantTutorials  from './pages/TenantTutorials'
import TenantStats      from './pages/TenantStats'
import TenantPromotions from './pages/TenantPromotions'
import TenantReferrals  from './pages/TenantReferrals'
import PublicFeed       from './pages/PublicFeed'

// Admin pages
import AdminDashboard     from './pages/admin/AdminDashboard'
import AdminTenants       from './pages/admin/AdminTenants'
import AdminTenantProfile from './pages/admin/AdminTenantProfile'
import AdminPlans         from './pages/admin/AdminPlans'
import AdminPayments      from './pages/admin/AdminPayments'
import AdminGateways      from './pages/admin/AdminGateways'
import AdminModules       from './pages/admin/AdminModules'
import AdminResources     from './pages/admin/AdminResources'
import AdminPromotions    from './pages/admin/AdminPromotions'
import AdminReferrals     from './pages/admin/AdminReferrals'
import AdminBranding      from './pages/admin/AdminBranding'
import AdminNotifications from './pages/admin/AdminNotifications'
import AdminStats         from './pages/admin/AdminStats'

function LegacyRedirect({ pattern }: { pattern: string }) {
  const { id } = useParams()
  return <Navigate to={pattern.replace('{id}', id!)} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login"    element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Publicaciones */}
        <Route path="/dashboard"                 element={<Layout><Dashboard /></Layout>} />
        <Route path="/publications"              element={<Layout><Publications /></Layout>} />
        <Route path="/publications/new"          element={<NewPublication />} />
        <Route path="/publications/:id/editor"   element={<EditPublication />} />
        <Route path="/publications/:id/preview"  element={<Layout><Preview /></Layout>} />
        <Route path="/publications/:id/settings" element={<Layout><Settings /></Layout>} />

        {/* Cuenta */}
        <Route path="/plan"    element={<Layout><PlanPage /></Layout>} />
        <Route path="/profile" element={<Layout><ProfilePage /></Layout>} />

        {/* Páginas tenant */}
        <Route path="/responses"  element={<Layout><TenantResponses /></Layout>} />
        <Route path="/templates"  element={<Layout><TenantTemplates /></Layout>} />
        <Route path="/resources"  element={<Layout><TenantResources /></Layout>} />
        <Route path="/tutorials"  element={<Layout><TenantTutorials /></Layout>} />
        <Route path="/stats"      element={<Layout><TenantStats /></Layout>} />
        <Route path="/promotions" element={<Layout><TenantPromotions /></Layout>} />
        <Route path="/referrals"  element={<Layout><TenantReferrals /></Layout>} />

        {/* Admin */}
        <Route path="/admin"               element={<AdminLayout><AdminDashboard /></AdminLayout>} />
        <Route path="/admin/tenants"       element={<AdminLayout><AdminTenants /></AdminLayout>} />
        <Route path="/admin/tenants/:id"   element={<AdminLayout><AdminTenantProfile /></AdminLayout>} />
        <Route path="/admin/plans"         element={<AdminLayout><AdminPlans /></AdminLayout>} />
        <Route path="/admin/payments"      element={<AdminLayout><AdminPayments /></AdminLayout>} />
        <Route path="/admin/gateways"      element={<AdminLayout><AdminGateways /></AdminLayout>} />
        <Route path="/admin/modules"       element={<AdminLayout><AdminModules /></AdminLayout>} />
        <Route path="/admin/resources"     element={<AdminLayout><AdminResources /></AdminLayout>} />
        <Route path="/admin/promotions"    element={<AdminLayout><AdminPromotions /></AdminLayout>} />
        <Route path="/admin/referrals"     element={<AdminLayout><AdminReferrals /></AdminLayout>} />
        <Route path="/admin/branding"      element={<AdminLayout><AdminBranding /></AdminLayout>} />
        <Route path="/admin/notifications" element={<AdminLayout><AdminNotifications /></AdminLayout>} />
        <Route path="/admin/stats"         element={<AdminLayout><AdminStats /></AdminLayout>} />

        {/* Rutas legacy */}
        <Route path="/new"         element={<Navigate to="/publications/new" replace />} />
        <Route path="/edit/:id"    element={<LegacyRedirect pattern="/publications/{id}/editor" />} />
        <Route path="/preview/:id" element={<LegacyRedirect pattern="/publications/{id}/preview" />} />

        {/* Feed público — sin auth */}
        <Route path="/p/:tenantSlug" element={<PublicFeed />} />

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
