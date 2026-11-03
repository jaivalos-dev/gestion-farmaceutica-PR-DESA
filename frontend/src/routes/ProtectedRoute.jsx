import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { getAccessRedirect } from './access'

export default function ProtectedRoute({ roles, permission }) {
  const { session } = useAuth()
  const redirect = getAccessRedirect(session, { roles, permission })
  return redirect ? <Navigate to={redirect} replace /> : <Outlet />
}
