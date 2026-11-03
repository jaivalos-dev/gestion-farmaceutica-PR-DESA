import { Link } from 'react-router-dom'

export default function ForbiddenPage() {
  return <>
    <h1 className="h4 mb-3">Acceso no permitido</h1>
    <p className="alert alert-warning" role="alert">No tiene permisos para acceder a este recurso.</p>
    <Link className="btn btn-primary" to="/">Volver al inicio</Link>
  </>
}
