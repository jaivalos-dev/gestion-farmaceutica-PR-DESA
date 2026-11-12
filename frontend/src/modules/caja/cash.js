import { hasPermission, hasRole } from '../../auth/permissions.js'

export const cashTypes = ['INGRESO', 'EGRESO']

export function cashPath(filters, user) {
  if (!hasPermission(user, 'caja.read')) throw new Error('No tiene permiso para consultar caja.')
  const scoped = hasRole(user, ['ENCARGADO'])
  if (scoped && !user.id_sucursal) throw new Error('Su usuario requiere una sucursal asignada.')
  const query = new URLSearchParams()
  if (filters.id_sucursal !== undefined && filters.id_sucursal !== '') {
    if (!/^[1-9]\d{0,9}$/.test(String(filters.id_sucursal))) throw new Error('Sucursal debe ser un entero positivo de hasta 10 dígitos.')
    const branch = Number(filters.id_sucursal)
    if (scoped && branch !== user.id_sucursal) throw new Error('Solo puede consultar su sucursal asignada.')
    query.set('id_sucursal', branch)
  }
  return `/api/caja/movimientos${query.size ? `?${query}` : ''}`
}

export function cashPayload(values, user) {
  if (!hasPermission(user, 'caja.create')) throw new Error('No tiene permiso para registrar movimientos de caja.')
  if (!user.id_sucursal) throw new Error('Su usuario requiere una sucursal asignada.')
  if (!cashTypes.includes(values.tipo)) throw new Error('Seleccione INGRESO o EGRESO.')
  const amount = typeof values.monto === 'number' ? String(values.monto) : typeof values.monto === 'string' ? values.monto.trim() : ''
  const monto = Number(amount)
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount) || !Number.isFinite(monto) || monto <= 0 || monto > 9999999999.99) {
    throw new Error('Monto debe ser positivo, con hasta dos decimales y máximo 9999999999.99.')
  }
  const concepto = typeof values.concepto === 'string' ? values.concepto.trim() : ''
  if (!concepto || new TextEncoder().encode(concepto).length > 200) throw new Error('Concepto es obligatorio y admite hasta 200 bytes UTF-8.')
  return { tipo: values.tipo, monto, concepto }
}

export function createCashApi(request) {
  let saving = false
  async function list(filters, user, signal) {
    const rows = await request(cashPath(filters, user), { signal })
    if (!Array.isArray(rows)) throw new Error('El servidor devolvió un listado no válido.')
    return rows
  }
  async function create(values, user, filters) {
    if (saving) return null
    saving = true
    try {
      const movement = await request('/api/caja/movimientos', { method: 'POST', body: cashPayload(values, user) })
      // La escritura ya terminó: un fallo de consulta no debe invitar a repetirla.
      try { return { movement, rows: await list(filters, user), refreshError: null } } catch (refreshError) {
        return { movement, rows: [], refreshError }
      }
    } finally { saving = false }
  }
  return { list, create }
}
