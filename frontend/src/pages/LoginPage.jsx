import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export default function LoginPage() {
  const { session, notice, login } = useAuth()
  const [correo, setCorreo] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [pending, setPending] = useState(false)

  if (session) return <Navigate to="/" replace />

  async function submit(event) {
    event.preventDefault()
    if (pending) return
    setError(null)
    setPending(true)
    try {
      await login(correo.trim(), password)
    } catch (failure) {
      setError(failure)
    } finally {
      setPassword('')
      setPending(false)
    }
  }

  return <main className="container min-vh-100 d-flex align-items-center justify-content-center py-4">
    <div className="card login-card w-100"><div className="card-body p-4">
    <h1 className="h4 mb-4">Sistema Integral de Gestión Farmacéutica</h1>
    <h2 className="h5 mb-3">Iniciar sesión</h2>
    {notice && <p className="alert alert-warning" role="status">{notice}</p>}
    {error && <p className="alert alert-danger" role="alert">{error.message}{error.code && ` (${error.code})`}</p>}
    <form onSubmit={submit} aria-busy={pending}>
      <label className="form-label" htmlFor="correo">Correo</label>
      <input className="form-control mb-3" id="correo" name="correo" type="email" autoComplete="username" required maxLength={120} value={correo} onChange={event => setCorreo(event.target.value)} disabled={pending} />
      <label className="form-label" htmlFor="password">Contraseña</label>
      <input className="form-control mb-4" id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} disabled={pending} />
      <button className="btn btn-primary w-100" type="submit" disabled={pending}>{pending ? 'Iniciando sesión…' : 'Iniciar sesión'}</button>
    </form>
    </div></div>
  </main>
}
