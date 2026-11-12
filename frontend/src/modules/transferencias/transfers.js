import { hasPermission } from '../../auth/permissions.js'

export const transferStates = ['SOLICITADA', 'PREPARADA', 'DESPACHADA', 'RECIBIDA', 'CANCELADA']
export const actionLabels = { preparar: 'Preparar', despachar: 'Despachar', recibir: 'Recibir', cancelar: 'Cancelar transferencia' }
const rules = {
  preparar: { from: ['SOLICITADA'], branch: 'id_sucursal_origen' },
  despachar: { from: ['PREPARADA'], branch: 'id_sucursal_origen' },
  recibir: { from: ['DESPACHADA'], branch: 'id_sucursal_destino' },
  cancelar: { from: ['SOLICITADA', 'PREPARADA'], branch: 'id_sucursal_origen' },
}

function positiveInteger(value, label) {
  if (!/^[1-9]\d{0,9}$/.test(String(value ?? '').trim())) throw new Error(`${label} debe ser un entero positivo de hasta 10 dígitos.`)
  return Number(value)
}

export function availableActions(row, user) {
  if (!hasPermission(user, 'transferencias.act') || !user.id_sucursal) return []
  return Object.keys(rules).filter(action => rules[action].from.includes(row.estado) && row[rules[action].branch] === user.id_sucursal)
}

export function transferPath(filters) {
  const query = new URLSearchParams()
  if (filters.estado) {
    if (!transferStates.includes(filters.estado)) throw new Error('Estado de transferencia inválido.')
    query.set('estado', filters.estado)
  }
  for (const field of ['id_sucursal_origen', 'id_sucursal_destino']) {
    if (filters[field] !== undefined && filters[field] !== '') query.set(field, positiveInteger(filters[field], 'Sucursal'))
  }
  return `/api/transferencias${query.size ? `?${query}` : ''}`
}

export function transferPayload(values, user, { branches, medicines }) {
  if (!hasPermission(user, 'transferencias.act')) throw new Error('No tiene permiso para crear transferencias.')
  const id_sucursal_origen = positiveInteger(values.id_sucursal_origen, 'Sucursal origen')
  const id_sucursal_destino = positiveInteger(values.id_sucursal_destino, 'Sucursal destino')
  if (id_sucursal_origen !== user.id_sucursal) throw new Error('El origen debe ser su sucursal asignada.')
  if (id_sucursal_origen === id_sucursal_destino) throw new Error('Origen y destino deben ser distintos.')
  for (const id of [id_sucursal_origen, id_sucursal_destino]) {
    if (!branches.some(branch => branch.id_sucursal === id && branch.activa === 'S')) throw new Error('Seleccione sucursales existentes y activas.')
  }
  if (!Array.isArray(values.detalles) || !values.detalles.length) throw new Error('Agregue al menos un medicamento.')
  const selected = new Set()
  const detalles = values.detalles.map(detail => {
    const id_medicamento = positiveInteger(detail.id_medicamento, 'Medicamento')
    const cantidad = positiveInteger(detail.cantidad, 'Cantidad')
    if (selected.has(id_medicamento)) throw new Error('Use una sola fila por medicamento y ajuste su cantidad.')
    selected.add(id_medicamento)
    if (!medicines.some(medicine => medicine.id_medicamento === id_medicamento && medicine.activo === 'S')) throw new Error('Seleccione medicamentos existentes y activos.')
    return { id_medicamento, cantidad }
  })
  const observacion = String(values.observacion ?? '').trim()
  if (new TextEncoder().encode(observacion).length > 250) throw new Error('Observación admite hasta 250 bytes.')
  return { id_sucursal_origen, id_sucursal_destino, observacion: observacion || null, detalles }
}

export function createTransfersApi(request) {
  let saving = false
  async function list(filters, signal) {
    const rows = await request(transferPath(filters), { signal })
    if (!Array.isArray(rows)) throw new Error('El servidor devolvió un listado no válido.')
    return rows
  }
  async function write(operation, filters) {
    if (saving) return null
    saving = true
    try {
      const record = await operation()
      try { return { record, rows: await list(filters), refreshError: null } } catch (refreshError) {
        return { record, rows: [], refreshError }
      }
    } finally { saving = false }
  }
  function create(values, user, catalogs, filters) {
    return write(() => request('/api/transferencias', { method: 'POST', body: transferPayload(values, user, catalogs) }), filters)
  }
  function transition(row, action, user, filters) {
    return write(() => {
      if (!availableActions(row, user).includes(action)) throw new Error('Acción no permitida para el estado o su sucursal. Vuelva a consultar.')
      return request(`/api/transferencias/${positiveInteger(row.id_transferencia, 'Transferencia')}/${action}`, { method: 'POST' })
    }, filters)
  }
  return { list, create, transition }
}
