import test from 'node:test'
import assert from 'node:assert/strict'
import { salePayload, canConfirm, createSalesApi } from '../src/modules/ventas/sales.js'
import { getAccessRedirect } from '../src/routes/access.js'
import { hasPermission } from '../src/auth/permissions.js'

const user = { nombre_rol: 'ENCARGADO', id_sucursal: 1 }
const medicines = [{ id_medicamento: 3, activo: 'S' }, { id_medicamento: 4, activo: 'N' }]
const form = { forma_pago: 'EFECTIVO', detalles: [{ id_medicamento: '3', cantidad: '2' }] }
const row = { id_venta: 7, id_sucursal: 1, id_usuario: 2, estado: 'CREADA', total: 19.5 }
const detail = { ...row, detalles: [{ id_detalle: 1, medicamento: 'Prueba', codigo: 'M1', cantidad: 2, precio_unitario: 9.75, subtotal: 19.5 }] }

test('ventas: acceso y acciones usan permisos centrales y sucursal', () => {
  assert.equal(getAccessRedirect({ user }, { permission: 'ventas.read' }), null)
  assert.equal(getAccessRedirect(null, { permission: 'ventas.read' }), '/login')
  for (const nombre_rol of ['ADMINISTRADOR', 'AUDITOR', 'DESPACHO']) {
    const other = { ...user, nombre_rol }
    assert.equal(getAccessRedirect({ user: other }, { permission: 'ventas.read' }), '/403')
    assert.equal(hasPermission(other, 'ventas.read'), false)
    assert.equal(canConfirm(row, other), false)
    assert.throws(() => salePayload(form, other, medicines))
  }
  assert.equal(canConfirm(row, user), true)
  assert.equal(canConfirm({ ...row, estado: 'CONFIRMADA' }, user), false)
  assert.equal(canConfirm({ ...row, id_sucursal: 2 }, user), false)
  assert.throws(() => salePayload(form, { ...user, id_sucursal: null }, medicines))
})

test('payload solo envía forma de pago y detalles numéricos, nunca precios ni sucursal', () => {
  for (const forma_pago of ['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'OTRO']) {
    assert.deepEqual(salePayload({ ...form, forma_pago, total: 1, id_sucursal: 99 }, user, medicines), {
      forma_pago, detalles: [{ id_medicamento: 3, cantidad: 2 }],
    })
  }
})

test('valida pago, detalles requeridos, duplicados, activos y cantidades', () => {
  for (const patch of [
    { forma_pago: '' }, { forma_pago: 'CHEQUE' }, { detalles: [] }, { detalles: null },
    { detalles: [...form.detalles, ...form.detalles] },
    ...['', '0', '-1', '1.5', '10000000000'].map(cantidad => ({ detalles: [{ id_medicamento: '3', cantidad }] })),
    ...['', '4', '99'].map(id_medicamento => ({ detalles: [{ id_medicamento, cantidad: '1' }] })),
  ]) assert.throws(() => salePayload({ ...form, ...patch }, user, medicines))
})

test('listado vacío, listado real y detalle conservan datos del servidor', async () => {
  assert.deepEqual(await createSalesApi(async () => []).list(), [])
  assert.deepEqual(await createSalesApi(async () => [row]).list(), [row])
  assert.deepEqual(await createSalesApi(async path => { assert.equal(path, '/api/ventas/7'); return detail }).read(7), detail)
  await assert.rejects(createSalesApi(async () => ({})).list())
})

test('crear y confirmar usan contratos exactos y recargan listado y detalle', async () => {
  const calls = []
  let state = 'CREADA'
  const api = createSalesApi(async (path, options) => {
    calls.push([path, options])
    if (path.endsWith('/confirmar')) { state = 'CONFIRMADA'; return { ...row, estado: state } }
    if (options?.method === 'POST') return detail
    return path === '/api/ventas' ? [{ ...row, estado: state }] : { ...detail, estado: state }
  })
  assert.equal((await api.create(form, user, medicines)).record.estado, 'CREADA')
  assert.deepEqual(calls[0], ['/api/ventas', { method: 'POST', body: salePayload(form, user, medicines) }])
  calls.length = 0
  const result = await api.confirm(row, user)
  assert.deepEqual(calls[0], ['/api/ventas/7/confirmar', { method: 'POST' }])
  assert.deepEqual(calls.map(([path]) => path), ['/api/ventas/7/confirmar', '/api/ventas', '/api/ventas/7'])
  assert.equal(result.detail.estado, 'CONFIRMADA')
  await assert.rejects(api.confirm(result.record, user))
})

test('stock insuficiente conserva error API y libera bloqueo', async () => {
  const failure = Object.assign(new Error('Existencia insuficiente'), { code: 'INSUFFICIENT_STOCK' })
  let fail = true
  const api = createSalesApi(async (path, options) => {
    if (options?.method === 'POST' && fail) throw failure
    return path === '/api/ventas' ? [] : detail
  })
  await assert.rejects(api.confirm(row, user), error => error === failure)
  fail = false
  assert.ok(await api.confirm(row, user))
})

test('bloquea doble envío entre creación y confirmación', async () => {
  let release
  let posts = 0
  const api = createSalesApi(async (path, options) => {
    if (options?.method === 'POST') { posts++; return new Promise(resolve => { release = resolve }) }
    return path === '/api/ventas' ? [row] : detail
  })
  const first = api.create(form, user, medicines)
  assert.equal(await api.create(form, user, medicines), null)
  assert.equal(await api.confirm(row, user), null)
  assert.equal(posts, 1)
  release(detail)
  await first
})

test('fallo de recarga no convierte escritura exitosa en fallo ni repite POST', async () => {
  const api = createSalesApi(async (path, options) => {
    if (options?.method === 'POST') return { ...row, estado: 'CONFIRMADA' }
    throw new Error('Sin conexión')
  })
  const result = await api.confirm(row, user)
  assert.equal(result.record.estado, 'CONFIRMADA')
  assert.match(result.listError.message, /Sin conexión/)
  assert.match(result.detailError.message, /Sin conexión/)
  assert.equal(result.detail, null)
})
