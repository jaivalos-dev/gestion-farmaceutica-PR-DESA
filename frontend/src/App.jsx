import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import AuthProvider from './auth/AuthProvider'
import ProtectedRoute from './routes/ProtectedRoute'
import AdminLayout from './layouts/AdminLayout'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import ForbiddenPage from './pages/ForbiddenPage'
import SucursalesPage from './modules/sucursales/SucursalesPage'
import MedicamentosPage from './modules/medicamentos/MedicamentosPage'

export default function App() {
  return <BrowserRouter><AuthProvider><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<ProtectedRoute />}>
      <Route element={<AdminLayout />}>
        <Route index element={<HomePage />} />
        <Route path="403" element={<ForbiddenPage />} />
        <Route element={<ProtectedRoute permission="sucursales.read" />}>
          <Route path="sucursales" element={<SucursalesPage />} />
        </Route>
        <Route element={<ProtectedRoute permission="medicamentos.read" />}>
          <Route path="medicamentos" element={<MedicamentosPage />} />
        </Route>
        <Route path="*" element={<><h1>Página no encontrada</h1><Link to="/">Volver al inicio</Link></>} />
      </Route>
    </Route>
  </Routes></AuthProvider></BrowserRouter>
}
