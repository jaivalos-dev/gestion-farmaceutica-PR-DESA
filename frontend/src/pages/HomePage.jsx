import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { hasPermission } from '../auth/permissions'

export default function HomePage() {
  const { session } = useAuth()
  return <>
    <h1 className="h4 mb-3">Sistema Integral de Gestión Farmacéutica</h1>
    <p>Bienvenido al sistema administrativo de gestión farmacéutica multisucursal.</p>
    <p className="text-body-secondary">Seleccione una opción para consultar la información disponible.</p>
    <div className="d-flex flex-wrap gap-2 mt-4">
      {hasPermission(session.user, 'dashboard.read') && <Link className="btn btn-outline-primary" to="/dashboard">Dashboard</Link>}
      {hasPermission(session.user, 'sucursales.read') && <Link className="btn btn-primary" to="/sucursales">Consultar sucursales</Link>}
      {hasPermission(session.user, 'medicamentos.read') && <Link className="btn btn-outline-primary" to="/medicamentos">Consultar medicamentos</Link>}
      {hasPermission(session.user, 'inventario.read') && <Link className="btn btn-outline-primary" to="/inventario">Consultar inventario</Link>}
      {hasPermission(session.user, 'transferencias.read') && <Link className="btn btn-outline-primary" to="/transferencias">Consultar transferencias</Link>}
      {hasPermission(session.user, 'ventas.read') && <Link className="btn btn-outline-primary" to="/ventas">Consultar ventas</Link>}
      {hasPermission(session.user, 'caja.read') && <Link className="btn btn-outline-primary" to="/caja">Consultar caja</Link>}
      {hasPermission(session.user, 'activos.read') && <Link className="btn btn-outline-primary" to="/activos">Consultar activos fijos</Link>}
      {hasPermission(session.user, 'planilla.read') && <Link className="btn btn-outline-primary" to="/planilla">Consultar planilla</Link>}
      {hasPermission(session.user, 'entregas.read') && <Link className="btn btn-outline-primary" to="/entregas">Consultar entregas</Link>}
      {hasPermission(session.user, 'disponibilidad.read') && <Link className="btn btn-outline-primary" to="/disponibilidad">Consultar disponibilidad</Link>}
      {hasPermission(session.user, 'auditoria.read') && <Link className="btn btn-outline-primary" to="/auditoria">Consultar auditoría</Link>}
    </div>
  </>
}
