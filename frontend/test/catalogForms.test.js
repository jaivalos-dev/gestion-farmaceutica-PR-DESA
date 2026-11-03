import test from 'node:test'
import assert from 'node:assert/strict'
import { branchFields, medicineFields, toBranchPayload, toMedicinePayload } from '../src/modules/catalogForms.js'
import { hasPermission } from '../src/auth/permissions.js'

const branch = { nombre: ' Central ', tipo_sucursal: 'FARMACIA', departamento: 'Guatemala', municipio: 'Guatemala', direccion: ' Calle 1 ', activa: 'S' }
const medicine = { codigo: ' MED-1 ', nombre: 'Medicamento', categoria: 'Categoría', presentacion: 'Caja', precio: '0', activo: 'S' }

test('sucursal produce solo los campos del contrato y recorta texto', () => {
  assert.deepEqual(toBranchPayload({ ...branch, id_sucursal: 7 }), { ...branch, nombre: 'Central', direccion: 'Calle 1' })
  assert.equal(toBranchPayload({ ...branch, tipo_sucursal: 'STAND', activa: 'N' }).activa, 'N')
})

test('formularios rechazan campos vacíos y límites UTF-8 excedidos', () => {
  for (const [fields, source, convert] of [[branchFields, branch, toBranchPayload], [medicineFields, medicine, toMedicinePayload]]) {
    for (const field of fields.filter(field => field.maxBytes)) {
      assert.throws(() => convert({ ...source, [field.name]: '   ' }), /obligatorio/)
      assert.throws(() => convert({ ...source, [field.name]: 'á'.repeat(field.maxBytes) }), /bytes/)
    }
  }
})

test('tipos y estados respetan los valores reales del backend', () => {
  assert.throws(() => toBranchPayload({ ...branch, tipo_sucursal: 'BODEGA' }))
  assert.throws(() => toBranchPayload({ ...branch, activa: true }))
  assert.throws(() => toMedicinePayload({ ...medicine, activo: 'ACTIVO' }))
})

test('precio se envía como número sin redondear ni rechazar cero', () => {
  for (const price of ['0', '12.345', '99999999.99', '99999999.994']) {
    const result = toMedicinePayload({ ...medicine, precio: price, id_medicamento: 2 })
    assert.equal(result.precio, Number(price))
    assert.equal(result.codigo, 'MED-1')
    assert.equal(Object.hasOwn(result, 'id_medicamento'), false)
  }
})

test('precio rechaza vacío, no finito, negativo y límite exclusivo', () => {
  for (const price of ['', ' ', 'abc', 'Infinity', '-0.01', '99999999.995', '100000000']) {
    assert.throws(() => toMedicinePayload({ ...medicine, precio: price }), /Precio/)
  }
})

test('visibilidad de alta y edición usa permisos centrales de cada catálogo', () => {
  for (const [role, branchWrite, medicineWrite] of [
    ['ADMINISTRADOR', true, true], ['ENCARGADO', false, true],
    ['AUDITOR', false, false], ['DESPACHO', false, false],
  ]) {
    const user = { nombre_rol: role }
    assert.equal(hasPermission(user, 'sucursales.write'), branchWrite)
    assert.equal(hasPermission(user, 'medicamentos.write'), medicineWrite)
    assert.equal(hasPermission(user, 'sucursales.read'), true)
    assert.equal(hasPermission(user, 'medicamentos.read'), true)
  }
})
