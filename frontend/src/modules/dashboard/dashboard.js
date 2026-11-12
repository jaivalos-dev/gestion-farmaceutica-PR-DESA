import { hasPermission } from '../../auth/permissions.js'

export const dashboardGroups = [
  ['inventario', 'Inventario', [['unidades', 'Unidades'], ['registros', 'Registros']]],
  ['caja', 'Caja', [['ingresos', 'Ingresos', true], ['egresos', 'Egresos', true], ['saldo', 'Saldo', true]]],
  ['ventas', 'Ventas', [['cantidad_confirmadas', 'Cantidad confirmada'], ['monto_confirmado', 'Monto confirmado', true]]],
  ['activos', 'Activos fijos', [['cantidad', 'Cantidad'], ['valor_total', 'Valor total', true]]],
  ['planilla', 'Planilla', [['cantidad_registros', 'Cantidad de registros'], ['total', 'Total', true]]],
  ['entregas', 'Entregas', [['total', 'Total'], ['pendientes', 'Pendientes'], ['entregadas', 'Entregadas'], ['canceladas', 'Canceladas']]],
]

const money = new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' })
const integer = new Intl.NumberFormat('es-GT', { maximumFractionDigits: 0 })
export const formatAmount = value => money.format(value)
export const formatCount = value => integer.format(value)

export function dashboardPath(id = '') {
  if (id === '') return '/api/dashboard/resumen'
  if (!/^[1-9]\d{0,9}$/.test(String(id))) throw new Error('El ID de sucursal debe ser un entero positivo de hasta 10 dígitos.')
  return `/api/dashboard/resumen?id_sucursal=${id}`
}

export function createDashboardApi(request) {
  return {
    async summary(id, user, signal) {
      if (!hasPermission(user, 'dashboard.read')) throw new Error('No tiene permiso para consultar el dashboard.')
      const data = await request(dashboardPath(id), { signal })
      for (const [group, , fields] of dashboardGroups) {
        for (const [field, , amount] of fields) {
          const value = data?.[group]?.[field]
          if (typeof value !== 'number' || !Number.isFinite(value) || (!amount && !Number.isInteger(value))) {
            throw new Error('El servidor devolvió una respuesta de dashboard no válida.')
          }
        }
      }
      return data
    },
  }
}

// El bloqueo síncrono también evita dos envíos antes del siguiente render.
export function createDashboardQuery(api, user) {
  let state = { loading: true, data: null, error: null, id: '' }
  let active = null
  const listeners = new Set()
  function publish(next) { state = next; listeners.forEach(listener => listener()) }
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    cancel() { active?.abort(); active = null },
    async load(id = '') {
      if (active) return
      const controller = new AbortController()
      active = controller
      publish({ loading: true, data: null, error: null, id })
      try {
        const data = await api.summary(id, user, controller.signal)
        if (!controller.signal.aborted) publish({ loading: false, data, error: null, id })
      } catch (error) {
        if (!controller.signal.aborted) publish({ loading: false, data: null, error, id })
      } finally {
        if (active === controller) active = null
      }
    },
  }
}
