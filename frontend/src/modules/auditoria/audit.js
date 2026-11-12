import { hasPermission } from '../../auth/permissions.js'

export const auditCatalogs = {
  modulo: ['SUCURSALES', 'MEDICAMENTOS', 'INVENTARIO', 'TRANSFERENCIAS', 'VENTAS', 'CAJA', 'ACTIVOS', 'PLANILLA', 'ENTREGAS', 'AUTH'],
  accion: ['CREAR', 'MODIFICAR', 'ENTRADA', 'SALIDA', 'AJUSTE', 'CAMBIO_ESTADO', 'CONFIRMAR', 'REGISTRAR', 'LOGIN_OK'],
  entidad: ['SUCURSAL', 'MEDICAMENTO', 'INVENTARIO', 'TRANSFERENCIA', 'VENTA', 'MOVIMIENTO_CAJA', 'ACTIVO_FIJO', 'GASTO_PLANILLA', 'ENTREGA', 'USUARIO'],
}
export const auditFilters = [
  ['fecha_desde', 'Fecha desde', 'date'], ['fecha_hasta', 'Fecha hasta', 'date'],
  ['id_usuario', 'Usuario (ID)', 'number'], ['id_sucursal', 'Sucursal (ID)', 'number'],
  ['modulo', 'Módulo', 'select'], ['accion', 'Acción', 'select'], ['entidad', 'Tipo de registro', 'select'], ['id_entidad', 'ID del registro', 'number'],
]
export const auditColumns = [['id_auditoria', 'ID'], ['fecha_hora', 'Fecha/hora'], ['usuario', 'Usuario'], ['sucursal', 'Sucursal'], ['modulo', 'Módulo'], ['accion', 'Acción'], ['entidad', 'Tipo de registro'], ['id_entidad', 'ID del registro'], ['descripcion', 'Descripción']]
const responseFields = [...auditColumns.map(([field]) => field), 'id_usuario', 'id_sucursal']

export function auditPath(filters) {
  const query = new URLSearchParams()
  for (const [field, label, type] of auditFilters) {
    const value = filters[field]
    if (value === undefined || value === '') continue
    if (type === 'number') {
      if (!/^[1-9]\d{0,9}$/.test(String(value ?? ''))) throw new Error(`${label} debe ser un entero positivo de hasta 10 dígitos.`)
      query.set(field, Number(value))
    } else if (type === 'date') {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) throw new Error(`${label} debe ser una fecha válida YYYY-MM-DD.`)
      const date = new Date(`${value}T00:00:00.000Z`)
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`${label} debe ser una fecha válida YYYY-MM-DD.`)
      query.set(field, value)
    } else {
      if (typeof value !== 'string' || !auditCatalogs[field].includes(value.trim())) throw new Error(`${label} no pertenece al catálogo de auditoría.`)
      query.set(field, value.trim())
    }
  }
  if (query.has('fecha_desde') && query.has('fecha_hasta') && query.get('fecha_desde') > query.get('fecha_hasta')) throw new Error('Fecha desde no puede ser posterior a fecha hasta.')
  return `/api/auditoria${query.size ? `?${query}` : ''}`
}

// No serializar objetos recibidos. Ocultar texto con indicadores de credenciales
// evita exponerlos incluso si aparecen dentro de una columna o mensaje de error.
export function auditText(value) {
  if (value == null || !['string', 'number'].includes(typeof value)) return '—'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—'
  if (/password|contrase(?:ñ|n)a|passwd|token|authorization|bearer|secret|api[_ -]?key|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|\$2[aby]\$\d{2}\$/i.test(value)) return 'Contenido sensible oculto'
  return value
}

export function createAuditApi(request) {
  return {
    async list(filters, user, signal) {
      if (!hasPermission(user, 'auditoria.read')) throw new Error('No tiene permiso para consultar auditoría.')
      const rows = await request(auditPath(filters), { signal })
      if (!Array.isArray(rows)) throw new Error('El servidor devolvió un listado no válido.')
      return rows.map(row => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('El servidor devolvió un evento no válido.')
        return Object.fromEntries(responseFields.map(field => [field, row[field] ?? null]))
      })
    },
  }
}
