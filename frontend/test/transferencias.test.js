import test from 'node:test'
import assert from 'node:assert/strict'
import { transferPath, transferPayload, availableActions, createTransfersApi } from '../src/modules/transferencias/transfers.js'
import { getAccessRedirect } from '../src/routes/access.js'

const user = { nombre_rol: 'ENCARGADO', id_sucursal: 1 }
const catalogs = { branches: [{ id_sucursal: 1, activa: 'S' }, { id_sucursal: 2, activa: 'S' }], medicines: [{ id_medicamento: 3, activo: 'S' }] }
const form = { id_sucursal_origen: '1', id_sucursal_destino: '2', observacion: ' prueba ', detalles: [{ id_medicamento: '3', cantidad: '4' }] }
const row = { id_transferencia: 7, id_sucursal_origen: 1, id_sucursal_destino: 2, estado: 'SOLICITADA' }

test('transferencias: solo ENCARGADO tiene acceso, sin privilegios implícitos', () => {
  for (const role of ['ADMINISTRADOR', 'AUDITOR', 'DESPACHO']) {
    const other = { ...user, nombre_rol: role }
    assert.equal(getAccessRedirect({ user: other }, { permission: 'transferencias.read' }), '/403')
    assert.deepEqual(availableActions(row, other), [])
    assert.throws(() => transferPayload(form, other, catalogs))
  }
  assert.equal(getAccessRedirect({ user }, { permission: 'transferencias.read' }), null)
})

test('acciones respetan estado y sucursal, incluidos estados terminales', () => {
  for (const [estado, origin, destination] of [
    ['SOLICITADA', ['preparar', 'cancelar'], []], ['PREPARADA', ['despachar', 'cancelar'], []],
    ['DESPACHADA', [], ['recibir']], ['RECIBIDA', [], []], ['CANCELADA', [], []], ['OTRO', [], []],
  ]) {
    assert.deepEqual(availableActions({ ...row, estado }, user), origin)
    assert.deepEqual(availableActions({ ...row, estado }, { ...user, id_sucursal: 2 }), destination)
    assert.deepEqual(availableActions({ ...row, estado }, { ...user, id_sucursal: 9 }), [])
    assert.deepEqual(availableActions({ ...row, estado }, { ...user, id_sucursal: null }), [])
  }
})

test('filtros usan exclusivamente los parámetros reales', () => {
  assert.equal(transferPath({}), '/api/transferencias')
  assert.equal(transferPath({ estado: 'PREPARADA', id_sucursal_origen: '1', id_sucursal_destino: '2', extra: 'x' }), '/api/transferencias?estado=PREPARADA&id_sucursal_origen=1&id_sucursal_destino=2')
  assert.throws(() => transferPath({ estado: 'OTRO' }))
  assert.throws(() => transferPath({ id_sucursal_origen: '-1' }))
})

test('payload numérico exacto, observación opcional y sin campos ajenos', () => {
  assert.deepEqual(transferPayload({ ...form, estado: 'RECIBIDA' }, user, catalogs), { id_sucursal_origen: 1, id_sucursal_destino: 2, observacion: 'prueba', detalles: [{ id_medicamento: 3, cantidad: 4 }] })
  assert.equal(transferPayload({ ...form, observacion: '' }, user, catalogs).observacion, null)
})

test('formulario rechaza origen ajeno, mismo destino, duplicados y datos inválidos', () => {
  for (const patch of [
    { id_sucursal_origen: '2' }, { id_sucursal_destino: '1' }, { detalles: [] },
    { detalles: [...form.detalles, ...form.detalles] }, { observacion: 'á'.repeat(126) },
    ...['0', '-1', '1.5', '10000000000', ''].map(cantidad => ({ detalles: [{ id_medicamento: '3', cantidad }] })),
  ]) assert.throws(() => transferPayload({ ...form, ...patch }, user, catalogs))
})

test('formulario rechaza catálogos inexistentes o inactivos', () => {
  for (const invalid of [
    { ...catalogs, branches: [] }, { ...catalogs, medicines: [] },
    { ...catalogs, branches: catalogs.branches.map(branch => ({ ...branch, activa: 'N' })) },
    { ...catalogs, medicines: [{ id_medicamento: 3, activo: 'N' }] },
  ]) assert.throws(() => transferPayload(form, user, invalid))
})

test('crear envía POST exacto y recarga el listado', async () => {
  const calls = []
  const api = createTransfersApi(async (path, options) => {
    calls.push([path, options])
    return options?.method === 'POST' ? row : [row]
  })
  const result = await api.create(form, user, catalogs, {})
  assert.deepEqual(calls[0], ['/api/transferencias', { method: 'POST', body: transferPayload(form, user, catalogs) }])
  assert.equal(calls[1][0], '/api/transferencias')
  assert.deepEqual(result.rows, [row])
})

test('transición usa POST sin cuerpo y rechaza acciones ajenas antes de enviar', async () => {
  const calls = []
  const api = createTransfersApi(async (path, options) => { calls.push([path, options]); return options?.method === 'POST' ? { ...row, estado: 'PREPARADA' } : [] })
  await api.transition(row, 'preparar', user, {})
  assert.deepEqual(calls[0], ['/api/transferencias/7/preparar', { method: 'POST' }])
  await assert.rejects(api.transition(row, 'recibir', user, {}))
  assert.equal(calls.length, 2)
})

test('error API conserva código y libera bloqueo para reintentar', async () => {
  let posts = 0
  const failure = Object.assign(new Error('Existencia insuficiente'), { code: 'INSUFFICIENT_STOCK', status: 409 })
  const api = createTransfersApi(async (path, options) => {
    if (options?.method !== 'POST') return []
    if (++posts === 1) throw failure
    return row
  })
  await assert.rejects(api.transition(row, 'preparar', user, {}), error => error === failure)
  assert.equal((await api.transition(row, 'preparar', user, {})).record, row)
  assert.equal(posts, 2)
})

test('bloqueo compartido evita doble envío incluso entre crear y transición', async () => {
  let release
  let posts = 0
  const api = createTransfersApi(async (path, options) => {
    if (options?.method !== 'POST') return []
    posts++
    return new Promise(resolve => { release = resolve })
  })
  const first = api.create(form, user, catalogs, {})
  assert.equal(await api.transition(row, 'preparar', user, {}), null)
  assert.equal(posts, 1)
  release(row)
  await first
})

test('recarga fallida conserva confirmación y no repite escritura', async () => {
  const api = createTransfersApi(async (path, options) => {
    if (options?.method === 'POST') return row
    throw new Error('Sin conexión')
  })
  const result = await api.create(form, user, catalogs, {})
  assert.equal(result.record, row)
  assert.match(result.refreshError.message, /Sin conexión/)
})
