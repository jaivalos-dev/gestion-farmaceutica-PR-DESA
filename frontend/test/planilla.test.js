import test from 'node:test'
import assert from 'node:assert/strict'
import { payrollPath, payrollPayload, createPayrollApi } from '../src/modules/planilla/payroll.js'
import { hasPermission } from '../src/auth/permissions.js'
import { getAccessRedirect } from '../src/routes/access.js'

const admin = { nombre_rol: 'ADMINISTRADOR' }
const form = { id_sucursal: '2', periodo: '2026-11', concepto: ' Planilla mensual ', monto: '125.50' }
const row = { id_gasto: 7, id_sucursal: 2, sucursal: 'Centro', id_usuario: 1, usuario: 'Ana', periodo: '2026-11', concepto: 'Planilla mensual', monto: 125.5, fecha_registro: '2026-11-04T10:00:00' }
const summary = { total: 250, cantidad_registros: 2 }

test('planilla: permisos y acceso directo por rol', () => {
  for (const nombre_rol of ['ADMINISTRADOR', 'AUDITOR', 'ENCARGADO', 'DESPACHO']) {
    const user = { nombre_rol }
    const read = ['ADMINISTRADOR', 'AUDITOR'].includes(nombre_rol)
    assert.equal(hasPermission(user, 'planilla.read'), read)
    assert.equal(hasPermission(user, 'planilla.write'), nombre_rol === 'ADMINISTRADOR')
    assert.equal(getAccessRedirect({ user }, { permission: 'planilla.read' }), read ? null : '/403')
    if (nombre_rol !== 'ADMINISTRADOR') assert.throws(() => payrollPayload(form, user))
  }
  assert.equal(getAccessRedirect(null, { permission: 'planilla.read' }), '/login')
})

test('filtros exactos: concepto solo se envía al listado', () => {
  assert.equal(payrollPath({}), '/api/planilla/gastos')
  assert.equal(payrollPath({}, true), '/api/planilla/resumen')
  const filters = { id_sucursal: '2', periodo: '2026-11', concepto: ' bono ' }
  assert.equal(payrollPath(filters), '/api/planilla/gastos?id_sucursal=2&periodo=2026-11&concepto=bono')
  assert.equal(payrollPath(filters, true), '/api/planilla/resumen?id_sucursal=2&periodo=2026-11')
  assert.equal(payrollPath({ id_sucursal: '', periodo: '', concepto: '' }), '/api/planilla/gastos')
})

test('payload exacto con números, texto recortado y sin actor ni fecha', () => {
  assert.deepEqual(payrollPayload({ ...form, id_usuario: 99, fecha_registro: 'otra' }, admin), { id_sucursal: 2, periodo: '2026-11', concepto: 'Planilla mensual', monto: 125.5 })
})

test('período YYYY-MM estricto sin espacios y sucursal positiva', () => {
  for (const periodo of ['', '2026-1', '2026-00', '2026-13', '26-11', '2026-11 ', '2026-11\n', null]) assert.throws(() => payrollPayload({ ...form, periodo }, admin))
  for (const periodo of ['2026-01', '2026-12', '0000-01']) assert.equal(payrollPayload({ ...form, periodo }, admin).periodo, periodo)
  for (const id_sucursal of ['', '0', '-1', '1.5', '10000000000']) assert.throws(() => payrollPayload({ ...form, id_sucursal }, admin))
  assert.throws(() => payrollPath({ periodo: '2026-13' }))
  assert.throws(() => payrollPath({ id_sucursal: '-1' }, true))
})

test('monto positivo de hasta dos decimales y concepto de 120 bytes', () => {
  for (const monto of ['0', '-1', '', '0.001', '10000000000', 'Infinity', null, true]) assert.throws(() => payrollPayload({ ...form, monto }, admin))
  for (const monto of ['0.01', '0.29', '9999999999.99']) assert.equal(payrollPayload({ ...form, monto }, admin).monto, Number(monto))
  for (const concepto of ['', ' ', null, 'á'.repeat(61)]) assert.throws(() => payrollPayload({ ...form, concepto }, admin))
  assert.equal(payrollPayload({ ...form, concepto: 'á'.repeat(60) }, admin).concepto.length, 60)
})

test('carga usa GET listado y resumen con contratos separados sin sumar en frontend', async () => {
  const calls = []
  const api = createPayrollApi(async (path, options) => { calls.push([path, options]); return path.includes('/resumen') ? summary : [row] })
  const controller = new AbortController()
  const result = await api.load({ concepto: 'mensual' }, controller.signal)
  assert.deepEqual(result.rows, [row])
  assert.equal(result.summary, summary)
  assert.deepEqual(calls, [['/api/planilla/gastos?concepto=mensual', { signal: controller.signal }], ['/api/planilla/resumen', { signal: controller.signal }]])
})

test('vacío y resumen cero son resultados válidos', async () => {
  const result = await createPayrollApi(async path => path.endsWith('/resumen') ? { total: 0, cantidad_registros: 0 } : []).load({})
  assert.deepEqual(result.rows, [])
  assert.deepEqual(result.summary, { total: 0, cantidad_registros: 0 })
})

test('errores parciales de listado y resumen conservan el resultado disponible', async () => {
  const failure = Object.assign(new Error('Sin acceso'), { code: 'FORBIDDEN' })
  for (const failSummary of [true, false]) {
    const result = await createPayrollApi(async path => {
      if (path.includes('/resumen') === failSummary) throw failure
      return failSummary ? [row] : summary
    }).load({})
    assert.equal(failSummary ? result.summaryError : result.listError, failure)
    assert.deepEqual(failSummary ? result.rows : result.summary, failSummary ? [row] : summary)
  }
})

test('respuestas inválidas no se presentan como listado vacío o resumen cero', async () => {
  const result = await createPayrollApi(async () => ({})).load({})
  assert.ok(result.listError)
  assert.ok(result.summaryError)
})

test('crear usa POST exacto y recarga ambas consultas con filtros', async () => {
  const calls = []
  const api = createPayrollApi(async (path, options) => {
    calls.push([path, options])
    return options?.method === 'POST' ? row : path.includes('/resumen') ? summary : [row]
  })
  const result = await api.create(form, admin, { periodo: '2026-11' })
  assert.deepEqual(calls[0], ['/api/planilla/gastos', { method: 'POST', body: payrollPayload(form, admin) }])
  assert.deepEqual(calls.slice(1).map(([path]) => path), ['/api/planilla/gastos?periodo=2026-11', '/api/planilla/resumen?periodo=2026-11'])
  assert.equal(result.record, row)
})

test('doble envío registra un solo gasto', async () => {
  let release
  let posts = 0
  const api = createPayrollApi(async (path, options) => {
    if (options?.method === 'POST') { posts++; return new Promise(resolve => { release = resolve }) }
    return path.includes('/resumen') ? summary : [row]
  })
  const first = api.create(form, admin, {})
  assert.equal(await api.create(form, admin, {}), null)
  assert.equal(posts, 1)
  release(row)
  await first
})

test('error POST libera bloqueo y error GET posterior conserva éxito', async () => {
  let failPost = true
  const error = Object.assign(new Error('Sucursal inactiva'), { code: 'SUCURSAL_INACTIVE' })
  const api = createPayrollApi(async (path, options) => {
    if (options?.method === 'POST') { if (failPost) throw error; return row }
    throw new Error('Sin conexión')
  })
  await assert.rejects(api.create(form, admin, {}), failure => failure === error)
  failPost = false
  const result = await api.create(form, admin, {})
  assert.equal(result.record, row)
  assert.match(result.listError.message, /Sin conexión/)
  assert.match(result.summaryError.message, /Sin conexión/)
})
