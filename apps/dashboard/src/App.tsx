import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import NewPublication from './pages/NewPublication'
import EditPublication from './pages/EditPublication'
import Preview from './pages/Preview'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Dashboard />} />
        <Route path="/new" element={<NewPublication />} />
        <Route path="/edit/:id" element={<EditPublication />} />
        <Route path="/preview/:id" element={<Preview />} />
      </Routes>
    </BrowserRouter>
  )
}
