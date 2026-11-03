import test from 'node:test'
import assert from 'node:assert/strict'
import { inventoryPath, adjustmentPayload, createInventoryApi } from '../src/modules/inventario/inventory.js'
import { hasPermission } from '../src/auth/permissions.js'
import { getAccessRedirect } from '../src/routes/access.js'

const input = { id_sucursal: '2', id_medicamento: '3', tipo_movimiento: 'ENTRADA', cantidad: '5', referencia: ' Conteo inicial ' }

test('inventario aplica lectura y ajuste por rol sin privilegios implícitos', () => {
  for (const [role, read, adjust] of [['ADMINISTRADOR', true, true], ['ENCARGADO', true, true], ['AUDITOR', true, false], ['DESPACHO', false, false]]) {
    const user = { nombre_rol: role }
    assert.equal(hasPermission(user, 'inventario.read'), read)
    assert.equal(hasPermission(user, 'inventario.adjust'), adjust)
    assert.equal(getAccessRedirect({ user }, { permission: 'inventario.read' }), read ? null : '/403')
  }
})

test('filtros generan query params reales y omiten valores vacíos', () => {
  assert.equal(inventoryPath({}), '/api/inventario')
  assert.equal(inventoryPath({ id_sucursal: '2', id_medicamento: '3' }), '/api/inventario?id_sucursal=2&id_medicamento=3')
  assert.equal(inventoryPath({ id_sucursal: '', id_medicamento: '3' }), '/api/inventario?id_medicamento=3')
  assert.throws(() => inventoryPath({ id_sucursal: '0' }))
})

test('ajuste transforma IDs y cantidad y conserva solo campos permitidos', () => {
  assert.deepEqual(adjustmentPayload({ ...input, existencia: 999 }), { id_sucursal: 2, id_medicamento: 3, tipo_movimiento: 'ENTRADA', cantidad: 5, referencia: 'Conteo inicial' })
  for (const tipo_movimiento of ['ENTRADA', 'SALIDA', 'AJUSTE']) assert.equal(adjustmentPayload({ ...input, tipo_movimiento }).tipo_movimiento, tipo_movimiento)
})

test('rechaza cantidades, IDs, tipos y referencias evidentemente inválidos', () => {
  for (const field of ['id_sucursal', 'id_medicamento', 'cantidad']) {
    for (const value of ['', '0', '-1', '1.5', '10000000000', 'Infinity']) assert.throws(() => adjustmentPayload({ ...input, [field]: value }))
  }
  for (const referencia of ['', ' ', 'á'.repeat(51)]) assert.throws(() => adjustmentPayload({ ...input, referencia }))
  assert.throws(() => adjustmentPayload({ ...input, tipo_movimiento: 'VENTA' }))
})

test('ajuste exitoso ejecuta POST y vuelve a consultar inventario con filtros', async () => {
  const calls = []
  const api = createInventoryApi(async (path, options) => {
    calls.push({ path, options })
    return options?.method === 'POST' ? { saldo_nuevo: 5 } : [{ existencia: 5 }]
  })
  const result = await api.adjust(input, { id_sucursal: '2' })
  assert.deepEqual(calls.map(call => call.path), ['/api/inventario/ajustes', '/api/inventario?id_sucursal=2'])
  assert.equal(calls[0].options.method, 'POST')
  assert.deepEqual(calls[0].options.body, adjustmentPayload(input))
  assert.equal(result.rows[0].existencia, 5)
})

test('error de ajuste libera el bloqueo y permite un nuevo intento', async () => {
  let attempts = 0
  const api = createInventoryApi(async (path, options) => {
    if (options?.method === 'POST' && ++attempts === 1) throw new Error('Existencia insuficiente')
    return options?.method === 'POST' ? { saldo_nuevo: 5 } : []
  })
  await assert.rejects(api.adjust(input, {}), /Existencia insuficiente/)
  assert.equal((await api.adjust(input, {})).movement.saldo_nuevo, 5)
  assert.equal(attempts, 2)
})

test('no envía una segunda petición durante guardado', async () => {
  let release
  let posts = 0
  const api = createInventoryApi(async (path, options) => {
    if (options?.method !== 'POST') return []
    posts++
    return new Promise(resolve => { release = resolve })
  })
  const first = api.adjust(input, {})
  assert.equal(await api.adjust(input, {}), null)
  assert.equal(posts, 1)
  release({ saldo_nuevo: 5 })
  await first
})

test('si falla la recarga conserva éxito del movimiento y no repite escritura', async () => {
  const api = createInventoryApi(async (path, options) => {
    if (options?.method === 'POST') return { saldo_nuevo: 5 }
    throw new Error('Consulta no disponible')
  })
  const result = await api.adjust(input, {})
  assert.equal(result.movement.saldo_nuevo, 5)
  assert.match(result.refreshError.message, /Consulta no disponible/)
})
