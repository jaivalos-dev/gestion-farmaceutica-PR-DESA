import test from 'node:test'
import assert from 'node:assert/strict'
import { deliveryPath, deliveryPayload, allowedDeliveryStates, createDeliveriesApi } from '../src/modules/entregas/deliveries.js'
import { getAccessRedirect } from '../src/routes/access.js'
import { hasPermission } from '../src/auth/permissions.js'

const user = { nombre_rol: 'ENCARGADO', id_sucursal: 1 }
const dispatch = { nombre_rol: 'DESPACHO', id_sucursal: null }
const form = { id_venta: '3', nombre_cliente: ' Ana ', telefono: '123', direccion: ' Calle 1 ', departamento: 'Guatemala', municipio: 'Guatemala', observaciones: '' }
const row = { ...form, id_venta: 3, id_entrega: 7, id_sucursal: 1, estado: 'CREADA', tiempo_estimado: 30 }

test('entregas: permisos centrales y acceso directo', () => {
  for (const nombre_rol of ['ADMINISTRADOR', 'ENCARGADO', 'DESPACHO', 'AUDITOR']) {
    const current = { ...user, nombre_rol }
    assert.equal(getAccessRedirect({ user: current }, { permission: 'entregas.read' }), nombre_rol === 'AUDITOR' ? '/403' : null)
    assert.equal(hasPermission(current, 'entregas.create'), nombre_rol === 'ENCARGADO')
    if (nombre_rol !== 'ENCARGADO') assert.throws(() => deliveryPayload(form, current))
  }
  assert.equal(getAccessRedirect(null, { permission: 'entregas.read' }), '/login')
})

test('transiciones exactas por estado y rol; terminales sin acciones', () => {
  for (const [estado, manager, courier] of [
    ['CREADA', ['ASIGNADA', 'CANCELADA'], []], ['ASIGNADA', ['PREPARADA', 'CANCELADA'], []],
    ['PREPARADA', ['CANCELADA'], ['EN_RUTA']], ['EN_RUTA', [], ['ENTREGADA']],
    ['ENTREGADA', [], []], ['CANCELADA', [], []], ['OTRO', [], []],
  ]) {
    assert.deepEqual(allowedDeliveryStates({ ...row, estado }, user), manager)
    assert.deepEqual(allowedDeliveryStates({ ...row, estado }, dispatch), courier)
    assert.deepEqual(allowedDeliveryStates({ ...row, estado }, { nombre_rol: 'ADMINISTRADOR' }), [])
    assert.deepEqual(allowedDeliveryStates({ ...row, estado }, { ...user, id_sucursal: 2 }), [])
  }
})

test('filtros reales y restricción de sucursal solo para ENCARGADO', () => {
  const filters = { id_sucursal: '1', id_venta: '3', estado: 'CREADA', departamento: ' Guatemala ', municipio: 'Mixco' }
  assert.equal(deliveryPath(filters, user), '/api/entregas?id_sucursal=1&id_venta=3&estado=CREADA&departamento=Guatemala&municipio=Mixco')
  assert.equal(deliveryPath({}, dispatch), '/api/entregas')
  assert.equal(deliveryPath({ id_sucursal: '2' }, dispatch), '/api/entregas?id_sucursal=2')
  assert.throws(() => deliveryPath({ id_sucursal: '2' }, user))
  assert.throws(() => deliveryPath({}, { ...user, id_sucursal: null }))
  assert.throws(() => deliveryPath({ estado: 'OTRO' }, user))
  assert.throws(() => deliveryPath({ id_venta: '0' }, user))
})

test('alta envía solo venta, datos cliente/destino y observaciones', () => {
  assert.deepEqual(deliveryPayload({ ...form, estado: 'ENTREGADA', id_sucursal: 9, tiempo_estimado: 5 }, user), {
    id_venta: 3, nombre_cliente: 'Ana', telefono: '123', direccion: 'Calle 1', departamento: 'Guatemala', municipio: 'Guatemala', observaciones: null,
  })
})

test('valida campos requeridos, límites UTF-8 y observaciones opcionales', () => {
  for (const [field, limit] of [['nombre_cliente', 100], ['telefono', 20], ['direccion', 200], ['departamento', 50], ['municipio', 50]]) {
    assert.throws(() => deliveryPayload({ ...form, [field]: '' }, user))
    assert.throws(() => deliveryPayload({ ...form, [field]: 'á'.repeat(limit / 2 + 1) }, user))
  }
  assert.throws(() => deliveryPayload({ ...form, observaciones: 'á'.repeat(126) }, user))
  assert.throws(() => deliveryPayload({ ...form, id_venta: '1.5' }, user))
  assert.throws(() => deliveryPayload(form, { ...user, id_sucursal: null }))
  assert.equal(deliveryPayload({ ...form, observaciones: ' nota ' }, user).observaciones, 'nota')
})

test('listado y detalle usan GET; vacío y respuesta inválida', async () => {
  const api = createDeliveriesApi(async path => path === '/api/entregas/7' ? row : [row])
  assert.deepEqual(await api.list({}, user), [row])
  assert.equal(await api.read(7), row)
  assert.deepEqual(await createDeliveriesApi(async () => []).list({}, user), [])
  await assert.rejects(createDeliveriesApi(async () => ({})).list({}, user))
})

test('crear y cambiar estado usan POST y PUT exactos y recargan listado', async () => {
  const calls = []
  const api = createDeliveriesApi(async (path, options) => { calls.push([path, options]); return options?.method ? row : [row] })
  await api.create(form, user, {})
  assert.deepEqual(calls[0], ['/api/entregas', { method: 'POST', body: deliveryPayload(form, user) }])
  calls.length = 0
  await api.transition(row, 'ASIGNADA', user, {})
  assert.deepEqual(calls[0], ['/api/entregas/7/estado', { method: 'PUT', body: { estado: 'ASIGNADA' } }])
  assert.equal(calls[1][0], '/api/entregas')
  await assert.rejects(api.transition(row, 'ENTREGADA', user, {}))
  assert.equal(calls.length, 2)
})

test('error real de venta y recuperación sin perder código API', async () => {
  let fail = true
  const error = Object.assign(new Error('La venta ya tiene una entrega'), { code: 'DELIVERY_ALREADY_EXISTS' })
  const api = createDeliveriesApi(async (path, options) => {
    if (!options?.method) return [row]
    if (fail) throw error
    return row
  })
  await assert.rejects(api.create(form, user, {}), failure => failure === error)
  fail = false
  assert.equal((await api.create(form, user, {})).record, row)
})

test('bloqueo compartido evita doble envío de creación y transición', async () => {
  let release
  let writes = 0
  const api = createDeliveriesApi(async (path, options) => {
    if (!options?.method) return []
    writes++
    return new Promise(resolve => { release = resolve })
  })
  const first = api.create(form, user, {})
  assert.equal(await api.transition(row, 'ASIGNADA', user, {}), null)
  assert.equal(writes, 1)
  release(row)
  await first
})

test('recarga fallida conserva registro retornado y éxito de escritura', async () => {
  const api = createDeliveriesApi(async (path, options) => {
    if (options?.method) return { ...row, estado: 'ASIGNADA' }
    throw new Error('Sin conexión')
  })
  const result = await api.transition(row, 'ASIGNADA', user, {})
  assert.equal(result.record.estado, 'ASIGNADA')
  assert.match(result.refreshError.message, /Sin conexión/)
})
