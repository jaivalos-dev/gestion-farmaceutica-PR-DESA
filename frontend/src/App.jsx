import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import AuthProvider from './auth/AuthProvider'
import ProtectedRoute from './routes/ProtectedRoute'
import AdminLayout from './layouts/AdminLayout'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import ForbiddenPage from './pages/ForbiddenPage'
import SucursalesPage from './modules/sucursales/SucursalesPage'
import MedicamentosPage from './modules/medicamentos/MedicamentosPage'
import InventarioPage from './modules/inventario/InventarioPage'
import TransferenciasPage from './modules/transferencias/TransferenciasPage'
import VentasPage from './modules/ventas/VentasPage'
import CajaPage from './modules/caja/CajaPage'
import ActivosPage from './modules/activos/ActivosPage'
import PlanillaPage from './modules/planilla/PlanillaPage'
import EntregasPage from './modules/entregas/EntregasPage'
import DisponibilidadPage from './modules/disponibilidad/DisponibilidadPage'
import AuditoriaPage from './modules/auditoria/AuditoriaPage'
import DashboardPage from './modules/dashboard/DashboardPage'

export default function App() {
  return <BrowserRouter><AuthProvider><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<ProtectedRoute />}>
      <Route element={<AdminLayout />}>
        <Route index element={<HomePage />} />
        <Route element={<ProtectedRoute permission="dashboard.read" />}>
          <Route path="dashboard" element={<DashboardPage />} />
        </Route>
        <Route path="403" element={<ForbiddenPage />} />
        <Route element={<ProtectedRoute permission="sucursales.read" />}>
          <Route path="sucursales" element={<SucursalesPage />} />
        </Route>
        <Route element={<ProtectedRoute permission="medicamentos.read" />}>
          <Route path="medicamentos" element={<MedicamentosPage />} />
        </Route>
        <Route element={<ProtectedRoute permission="inventario.read" />}>
          <Route path="inventario" element={<InventarioPage />} />
        </Route>
        <Route element={<ProtectedRoute permission="transferencias.read" />}>
          <Route path="transferencias" element={<TransferenciasPage />} />
        </Route>
        <Route element={<ProtectedRoute permission="ventas.read" />}>
          <Route path="ventas" element={<VentasPage />} />
        </Route>
        <Route element={<ProtectedRoute permission="caja.read" />}>
          <Route path="caja" element={<CajaPage />} />
        </Route>
        <Route element={<ProtectedRoute permission="activos.read" />}>
          <Route path="activos" element={<ActivosPage />} />
        </Route>
        <Route element={<ProtectedRoute permission="planilla.read" />}>
          <Route path="planilla" element={<PlanillaPage />} />
        </Route>
        <Route element={<ProtectedRoute permission="entregas.read" />}>
          <Route path="entregas" element={<EntregasPage />} />
        </Route>
        <Route element={<ProtectedRoute permission="disponibilidad.read" />}>
          <Route path="disponibilidad" element={<DisponibilidadPage />} />
        </Route>
        <Route element={<ProtectedRoute permission="auditoria.read" />}>
          <Route path="auditoria" element={<AuditoriaPage />} />
        </Route>
        <Route path="*" element={<><h1>Página no encontrada</h1><Link to="/">Volver al inicio</Link></>} />
      </Route>
    </Route>
  </Routes></AuthProvider></BrowserRouter>
}
