import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { AuthContext } from './AuthContext'
import { clearSession, decodeSession, readSession, saveSession, SESSION_KEY } from './session'

export default function AuthProvider({ children }) {
  const [session, setSession] = useState(() => readSession())
  const [notice, setNotice] = useState('')

  const logout = useCallback((message = '') => {
    try { clearSession() } catch { /* Siempre se elimina la sesión en memoria. */ }
    setSession(null)
    setNotice(message)
  }, [])

  useEffect(() => {
    if (!session) return
    const timer = setTimeout(() => logout('Su sesión venció. Inicie sesión nuevamente.'),
      Math.min(Math.max(0, session.user.exp * 1000 - Date.now()), 2147483647))
    return () => clearTimeout(timer)
  }, [session, logout])

  useEffect(() => {
    const syncSession = event => {
      if (event.key === SESSION_KEY || event.key === null) setSession(readSession())
    }
    window.addEventListener('storage', syncSession)
    return () => window.removeEventListener('storage', syncSession)
  }, [])

  async function login(correo, password) {
    const data = await api('/api/auth/login', { method: 'POST', body: { correo, password } })
    const nextSession = decodeSession(data.token)
    if (!nextSession) throw new Error('El servidor devolvió una sesión no válida.')
    try { saveSession(data.token) } catch {
      throw new Error('No se pudo guardar la sesión. Habilite el almacenamiento del navegador.')
    }
    setNotice('')
    setSession({ ...nextSession, user: { ...nextSession.user, ...data.user } })
  }

  const request = useCallback((path, options = {}) => api(path, {
    ...options,
    token: session?.token,
    onUnauthorized: () => logout('La sesión ya no es válida. Inicie sesión nuevamente.'),
  }), [session, logout])

  return <AuthContext.Provider value={{ session, notice, login, logout, request }}>{children}</AuthContext.Provider>
}
