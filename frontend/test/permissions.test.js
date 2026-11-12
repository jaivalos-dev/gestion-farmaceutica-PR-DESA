import test from 'node:test'
import assert from 'node:assert/strict'
import { hasPermission, hasRole } from '../src/auth/permissions.js'

const expected = {
  ADMINISTRADOR: ['sucursales.read', 'sucursales.write', 'medicamentos.read', 'medicamentos.write', 'inventario.read', 'inventario.adjust', 'activos.read', 'activos.write', 'planilla.read', 'planilla.write', 'entregas.read', 'disponibilidad.read', 'auditoria.read'],
  ENCARGADO: ['sucursales.read', 'medicamentos.read', 'medicamentos.write', 'inventario.read', 'inventario.adjust', 'transferencias.read', 'transferencias.act', 'ventas.read', 'ventas.act', 'caja.read', 'caja.create', 'entregas.read', 'entregas.create', 'entregas.changeState', 'disponibilidad.read'],
  AUDITOR: ['sucursales.read', 'medicamentos.read', 'inventario.read', 'caja.read', 'activos.read', 'planilla.read', 'auditoria.read'],
  DESPACHO: ['sucursales.read', 'medicamentos.read', 'entregas.read', 'entregas.changeState', 'disponibilidad.read'],
}
expected.ADMINISTRADOR.push('dashboard.read')
expected.AUDITOR.push('dashboard.read')
const operations = [...new Set(Object.values(expected).flat())]

for (const [role, allowed] of Object.entries(expected)) {
  test(`${role}: permite solo las operaciones explícitas de la matriz`, () => {
    const user = { nombre_rol: role }
    for (const operation of operations) {
      assert.equal(hasPermission(user, operation), allowed.includes(operation), operation)
    }
  })
}

test('consulta de catálogos requiere usuario, pero no un rol específico', () => {
  for (const permission of ['sucursales.read', 'medicamentos.read']) {
    assert.equal(hasPermission(null, permission), false)
    assert.equal(hasPermission({ nombre_rol: 'OTRO' }, permission), true)
  }
})

test('permiso desconocido o rol no autorizado se deniegan sin privilegios implícitos', () => {
  for (const permission of ['ventas.act', 'transferencias.act', 'caja.create', 'entregas.create', 'entregas.changeState', 'inexistente', 'toString']) {
    assert.equal(hasPermission({ nombre_rol: 'ADMINISTRADOR' }, permission), false, permission)
  }
  assert.equal(hasPermission({ nombre_rol: 'OTRO' }, 'inventario.read'), false)
  assert.equal(hasPermission(null, 'ventas.read'), false)
})

test('la comprobación de rol es explícita y una lista vacía no autoriza', () => {
  assert.equal(hasRole({ nombre_rol: 'ENCARGADO' }, ['ENCARGADO']), true)
  assert.equal(hasRole({ nombre_rol: 'ADMINISTRADOR' }, ['ENCARGADO']), false)
  assert.equal(hasRole(null, ['ENCARGADO']), false)
  assert.equal(hasRole({ nombre_rol: 'ENCARGADO' }, []), false)
})
