import test from 'node:test'
import assert from 'node:assert/strict'
import { availabilityPath, createAvailabilityApi } from '../src/modules/disponibilidad/availability.js'
import { getAccessRedirect } from '../src/routes/access.js'

const user = { nombre_rol: 'ENCARGADO', id_sucursal: null }
const form = { id_medicamento: '2', cantidad: '3', departamento: ' Guatemala ', municipio: 'Mixco' }
const result = { disponible: true, id_medicamento: 2, cantidad: 3, candidatos: [{ id_sucursal: 1, nombre: 'Centro', existencia: 5, tiempo_estimado: null, eta_disponible: false, prioridad: 3, formas_pago: ['EFECTIVO'] }] }

test('disponibilidad: roles permitidos sin restricción de sucursal', () => {
  for (const nombre_rol of ['ADMINISTRADOR', 'ENCARGADO', 'DESPACHO']) {
    assert.equal(getAccessRedirect({ user: { nombre_rol } }, { permission: 'disponibilidad.read' }), null)
    assert.ok(availabilityPath(form, { nombre_rol }))
  }
  assert.equal(getAccessRedirect({ user: { nombre_rol: 'AUDITOR' } }, { permission: 'disponibilidad.read' }), '/403')
  assert.throws(() => availabilityPath(form, { nombre_rol: 'AUDITOR' }))
})

test('consulta solo envía los cuatro parámetros aceptados y codifica destino', () => {
  assert.equal(availabilityPath({ ...form, id_sucursal: 99, gps: 'x' }, user), '/api/disponibilidad?id_medicamento=2&cantidad=3&departamento=Guatemala&municipio=Mixco')
  assert.match(availabilityPath({ ...form, municipio: 'San José Pinula' }, user), /San\+Jos%C3%A9\+Pinula/)
})

test('valida IDs, cantidad positiva y ubicación obligatoria hasta 50 bytes', () => {
  for (const field of ['id_medicamento', 'cantidad']) for (const value of ['', '0', '-1', '1.5', '10000000000']) assert.throws(() => availabilityPath({ ...form, [field]: value }, user))
  for (const field of ['departamento', 'municipio']) for (const value of ['', ' ', null, 'á'.repeat(26)]) assert.throws(() => availabilityPath({ ...form, [field]: value }, user))
})

test('GET conserva candidatos y ETA null sin inventar viabilidad', async () => {
  const api = createAvailabilityApi(async (path, options) => {
    assert.equal(path, availabilityPath(form, user))
    assert.equal(options.method, undefined)
    return result
  })
  assert.deepEqual(await api.consult(form, user), result)
})

test('sin candidatos, errores API y recuperación', async () => {
  let fail = true
  const failure = Object.assign(new Error('Medicamento inactivo'), { code: 'MEDICAMENTO_INACTIVE' })
  const api = createAvailabilityApi(async () => { if (fail) throw failure; return { ...result, disponible: false, candidatos: [] } })
  await assert.rejects(api.consult(form, user), error => error === failure)
  fail = false
  assert.equal((await api.consult(form, user)).disponible, false)
  await assert.rejects(createAvailabilityApi(async () => ({})).consult(form, user))
})

test('bloquea consulta duplicada mientras la anterior está pendiente', async () => {
  let release
  let calls = 0
  const api = createAvailabilityApi(async () => { calls++; return new Promise(resolve => { release = resolve }) })
  const first = api.consult(form, user)
  assert.equal(await api.consult(form, user), null)
  assert.equal(calls, 1)
  release(result)
  await first
})
