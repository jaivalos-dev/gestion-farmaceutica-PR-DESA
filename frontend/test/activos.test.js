import test from 'node:test'
import assert from 'node:assert/strict'
import { assetPayload, assetPath, assetFormValues, createAssetsApi } from '../src/modules/activos/assets.js'
import { hasPermission } from '../src/auth/permissions.js'
import { getAccessRedirect } from '../src/routes/access.js'

const admin = { nombre_rol: 'ADMINISTRADOR' }
const form = { id_sucursal: '2', categoria: ' Equipo ', descripcion: ' Computadora ', valor: '0', estado: 'ACTIVO', responsable: '' }
const row = { id_activo: 3, id_sucursal: 2, sucursal: 'Centro', categoria: 'Equipo', descripcion: 'Computadora', valor: 0, estado: 'ACTIVO', responsable: null, fecha_registro: '2026-11-04T10:00:00' }

test('activos: matriz central y ruta protegida para todos los roles', () => {
  for (const nombre_rol of ['ADMINISTRADOR', 'AUDITOR', 'ENCARGADO', 'DESPACHO']) {
    const user = { nombre_rol }
    const read = ['ADMINISTRADOR', 'AUDITOR'].includes(nombre_rol)
    assert.equal(hasPermission(user, 'activos.read'), read)
    assert.equal(hasPermission(user, 'activos.write'), nombre_rol === 'ADMINISTRADOR')
    assert.equal(getAccessRedirect({ user }, { permission: 'activos.read' }), read ? null : '/403')
    if (nombre_rol !== 'ADMINISTRADOR') assert.throws(() => assetPayload(form, user))
  }
  assert.equal(getAccessRedirect(null, { permission: 'activos.read' }), '/login')
})

test('formulario produce los seis campos exactos y responsable opcional', () => {
  assert.deepEqual(assetPayload({ ...form, id_activo: 3, sucursal: 'Otro', fecha_registro: 'otra' }, admin), {
    id_sucursal: 2, categoria: 'Equipo', descripcion: 'Computadora', valor: 0, estado: 'ACTIVO', responsable: null,
  })
  assert.equal(assetPayload({ ...form, responsable: ' Ana ' }, admin).responsable, 'Ana')
  assert.equal(assetPayload({ ...form, responsable: null }, admin).responsable, null)
})

test('valor cero permitido, negativo y precisión inválida rechazados sin redondeo', () => {
  for (const valor of ['0', '0.00', '0.29', '9999999999.99']) assert.equal(assetPayload({ ...form, valor }, admin).valor, Number(valor))
  for (const valor of ['', ' ', '-1', '0.001', '10000000000', 'NaN', 'Infinity', null, true, 0.1 + 0.2]) assert.throws(() => assetPayload({ ...form, valor }, admin))
})

test('estados exactos y textos con límites UTF-8', () => {
  for (const estado of ['ACTIVO', 'MANTENIMIENTO', 'BAJA']) assert.equal(assetPayload({ ...form, estado }, admin).estado, estado)
  assert.throws(() => assetPayload({ ...form, estado: 'EN_MANTENIMIENTO' }, admin))
  for (const [field, limit] of [['categoria', 60], ['descripcion', 150], ['responsable', 100]]) {
    assert.equal(assetPayload({ ...form, [field]: 'á'.repeat(limit / 2) }, admin)[field].length, limit / 2)
    assert.throws(() => assetPayload({ ...form, [field]: 'á'.repeat(limit / 2 + 1) }, admin))
  }
  for (const field of ['categoria', 'descripcion']) assert.throws(() => assetPayload({ ...form, [field]: ' ' }, admin))
})

test('IDs y filtro de sucursal usan el contrato real', () => {
  assert.equal(assetPath({}), '/api/activos')
  assert.equal(assetPath({ id_sucursal: '' }), '/api/activos')
  assert.equal(assetPath({ id_sucursal: '2' }), '/api/activos?id_sucursal=2')
  for (const id_sucursal of ['0', '-1', '1.5', '10000000000', 'x']) {
    assert.throws(() => assetPath({ id_sucursal }))
    assert.throws(() => assetPayload({ ...form, id_sucursal }, admin))
  }
})

test('edición carga todos los campos, cero y responsable null', () => {
  assert.deepEqual(assetFormValues(row), { id_sucursal: '2', categoria: 'Equipo', descripcion: 'Computadora', valor: '0', estado: 'ACTIVO', responsable: '' })
})

test('GET conserva listado y admite vacío; rechaza respuesta inválida', async () => {
  assert.deepEqual(await createAssetsApi(async () => [row]).list({}), [row])
  assert.deepEqual(await createAssetsApi(async () => []).list({}), [])
  await assert.rejects(createAssetsApi(async () => ({})).list({}))
})

test('alta POST y edición PUT recargan listado conservando filtro', async () => {
  for (const id of [null, 3]) {
    const calls = []
    const api = createAssetsApi(async (path, options) => { calls.push([path, options]); return options?.method ? row : [row] })
    const result = await api.save(id, form, admin, { id_sucursal: '2' })
    assert.deepEqual(calls[0], [id === null ? '/api/activos' : '/api/activos/3', { method: id === null ? 'POST' : 'PUT', body: assetPayload(form, admin) }])
    assert.equal(calls[1][0], '/api/activos?id_sucursal=2')
    assert.deepEqual(result.rows, [row])
  }
})

test('GET individual obtiene datos recientes antes de editar', async () => {
  const api = createAssetsApi(async path => { assert.equal(path, '/api/activos/3'); return row })
  assert.deepEqual(await api.read(3), row)
})

test('error API conserva código y libera bloqueo para corregir y reintentar', async () => {
  let fail = true
  const error = Object.assign(new Error('Sucursal inactiva'), { code: 'SUCURSAL_INACTIVE' })
  const api = createAssetsApi(async (path, options) => {
    if (options?.method && fail) throw error
    return options?.method ? row : [row]
  })
  await assert.rejects(api.save(null, form, admin, {}), failure => failure === error)
  fail = false
  assert.equal((await api.save(null, form, admin, {})).record, row)
})

test('bloquea doble envío entre alta y edición', async () => {
  let release
  let writes = 0
  const api = createAssetsApi(async (path, options) => {
    if (!options?.method) return [row]
    writes++
    return new Promise(resolve => { release = resolve })
  })
  const first = api.save(null, form, admin, {})
  assert.equal(await api.save(3, form, admin, {}), null)
  assert.equal(writes, 1)
  release(row)
  await first
})

test('recarga fallida conserva éxito de escritura', async () => {
  const api = createAssetsApi(async (path, options) => {
    if (options?.method) return row
    throw new Error('Sin conexión')
  })
  const result = await api.save(3, form, admin, {})
  assert.equal(result.record, row)
  assert.match(result.refreshError.message, /Sin conexión/)
})

test('AUDITOR no puede escribir ni enviar requests mediante el helper', async () => {
  let calls = 0
  const api = createAssetsApi(async () => { calls++ })
  await assert.rejects(api.save(null, form, { nombre_rol: 'AUDITOR' }, {}))
  await assert.rejects(api.save(3, form, { nombre_rol: 'AUDITOR' }, {}))
  assert.equal(calls, 0)
})
