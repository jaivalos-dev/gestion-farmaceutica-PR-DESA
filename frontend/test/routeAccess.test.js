import test from 'node:test'
import assert from 'node:assert/strict'
import { getAccessRedirect } from '../src/routes/access.js'

test('sin sesión siempre dirige a login', () => {
  assert.equal(getAccessRedirect(null), '/login')
  assert.equal(getAccessRedirect(null, { permission: 'ventas.read' }), '/login')
})

test('una ruta sin restricciones conserva acceso para cualquier sesión', () => {
  assert.equal(getAccessRedirect({ user: { nombre_rol: 'DESPACHO' } }), null)
})

test('autoriza por rol o permiso y deniega con 403 conservando la sesión', () => {
  const session = Object.freeze({ token: 'token-prueba', user: Object.freeze({ nombre_rol: 'AUDITOR' }) })
  assert.equal(getAccessRedirect(session, { roles: ['AUDITOR'] }), null)
  assert.equal(getAccessRedirect(session, { permission: 'auditoria.read' }), null)
  assert.equal(getAccessRedirect(session, { roles: ['ENCARGADO'] }), '/403')
  assert.equal(getAccessRedirect(session, { permission: 'ventas.read' }), '/403')
  assert.equal(getAccessRedirect(session, { roles: [] }), '/403')
  assert.equal(getAccessRedirect(session, { permission: 'desconocido' }), '/403')
  assert.equal(session.token, 'token-prueba')
})

test('si se especifican rol y permiso se requieren ambos', () => {
  const session = { user: { nombre_rol: 'ENCARGADO' } }
  assert.equal(getAccessRedirect(session, { roles: ['ENCARGADO'], permission: 'ventas.read' }), null)
  assert.equal(getAccessRedirect(session, { roles: ['AUDITOR'], permission: 'ventas.read' }), '/403')
  assert.equal(getAccessRedirect(session, { roles: ['ENCARGADO'], permission: 'auditoria.read' }), '/403')
})
