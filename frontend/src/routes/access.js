import { hasPermission, hasRole } from '../auth/permissions.js'

export function getAccessRedirect(session, { roles, permission } = {}) {
  if (!session) return '/login'
  if (roles !== undefined && !hasRole(session.user, roles)) return '/403'
  if (permission !== undefined && !hasPermission(session.user, permission)) return '/403'
  return null
}
