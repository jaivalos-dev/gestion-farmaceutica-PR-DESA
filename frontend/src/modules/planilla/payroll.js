import { hasPermission } from '../../auth/permissions.js'

function positiveId(value) {
  if (!/^[1-9]\d{0,9}$/.test(String(value ?? ''))) throw new Error('Sucursal debe ser un entero positivo de hasta 10 dígitos.')
  return Number(value)
}

function period(value) {
  if (typeof value !== 'string' || value.length !== 7 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('Período debe usar YYYY-MM, con mes entre 01 y 12, sin espacios.')
  return value
}

function concept(value) {
  if (typeof value !== 'string' || !value.trim() || new TextEncoder().encode(value.trim()).length > 120) throw new Error('Concepto es obligatorio y admite hasta 120 bytes UTF-8.')
  return value.trim()
}

export function payrollPath(filters, summary = false) {
  const query = new URLSearchParams()
  if (filters.id_sucursal !== undefined && filters.id_sucursal !== '') query.set('id_sucursal', positiveId(filters.id_sucursal))
  if (filters.periodo !== undefined && filters.periodo !== '') query.set('periodo', period(filters.periodo))
  if (!summary && filters.concepto !== undefined && filters.concepto !== '') query.set('concepto', concept(filters.concepto))
  return `/api/planilla/${summary ? 'resumen' : 'gastos'}${query.size ? `?${query}` : ''}`
}

export function payrollPayload(values, user) {
  if (!hasPermission(user, 'planilla.write')) throw new Error('No tiene permiso para registrar gastos de planilla.')
  const text = typeof values.monto === 'number' ? String(values.monto) : typeof values.monto === 'string' ? values.monto.trim() : ''
  const monto = Number(text)
  if (!/^\d+(?:\.\d{1,2})?$/.test(text) || !Number.isFinite(monto) || monto <= 0 || monto > 9999999999.99) throw new Error('Monto debe ser positivo, con hasta dos decimales y máximo 9999999999.99.')
  return { id_sucursal: positiveId(values.id_sucursal), periodo: period(values.periodo), concepto: concept(values.concepto), monto }
}

export function createPayrollApi(request) {
  let saving = false
  async function list(filters, signal) {
    const rows = await request(payrollPath(filters), { signal })
    if (!Array.isArray(rows)) throw new Error('El servidor devolvió un listado no válido.')
    return rows
  }
  async function summary(filters, signal) {
    const data = await request(payrollPath(filters, true), { signal })
    if (!data || typeof data.total !== 'number' || !Number.isFinite(data.total) || data.total < 0 || !Number.isInteger(data.cantidad_registros) || data.cantidad_registros < 0) throw new Error('El servidor devolvió un resumen no válido.')
    return data
  }
  async function load(filters, signal) {
    const [listing, aggregate] = await Promise.allSettled([list(filters, signal), summary(filters, signal)])
    return {
      loading: false,
      rows: listing.status === 'fulfilled' ? listing.value : [],
      listError: listing.status === 'rejected' ? listing.reason : null,
      summary: aggregate.status === 'fulfilled' ? aggregate.value : null,
      summaryError: aggregate.status === 'rejected' ? aggregate.reason : null,
    }
  }
  async function create(values, user, filters) {
    if (saving) return null
    saving = true
    try {
      const record = await request('/api/planilla/gastos', { method: 'POST', body: payrollPayload(values, user) })
      // Las consultas fallidas conservan el éxito del POST y no lo repiten.
      return { record, ...await load(filters) }
    } finally { saving = false }
  }
  return { load, create }
}
