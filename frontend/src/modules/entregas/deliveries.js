import { hasPermission, hasRole } from '../../auth/permissions.js'

export const deliveryStates = ['CREADA', 'ASIGNADA', 'PREPARADA', 'EN_RUTA', 'ENTREGADA', 'CANCELADA']
export const deliveryFields = [['nombre_cliente', 'Cliente', 100], ['telefono', 'Teléfono', 20], ['direccion', 'Dirección', 200], ['departamento', 'Departamento', 50], ['municipio', 'Municipio', 50]]
const transitions = { CREADA: ['ASIGNADA', 'CANCELADA'], ASIGNADA: ['PREPARADA', 'CANCELADA'], PREPARADA: ['EN_RUTA', 'CANCELADA'], EN_RUTA: ['ENTREGADA'], ENTREGADA: [], CANCELADA: [] }

function id(value) {
  if (!/^[1-9]\d{0,9}$/.test(String(value ?? ''))) throw new Error('ID debe ser un entero positivo de hasta 10 dígitos.')
  return Number(value)
}

function text(value, label, limit, optional = false) {
  if (optional && value == null) return null
  if (typeof value !== 'string' || (!optional && !value.trim()) || new TextEncoder().encode(value.trim()).length > limit) throw new Error(`${label} requiere texto de hasta ${limit} bytes UTF-8.`)
  return value.trim() || null
}

export function allowedDeliveryStates(row, user) {
  if (!hasPermission(user, 'entregas.changeState')) return []
  if (hasRole(user, ['ENCARGADO']) && (!user.id_sucursal || row.id_sucursal !== user.id_sucursal)) return []
  return (transitions[row.estado] ?? []).filter(state => hasRole(user, ['EN_RUTA', 'ENTREGADA'].includes(state) ? ['DESPACHO'] : ['ENCARGADO']))
}

export function deliveryPath(filters, user) {
  if (!hasPermission(user, 'entregas.read')) throw new Error('No tiene permiso para consultar entregas.')
  const scoped = hasRole(user, ['ENCARGADO'])
  if (scoped && !user.id_sucursal) throw new Error('Su usuario requiere una sucursal asignada.')
  const query = new URLSearchParams()
  for (const field of ['id_sucursal', 'id_venta']) {
    if (filters[field] !== undefined && filters[field] !== '') {
      const value = id(filters[field])
      if (field === 'id_sucursal' && scoped && value !== user.id_sucursal) throw new Error('Solo puede consultar entregas de su sucursal.')
      query.set(field, value)
    }
  }
  if (filters.estado) {
    if (!deliveryStates.includes(filters.estado)) throw new Error('Estado de entrega inválido.')
    query.set('estado', filters.estado)
  }
  for (const field of ['departamento', 'municipio']) if (filters[field] !== undefined && filters[field] !== '') query.set(field, text(filters[field], field, 50))
  return `/api/entregas${query.size ? `?${query}` : ''}`
}

export function deliveryPayload(values, user) {
  if (!hasPermission(user, 'entregas.create') || !user.id_sucursal) throw new Error('Requiere permiso de creación y una sucursal asignada.')
  const payload = { id_venta: id(values.id_venta) }
  for (const [field, label, limit] of deliveryFields) payload[field] = text(values[field], label, limit)
  payload.observaciones = text(values.observaciones, 'Observaciones', 250, true)
  return payload
}

export function createDeliveriesApi(request) {
  let saving = false
  async function list(filters, user, signal) {
    const rows = await request(deliveryPath(filters, user), { signal })
    if (!Array.isArray(rows)) throw new Error('El servidor devolvió un listado no válido.')
    return rows
  }
  async function read(value) {
    return request(`/api/entregas/${id(value)}`)
  }
  async function write(operation, user, filters) {
    if (saving) return null
    saving = true
    try {
      const record = await operation()
      // POST y PUT devuelven la entrega completa, incluida la fecha de entrega.
      try { return { record, rows: await list(filters, user), refreshError: null } } catch (refreshError) { return { record, rows: [], refreshError } }
    } finally { saving = false }
  }
  return {
    list, read,
    create: (values, user, filters) => write(() => request('/api/entregas', { method: 'POST', body: deliveryPayload(values, user) }), user, filters),
    transition: (row, estado, user, filters) => write(() => {
      if (!allowedDeliveryStates(row, user).includes(estado)) throw new Error('Transición no permitida para su rol, sucursal o estado actual. Vuelva a consultar.')
      return request(`/api/entregas/${id(row.id_entrega)}/estado`, { method: 'PUT', body: { estado } })
    }, user, filters),
  }
}
