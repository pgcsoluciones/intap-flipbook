import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import Layout from './components/Layout'
import AdminLayout from './components/AdminLayout'

const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const NewPublication = lazy(() => import('./pages/NewPublication'))
const Publications = lazy(() => import('./pages/Publications'))
const TenantDynamicMarkers = lazy(() => import('./pages/TenantDynamicMarkers'))
const TenantProductDetails = lazy(() => import('./pages/TenantProductDetails'))
const Settings = lazy(() => import('./pages/Settings'))
const PlanPage = lazy(() => import('./pages/PlanPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const TenantTemplates = lazy(() => import('./pages/TenantTemplates'))
const TenantResponses = lazy(() => import('./pages/TenantResponses'))
const TenantRequests = lazy(() => import('./pages/TenantRequests'))
const TenantAgenda = lazy(() => import('./pages/TenantAgenda'))
const TenantResources = lazy(() => import('./pages/TenantResources'))
const TenantTutorials = lazy(() => import('./pages/TenantTutorials'))
const TenantStats = lazy(() => import('./pages/TenantStats'))
const TenantPromotions = lazy(() => import('./pages/TenantPromotions'))
const TenantReferrals = lazy(() => import('./pages/TenantReferrals'))
const PublicFeed = lazy(() => import('./pages/PublicFeed'))

const EditPublication = lazy(() => import('./pages/EditPublication'))
const Preview = lazy(() => import('./pages/Preview'))

// Admin pages
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const AdminTenants = lazy(() => import('./pages/admin/AdminTenants'))
const AdminTenantProfile = lazy(() => import('./pages/admin/AdminTenantProfile'))
const AdminPlans = lazy(() => import('./pages/admin/AdminPlans'))
const AdminPayments = lazy(() => import('./pages/admin/AdminPayments'))
const AdminGateways = lazy(() => import('./pages/admin/AdminGateways'))
const AdminModules = lazy(() => import('./pages/admin/AdminModules'))
const AdminResources = lazy(() => import('./pages/admin/AdminResources'))
const AdminSvg = lazy(() => import('./pages/admin/AdminSvg'))
const AdminPromotions = lazy(() => import('./pages/admin/AdminPromotions'))
const AdminReferrals = lazy(() => import('./pages/admin/AdminReferrals'))
const AdminBranding = lazy(() => import('./pages/admin/AdminBranding'))
const AdminNotifications = lazy(() => import('./pages/admin/AdminNotifications'))
const AdminStats = lazy(() => import('./pages/admin/AdminStats'))
const AdminTemplateProposals = lazy(() => import('./pages/admin/AdminTemplateProposals'))

function RouteFallback() {
  return (
    <div
      style={{
        minHeight: '40vh',
        display: 'grid',
        placeItems: 'center',
        color: '#6b7280',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      Cargando…
    </div>
  )
}

function LegacyRedirect({ pattern }: { pattern: string }) {
  const { id } = useParams()
  return <Navigate to={pattern.replace('{id}', id!)} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Publicaciones */}
          <Route path="/dashboard" element={<Layout><Dashboard /></Layout>} />
          <Route path="/publications" element={<Layout><Publications /></Layout>} />
          <Route path="/dynamic-data" element={<Layout><TenantDynamicMarkers /></Layout>} />
          <Route path="/product-details" element={<Layout><TenantProductDetails /></Layout>} />
          <Route path="/publications/new" element={<NewPublication />} />
          <Route path="/publications/:id/editor" element={<EditPublication />} />
          <Route path="/publications/:id/preview" element={<Layout><Preview /></Layout>} />
          <Route path="/publications/:id/settings" element={<Layout><Settings /></Layout>} />

          {/* Cuenta */}
          <Route path="/plan" element={<Layout><PlanPage /></Layout>} />
          <Route path="/profile" element={<Layout><ProfilePage /></Layout>} />

          {/* Páginas tenant */}
          <Route path="/responses" element={<Layout><TenantResponses /></Layout>} />
          <Route path="/requests" element={<Layout><TenantRequests /></Layout>} />
          <Route path="/agenda" element={<Layout><TenantAgenda /></Layout>} />
          <Route path="/templates" element={<Layout><TenantTemplates /></Layout>} />
          <Route path="/resources" element={<Layout><TenantResources /></Layout>} />
          <Route path="/tutorials" element={<Layout><TenantTutorials /></Layout>} />
          <Route path="/stats" element={<Layout><TenantStats /></Layout>} />
          <Route path="/promotions" element={<Layout><TenantPromotions /></Layout>} />
          <Route path="/referrals" element={<Layout><TenantReferrals /></Layout>} />

          {/* Admin */}
          <Route path="/admin" element={<AdminLayout><AdminDashboard /></AdminLayout>} />
          <Route path="/admin/tenants" element={<AdminLayout><AdminTenants /></AdminLayout>} />
          <Route path="/admin/tenants/:id" element={<AdminLayout><AdminTenantProfile /></AdminLayout>} />
          <Route path="/admin/plans" element={<AdminLayout><AdminPlans /></AdminLayout>} />
          <Route path="/admin/payments" element={<AdminLayout><AdminPayments /></AdminLayout>} />
          <Route path="/admin/gateways" element={<AdminLayout><AdminGateways /></AdminLayout>} />
          <Route path="/admin/modules" element={<AdminLayout><AdminModules /></AdminLayout>} />
          <Route path="/admin/resources" element={<AdminLayout><AdminResources /></AdminLayout>} />
          <Route path="/admin/svg" element={<AdminLayout><AdminSvg /></AdminLayout>} />
          <Route path="/admin/promotions" element={<AdminLayout><AdminPromotions /></AdminLayout>} />
          <Route path="/admin/referrals" element={<AdminLayout><AdminReferrals /></AdminLayout>} />
          <Route path="/admin/branding" element={<AdminLayout><AdminBranding /></AdminLayout>} />
          <Route path="/admin/notifications" element={<AdminLayout><AdminNotifications /></AdminLayout>} />
          <Route path="/admin/stats" element={<AdminLayout><AdminStats /></AdminLayout>} />
          <Route path="/admin/template-proposals" element={<AdminLayout><AdminTemplateProposals /></AdminLayout>} />

          {/* Rutas legacy */}
          <Route path="/new" element={<Navigate to="/publications/new" replace />} />
          <Route path="/edit/:id" element={<LegacyRedirect pattern="/publications/{id}/editor" />} />
          <Route path="/preview/:id" element={<LegacyRedirect pattern="/publications/{id}/preview" />} />

          {/* Feed público */}
          <Route path="/p/:tenantSlug" element={<PublicFeed />} />

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
