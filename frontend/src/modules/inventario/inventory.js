function positiveInteger(value, label) {
  const text = String(value ?? '').trim()
  if (!/^[1-9]\d{0,9}$/.test(text)) throw new Error(`${label} debe ser un entero positivo de hasta 10 dígitos.`)
  return Number(text)
}

export function inventoryPath(filters) {
  const query = new URLSearchParams()
  for (const field of ['id_sucursal', 'id_medicamento']) {
    if (filters[field] !== undefined && filters[field] !== '') query.set(field, positiveInteger(filters[field], field))
  }
  return `/api/inventario${query.size ? `?${query}` : ''}`
}

export function adjustmentPayload(values) {
  const id_sucursal = positiveInteger(values.id_sucursal, 'Sucursal')
  const id_medicamento = positiveInteger(values.id_medicamento, 'Medicamento')
  const cantidad = positiveInteger(values.cantidad, 'Cantidad')
  if (!['ENTRADA', 'SALIDA', 'AJUSTE'].includes(values.tipo_movimiento)) throw new Error('Seleccione un tipo de movimiento válido.')
  const referencia = String(values.referencia ?? '').trim()
  if (!referencia || new TextEncoder().encode(referencia).length > 100) throw new Error('Referencia es obligatoria y admite hasta 100 bytes.')
  return { id_sucursal, id_medicamento, tipo_movimiento: values.tipo_movimiento, cantidad, referencia }
}

export function createInventoryApi(request) {
  let saving = false
  async function list(filters, signal) {
    const rows = await request(inventoryPath(filters), { signal })
    if (!Array.isArray(rows)) throw new Error('El servidor devolvió un listado no válido.')
    return rows
  }
  async function adjust(values, filters) {
    if (saving) return null
    saving = true
    try {
      const body = adjustmentPayload(values)
      const movement = await request('/api/inventario/ajustes', { method: 'POST', body })
      // Una recarga fallida no convierte un movimiento confirmado en una escritura fallida.
      try { return { movement, rows: await list(filters), refreshError: null } } catch (refreshError) {
        return { movement, rows: [], refreshError }
      }
    } finally {
      saving = false
    }
  }
  return { list, adjust }
}
