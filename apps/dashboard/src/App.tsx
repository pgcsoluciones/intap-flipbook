import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import NewPublication from './pages/NewPublication'
import EditPublication from './pages/EditPublication'
import Preview from './pages/Preview'
import Publications from './pages/Publications'
import ComingSoon from './pages/ComingSoon'

function LegacyRedirect({ pattern }: { pattern: string }) {
  const { id } = useParams()
  return <Navigate to={pattern.replace('{id}', id!)} replace />
}

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return <Layout>{children}</Layout>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* Rutas protegidas con sidebar */}
        <Route path="/dashboard" element={<ProtectedLayout><Dashboard /></ProtectedLayout>} />
        <Route path="/publications" element={<ProtectedLayout><Publications /></ProtectedLayout>} />
        <Route path="/publications/new" element={<ProtectedLayout><NewPublication /></ProtectedLayout>} />
        <Route path="/publications/:id/editor" element={<ProtectedLayout><EditPublication /></ProtectedLayout>} />
        <Route path="/publications/:id/preview" element={<ProtectedLayout><Preview /></ProtectedLayout>} />
        <Route path="/publications/:id/settings" element={<ProtectedLayout><ComingSoon title="Configuración del Flipbook" /></ProtectedLayout>} />
        <Route path="/templates" element={<ProtectedLayout><ComingSoon title="Plantillas" description="Galería de plantillas prediseñadas por categoría y plan." /></ProtectedLayout>} />
        <Route path="/resources" element={<ProtectedLayout><ComingSoon title="Recursos" description="Íconos, fondos, formas y botones para el editor." /></ProtectedLayout>} />
        <Route path="/tutorials" element={<ProtectedLayout><ComingSoon title="Tutoriales" description="Guías y videos para sacar el máximo provecho." /></ProtectedLayout>} />
        <Route path="/stats" element={<ProtectedLayout><ComingSoon title="Estadísticas" description="Vistas por flipbook, página y dispositivo." /></ProtectedLayout>} />
        <Route path="/promotions" element={<ProtectedLayout><ComingSoon title="Promociones" description="Ofertas activas para tu plan." /></ProtectedLayout>} />
        <Route path="/referrals" element={<ProtectedLayout><ComingSoon title="Referidos" description="Tu link de referido y estado de recompensas." /></ProtectedLayout>} />
        <Route path="/plan" element={<ProtectedLayout><ComingSoon title="Mi Plan" description="Plan actual, uso y solicitud de cambio." /></ProtectedLayout>} />
        <Route path="/profile" element={<ProtectedLayout><ComingSoon title="Perfil" description="Datos de tu negocio y marca." /></ProtectedLayout>} />

        {/* Rutas legacy → redirigen a las nuevas */}
        <Route path="/new" element={<Navigate to="/publications/new" replace />} />
        <Route path="/edit/:id" element={<LegacyRedirect pattern="/publications/{id}/editor" />} />
        <Route path="/preview/:id" element={<LegacyRedirect pattern="/publications/{id}/preview" />} />

        {/* Raíz → dashboard */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
