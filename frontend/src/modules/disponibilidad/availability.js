import { hasPermission } from '../../auth/permissions.js'

export function availabilityPath(values, user) {
  if (!hasPermission(user, 'disponibilidad.read')) throw new Error('No tiene permiso para consultar disponibilidad.')
  const query = new URLSearchParams()
  for (const field of ['id_medicamento', 'cantidad']) {
    if (!/^[1-9]\d{0,9}$/.test(String(values[field] ?? ''))) throw new Error(`${field} debe ser un entero positivo de hasta 10 dígitos.`)
    query.set(field, Number(values[field]))
  }
  for (const field of ['departamento', 'municipio']) {
    const value = values[field]
    if (typeof value !== 'string' || !value.trim() || new TextEncoder().encode(value.trim()).length > 50) throw new Error(`${field} requiere texto de hasta 50 bytes UTF-8.`)
    query.set(field, value.trim())
  }
  return `/api/disponibilidad?${query}`
}

export function createAvailabilityApi(request) {
  let loading = false
  return {
    async consult(values, user, signal) {
      if (loading) return null
      loading = true
      try {
        const data = await request(availabilityPath(values, user), { signal })
        if (!data || typeof data.disponible !== 'boolean' || !Array.isArray(data.candidatos)) throw new Error('El servidor devolvió una disponibilidad no válida.')
        return data
      } finally { loading = false }
    },
  }
}
