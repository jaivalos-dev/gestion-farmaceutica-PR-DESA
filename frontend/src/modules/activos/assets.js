import { hasPermission } from '../../auth/permissions.js'

export const assetStates = ['ACTIVO', 'MANTENIMIENTO', 'BAJA']
export const assetTextFields = [['categoria', 'Categoría', 60], ['descripcion', 'Descripción', 150], ['responsable', 'Responsable', 100]]

function positiveId(value) {
  if (!/^[1-9]\d{0,9}$/.test(String(value ?? ''))) throw new Error('ID debe ser un entero positivo de hasta 10 dígitos.')
  return Number(value)
}

export function assetPath(filters) {
  const query = new URLSearchParams()
  if (filters.id_sucursal !== undefined && filters.id_sucursal !== '') query.set('id_sucursal', positiveId(filters.id_sucursal))
  return `/api/activos${query.size ? `?${query}` : ''}`
}

export function assetPayload(values, user) {
  if (!hasPermission(user, 'activos.write')) throw new Error('No tiene permiso para modificar activos.')
  const id_sucursal = positiveId(values.id_sucursal)
  if (!assetStates.includes(values.estado)) throw new Error('Seleccione un estado válido.')
  const text = typeof values.valor === 'number' ? String(values.valor) : typeof values.valor === 'string' ? values.valor.trim() : ''
  const valor = Number(text)
  if (!/^\d+(?:\.\d{1,2})?$/.test(text) || !Number.isFinite(valor) || valor < 0 || valor > 9999999999.99) {
    throw new Error('Valor debe ser no negativo, con hasta dos decimales y máximo 9999999999.99.')
  }
  const payload = { id_sucursal, valor, estado: values.estado }
  for (const [field, label, limit] of assetTextFields) {
    const value = values[field]
    if (field === 'responsable' && (value == null || (typeof value === 'string' && !value.trim()))) {
      payload[field] = null
      continue
    }
    if (typeof value !== 'string' || !value.trim() || new TextEncoder().encode(value.trim()).length > limit) throw new Error(`${label} requiere texto de hasta ${limit} bytes UTF-8.`)
    payload[field] = value.trim()
  }
  return payload
}

export function assetFormValues(row) {
  return { id_sucursal: String(row.id_sucursal), categoria: row.categoria, descripcion: row.descripcion, valor: String(row.valor), estado: row.estado, responsable: row.responsable ?? '' }
}

export function createAssetsApi(request) {
  let saving = false
  async function list(filters, signal) {
    const rows = await request(assetPath(filters), { signal })
    if (!Array.isArray(rows)) throw new Error('El servidor devolvió un listado no válido.')
    return rows
  }
  async function read(id) {
    return request(`/api/activos/${positiveId(id)}`)
  }
  async function save(id, values, user, filters) {
    if (saving) return null
    saving = true
    try {
      const body = assetPayload(values, user)
      const record = await request(id === null ? '/api/activos' : `/api/activos/${positiveId(id)}`, { method: id === null ? 'POST' : 'PUT', body })
      try { return { record, rows: await list(filters), refreshError: null } } catch (refreshError) {
        return { record, rows: [], refreshError }
      }
    } finally { saving = false }
  }
  return { list, read, save }
}
