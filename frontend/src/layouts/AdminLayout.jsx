import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { hasPermission } from '../auth/permissions'

export default function AdminLayout() {
  const { session, logout } = useAuth()
  const user = session.user
  return <>
    <header className="navbar navbar-dark site-header py-3">
      <div className="container-xl d-flex flex-wrap gap-3">
        <strong className="navbar-brand system-name m-0">Sistema Integral de Gestión Farmacéutica</strong>
        <nav className="navbar-nav flex-row flex-wrap gap-3" aria-label="Navegación principal">
          <NavLink className="nav-link" to="/" end>Inicio</NavLink>
          {hasPermission(user, 'sucursales.read') && <NavLink className="nav-link" to="/sucursales">Sucursales</NavLink>}
          {hasPermission(user, 'medicamentos.read') && <NavLink className="nav-link" to="/medicamentos">Medicamentos</NavLink>}
        </nav>
        <div className="d-flex align-items-center gap-4 ms-auto">
          <span className="small text-white text-end">Usuario {user.id_usuario} · {user.nombre_rol}{user.id_sucursal != null && <><br />Sucursal {user.id_sucursal}</>}</span>
          <button className="btn btn-outline-light btn-sm text-nowrap" type="button" onClick={() => logout()}>Cerrar sesión</button>
        </div>
      </div>
    </header>
    <main className="container-xl my-4">
      <div className="card"><div className="card-body p-3 p-md-4"><Outlet /></div></div>
    </main>
  </>
}
