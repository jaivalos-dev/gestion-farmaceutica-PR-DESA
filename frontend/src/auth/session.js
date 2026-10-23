export const SESSION_KEY = 'farmacia.session'

// Contexto visual únicamente: la API verifica la firma y los permisos.
export function decodeSession(token) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
    const user = JSON.parse(new TextDecoder().decode(bytes))
    if (!Number.isFinite(user.exp) || user.exp * 1000 <= Date.now()) return null
    return { token, user }
  } catch {
    return null
  }
}
export function clearSession(storage = localStorage) {
  storage.removeItem(SESSION_KEY)
}
export function saveSession(token, storage = localStorage) {
  storage.setItem(SESSION_KEY, token)
}
export function readSession(storage = localStorage) {
  try {
    const token = storage.getItem(SESSION_KEY)
    const session = token ? decodeSession(token) : null
    if (!session) clearSession(storage)
    return session
  } catch {
    return null
  }
}
