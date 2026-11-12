import test from 'node:test'
import assert from 'node:assert/strict'
import { createDashboardApi, createDashboardQuery, dashboardPath, dashboardGroups, formatAmount, formatCount } from '../src/modules/dashboard/dashboard.js'
import { getAccessRedirect } from '../src/routes/access.js'
import { createApiClient } from '../src/api/client.js'

const user = { nombre_rol: 'ADMINISTRADOR' }
const data = { inventario: { unidades: 290, registros: 5 }, caja: { ingresos: 794.25, egresos: 58.5, saldo: 735.75 }, ventas: { cantidad_confirmadas: 5, monto_confirmado: 601.25 }, activos: { cantidad: 4, valor_total: 8950 }, planilla: { cantidad_registros: 6, total: 30384.5 }, entregas: { total: 4, pendientes: 0, entregadas: 3, canceladas: 1 } }

for (const role of ['ADMINISTRADOR', 'AUDITOR', 'ENCARGADO', 'DESPACHO']) test(`dashboard acceso ${role}`, async () => {
  const allowed = ['ADMINISTRADOR', 'AUDITOR'].includes(role)
  assert.equal(getAccessRedirect({ user: { nombre_rol: role } }, { permission: 'dashboard.read' }), allowed ? null : '/403')
  let calls = 0
  const api = createDashboardApi(async () => { calls++; return data })
  const call = api.summary('', { nombre_rol: role })
  if (allowed) assert.deepEqual(await call, data)
  else await assert.rejects(call, /permiso/)
  assert.equal(calls, allowed ? 1 : 0)
})

test('dashboard carga global, sucursal y limpieza del filtro', async () => {
  const paths = []
  const query = createDashboardQuery(createDashboardApi(async path => { paths.push(path); return data }), user)
  await query.load()
  assert.deepEqual(query.getSnapshot().data, data)
  await query.load('1')
  assert.equal(query.getSnapshot().id, '1')
  await query.load('')
  assert.equal(query.getSnapshot().id, '')
  assert.deepEqual(paths, ['/api/dashboard/resumen', '/api/dashboard/resumen?id_sucursal=1', '/api/dashboard/resumen'])
})

test('dashboard conserva todos los ceros del servidor', async () => {
  const zeros = Object.fromEntries(Object.entries(data).map(([group, fields]) => [group, Object.fromEntries(Object.keys(fields).map(key => [key, 0]))]))
  assert.deepEqual(await createDashboardApi(async () => zeros).summary('9999999999', user), zeros)
})

for (const failure of ['400', 'network', '503']) test(`dashboard error ${failure}, descarta datos y permite reintento`, async () => {
  let fail = false
  const request = createApiClient({ fetchImpl: async () => {
    if (fail && failure === 'network') throw new TypeError('fetch failed')
    return { ok: !fail, status: fail ? Number(failure) : 200, json: async () => fail ? { ok: false, code: failure === '400' ? 'INVALID_ID' : 'DATABASE_UNAVAILABLE', message: 'Consulta rechazada' } : { ok: true, data } }
  } })
  const query = createDashboardQuery(createDashboardApi(request), user)
  await query.load()
  fail = true
  await query.load('1')
  assert.equal(query.getSnapshot().data, null)
  assert.equal(query.getSnapshot().error.status, failure === 'network' ? 0 : Number(failure))
  fail = false
  await query.load(query.getSnapshot().id)
  assert.deepEqual(query.getSnapshot().data, data)
  assert.equal(query.getSnapshot().error, null)
})

test('dashboard bloquea doble consulta mientras carga', async () => {
  let resolve, calls = 0
  const query = createDashboardQuery(createDashboardApi(() => { calls++; return new Promise(done => { resolve = done }) }), user)
  const pending = query.load()
  assert.equal(query.getSnapshot().loading, true)
  await query.load('1')
  assert.equal(calls, 1)
  resolve(data)
  await pending
  assert.equal(query.getSnapshot().loading, false)
})

test('dashboard cancelación ignora respuestas antiguas y permite nueva carga', async () => {
  const resolves = []
  const query = createDashboardQuery(createDashboardApi(() => new Promise(resolve => resolves.push(resolve))), user)
  const first = query.load()
  query.cancel()
  const second = query.load('1')
  resolves[1](data)
  await second
  resolves[0]({ ...data, inventario: { unidades: 999, registros: 1 } })
  await first
  assert.equal(query.getSnapshot().id, '1')
  assert.equal(query.getSnapshot().data.inventario.unidades, 290)
})

test('dashboard valida ID y no fabrica indicadores ante respuesta incompleta', async () => {
  for (const id of ['0', '-1', 'abc', '1.5', '01', '10000000000']) assert.throws(() => dashboardPath(id), /entero positivo/)
  await assert.rejects(createDashboardApi(async () => ({})).summary('', user), /respuesta/)
})

test('dashboard formato monetario e integer y catálogo exacto', () => {
  assert.match(formatAmount(30384.5), /30,384\.50/)
  assert.match(formatAmount(0), /0\.00/)
  assert.match(formatAmount(-2.5), /2\.50/)
  assert.equal(formatCount(1234), '1,234')
  assert.equal(formatCount(0), '0')
  assert.equal(dashboardGroups.reduce((sum, group) => sum + group[2].length, 0), 15)
})
