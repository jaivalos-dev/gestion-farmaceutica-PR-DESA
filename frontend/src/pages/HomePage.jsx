import { Link } from 'react-router-dom'

export default function HomePage() {
  return <>
    <h1 className="h4 mb-3">Sistema Integral de Gestión Farmacéutica</h1>
    <p>Bienvenido al sistema administrativo de gestión farmacéutica multisucursal.</p>
    <p className="text-body-secondary">Seleccione una opción para consultar la información disponible.</p>
    <div className="d-flex flex-wrap gap-2 mt-4">
      <Link className="btn btn-primary" to="/sucursales">Consultar sucursales</Link>
      <Link className="btn btn-outline-primary" to="/medicamentos">Consultar medicamentos</Link>
    </div>
  </>
}
