import test from 'node:test'
import assert from 'node:assert/strict'
import { cashPath, cashPayload, createCashApi } from '../src/modules/caja/cash.js'
import { hasPermission } from '../src/auth/permissions.js'
import { getAccessRedirect } from '../src/routes/access.js'

const user = { nombre_rol: 'ENCARGADO', id_sucursal: 1 }
const auditor = { nombre_rol: 'AUDITOR', id_sucursal: null }
const form = { tipo: 'EGRESO', monto: '125.50', concepto: '  Mensajería  ' }
const movement = { id_mov_caja: 5, id_sucursal: 1, id_usuario: 42, id_venta: null, tipo: 'EGRESO', monto: 125.5, concepto: 'Mensajería', fecha: '2026-11-04T12:00:00' }

test('caja: lectura y creación respetan matriz central sin acceso universal', () => {
  for (const nombre_rol of ['ENCARGADO', 'AUDITOR', 'ADMINISTRADOR', 'DESPACHO']) {
    const current = { ...user, nombre_rol }
    const read = ['ENCARGADO', 'AUDITOR'].includes(nombre_rol)
    assert.equal(hasPermission(current, 'caja.read'), read)
    assert.equal(hasPermission(current, 'caja.create'), nombre_rol === 'ENCARGADO')
    assert.equal(getAccessRedirect({ user: current }, { permission: 'caja.read' }), read ? null : '/403')
    if (!read) assert.throws(() => cashPath({}, current))
    if (nombre_rol !== 'ENCARGADO') assert.throws(() => cashPayload(form, current))
  }
  assert.equal(getAccessRedirect(null, { permission: 'caja.read' }), '/login')
})

test('auditor consulta globalmente o filtra por ID de sucursal', () => {
  assert.equal(cashPath({}, auditor), '/api/caja/movimientos')
  assert.equal(cashPath({ id_sucursal: '' }, auditor), '/api/caja/movimientos')
  assert.equal(cashPath({ id_sucursal: '2' }, auditor), '/api/caja/movimientos?id_sucursal=2')
  for (const id_sucursal of ['0', '-1', '1.5', '1e2', '10000000000']) assert.throws(() => cashPath({ id_sucursal }, auditor))
})

test('encargado requiere sucursal y no puede consultar una ajena', () => {
  assert.equal(cashPath({}, user), '/api/caja/movimientos')
  assert.equal(cashPath({ id_sucursal: '1' }, user), '/api/caja/movimientos?id_sucursal=1')
  assert.throws(() => cashPath({ id_sucursal: '2' }, user))
  const unassigned = { ...user, id_sucursal: null }
  assert.throws(() => cashPath({}, unassigned))
  assert.throws(() => cashPayload(form, unassigned))
})

test('registro envía solo tipo, monto numérico y concepto recortado', () => {
  for (const tipo of ['INGRESO', 'EGRESO']) assert.deepEqual(cashPayload({ ...form, tipo, id_venta: 9, id_sucursal: 2, id_usuario: 7, fecha: 'otra' }, user), { tipo, monto: 125.5, concepto: 'Mensajería' })
})

test('monto conserva límites válidos sin redondear', () => {
  for (const monto of ['0.01', '0.29', '9999999999.99', '125.50']) assert.equal(cashPayload({ ...form, monto }, user).monto, Number(monto))
  for (const monto of ['', ' ', '0', '-1', '0.001', '125.501', '10000000000', 'Infinity', 'NaN', '1,50', null, true, 0.1 + 0.2]) assert.throws(() => cashPayload({ ...form, monto }, user), String(monto))
})

test('tipo y concepto obligatorios con límite UTF-8 del backend', () => {
  for (const tipo of ['', 'VENTA', 'ingreso', null]) assert.throws(() => cashPayload({ ...form, tipo }, user))
  for (const concepto of ['', ' ', null, 123, 'a'.repeat(201), 'á'.repeat(101)]) assert.throws(() => cashPayload({ ...form, concepto }, user))
  assert.equal(cashPayload({ ...form, concepto: 'á'.repeat(100) }, user).concepto.length, 100)
})

test('GET mantiene movimientos de ventas sin generar escrituras', async () => {
  const saleMovement = { ...movement, id_venta: 8, tipo: 'INGRESO', concepto: 'Venta 8' }
  const calls = []
  const api = createCashApi(async (path, options) => { calls.push([path, options]); return [saleMovement, movement] })
  const controller = new AbortController()
  assert.deepEqual(await api.list({ id_sucursal: '1' }, user, controller.signal), [saleMovement, movement])
  assert.deepEqual(calls, [['/api/caja/movimientos?id_sucursal=1', { signal: controller.signal }]])
})

test('GET maneja vacío, respuesta inválida y error API', async () => {
  assert.deepEqual(await createCashApi(async () => []).list({}, auditor), [])
  await assert.rejects(createCashApi(async () => ({})).list({}, auditor))
  const failure = Object.assign(new Error('Sin acceso'), { code: 'FORBIDDEN_BRANCH', status: 403 })
  await assert.rejects(createCashApi(async () => { throw failure }).list({}, user), error => error === failure)
})

test('POST usa contrato exacto y recarga con filtro vigente', async () => {
  const calls = []
  const api = createCashApi(async (path, options) => { calls.push([path, options]); return options?.method === 'POST' ? movement : [movement] })
  const result = await api.create(form, user, { id_sucursal: '1' })
  assert.deepEqual(calls[0], ['/api/caja/movimientos', { method: 'POST', body: { tipo: 'EGRESO', monto: 125.5, concepto: 'Mensajería' } }])
  assert.equal(calls[1][0], '/api/caja/movimientos?id_sucursal=1')
  assert.equal(result.movement, movement)
  assert.deepEqual(result.rows, [movement])
})

test('doble envío registra un solo movimiento', async () => {
  let release
  let posts = 0
  const api = createCashApi(async (path, options) => {
    if (options?.method !== 'POST') return [movement]
    posts++
    return new Promise(resolve => { release = resolve })
  })
  const first = api.create(form, user, {})
  assert.equal(await api.create(form, user, {}), null)
  assert.equal(posts, 1)
  release(movement)
  await first
})

test('error al guardar conserva código y permite reintento', async () => {
  let posts = 0
  const failure = Object.assign(new Error('Sucursal inactiva'), { code: 'SUCURSAL_INACTIVE' })
  const api = createCashApi(async (path, options) => {
    if (options?.method !== 'POST') return []
    if (++posts === 1) throw failure
    return movement
  })
  await assert.rejects(api.create(form, user, {}), error => error === failure)
  assert.equal((await api.create(form, user, {})).movement, movement)
})

test('recarga fallida conserva éxito y no repite escritura', async () => {
  let posts = 0
  const api = createCashApi(async (path, options) => {
    if (options?.method === 'POST') { posts++; return movement }
    throw new Error('Sin conexión')
  })
  const result = await api.create(form, user, {})
  assert.equal(result.movement, movement)
  assert.match(result.refreshError.message, /Sin conexión/)
  assert.equal(posts, 1)
})

test('rechaza operaciones no autorizadas y valores inválidos antes del request', async () => {
  let calls = 0
  const api = createCashApi(async () => { calls++; return [] })
  await assert.rejects(api.create(form, auditor, {}))
  await assert.rejects(api.create({ ...form, monto: '0' }, user, {}))
  await assert.rejects(api.list({ id_sucursal: '2' }, user))
  assert.equal(calls, 0)
})
