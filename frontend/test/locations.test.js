import test from 'node:test'
import assert from 'node:assert/strict'
import { availabilityPath, createAvailabilityApi } from '../src/modules/disponibilidad/availability.js'
import { deliveryPath, deliveryPayload, createDeliveriesApi } from '../src/modules/entregas/deliveries.js'
import { toBranchPayload } from '../src/modules/catalogForms.js'

const user = { nombre_rol: 'ENCARGADO', id_sucursal: 1 }
const values = { id_medicamento: '1', cantidad: '1', id_venta: '1', nombre_cliente: 'Ana', telefono: '123', direccion: 'Calle', nombre: 'Central', tipo_sucursal: 'FARMACIA', activa: 'S', departamento: 'Guatemala', municipio: 'Guatemala' }

test('todos los contratos rechazan departamentos inexistentes y municipios ajenos', () => {
  for (const location of [
    { departamento: 'Inventado', municipio: 'Guatemala' },
    { departamento: 'Guatemala', municipio: 'Antigua Guatemala' },
    { departamento: '__proto__', municipio: 'Guatemala' },
  ]) {
    const form = { ...values, ...location }
    for (const convert of [v => availabilityPath(v, user), v => deliveryPayload(v, user), toBranchPayload]) assert.throws(() => convert(form), /catálogo|pertenece/)
    assert.throws(() => deliveryPath(location, user), /catálogo|pertenece/)
  }
})

test('filtros opcionales permiten todos o solo departamento, nunca municipio aislado', () => {
  assert.equal(deliveryPath({}, user), '/api/entregas')
  assert.equal(deliveryPath({ departamento: 'Guatemala', municipio: '' }, user), '/api/entregas?departamento=Guatemala')
  assert.throws(() => deliveryPath({ municipio: 'Mixco' }, user))
  assert.throws(() => deliveryPath({ departamento: ' ' }, user))
  assert.throws(() => deliveryPath({ departamento: 'Guatemala', municipio: ' ' }, user))
})

test('ubicaciones válidas conservan strings y no agregan identificadores', () => {
  for (const location of [{ departamento: 'Guatemala', municipio: 'Guatemala' }, { departamento: 'Sacatepéquez', municipio: 'Antigua Guatemala' }]) {
    const form = { ...values, ...location }
    for (const payload of [deliveryPayload(form, user), toBranchPayload(form), Object.fromEntries(new URL(availabilityPath(form, user), 'http://local').searchParams)]) {
      assert.equal(payload.departamento, location.departamento)
      assert.equal(payload.municipio, location.municipio)
      assert.equal('id_departamento' in payload, false)
      assert.equal('id_municipio' in payload, false)
    }
  }
})

test('ubicaciones manipuladas no generan requests', async () => {
  let calls = 0
  const request = async () => { calls++; return [] }
  const invalid = { ...values, municipio: 'Inventado' }
  await assert.rejects(createAvailabilityApi(request).consult(invalid, user))
  await assert.rejects(createDeliveriesApi(request).create(invalid, user, {}))
  await assert.rejects(createDeliveriesApi(request).list({ municipio: 'Mixco' }, user))
  assert.equal(calls, 0)
})
