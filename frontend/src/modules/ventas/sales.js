import { hasPermission } from '../../auth/permissions.js'

export const paymentMethods = ['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'OTRO']

function positiveInteger(value, label) {
  if (!/^[1-9]\d{0,9}$/.test(String(value ?? '').trim())) throw new Error(`${label} debe ser un entero positivo de hasta 10 dígitos.`)
  return Number(value)
}

export function canConfirm(row, user) {
  return hasPermission(user, 'ventas.act') && Boolean(user.id_sucursal) && row.id_sucursal === user.id_sucursal && row.estado === 'CREADA'
}

export function salePayload(values, user, medicines) {
  if (!hasPermission(user, 'ventas.act') || !user.id_sucursal) throw new Error('Requiere permiso de ventas y una sucursal asignada.')
  if (!paymentMethods.includes(values.forma_pago)) throw new Error('Seleccione una forma de pago válida.')
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
  return { forma_pago: values.forma_pago, detalles }
}

export function createSalesApi(request) {
  let saving = false
  async function list(signal) {
    const rows = await request('/api/ventas', { signal })
    if (!Array.isArray(rows)) throw new Error('El servidor devolvió un listado no válido.')
    return rows
  }
  async function read(id) {
    const record = await request(`/api/ventas/${positiveInteger(id, 'Venta')}`)
    if (!Array.isArray(record?.detalles)) throw new Error('Detalle de venta no válido.')
    return record
  }
  async function write(operation) {
    if (saving) return null
    saving = true
    try {
      const record = await operation()
      const [listing, reading] = await Promise.allSettled([list(), read(record.id_venta)])
      return {
        record, rows: listing.status === 'fulfilled' ? listing.value : [],
        listError: listing.status === 'rejected' ? listing.reason : null,
        detail: reading.status === 'fulfilled' ? reading.value : null,
        detailError: reading.status === 'rejected' ? reading.reason : null,
      }
    } finally { saving = false }
  }
  return {
    list, read,
    create: (values, user, medicines) => write(() => request('/api/ventas', { method: 'POST', body: salePayload(values, user, medicines) })),
    confirm: (row, user) => write(() => {
      if (!canConfirm(row, user)) throw new Error('Solo puede confirmar una venta CREADA de su sucursal.')
      return request(`/api/ventas/${positiveInteger(row.id_venta, 'Venta')}/confirmar`, { method: 'POST' })
    }),
  }
}
