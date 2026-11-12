import test from 'node:test'
import assert from 'node:assert/strict'
import { auditPath, createAuditApi, auditText } from '../src/modules/auditoria/audit.js'
import { getAccessRedirect } from '../src/routes/access.js'
import { hasPermission } from '../src/auth/permissions.js'

const user = { nombre_rol: 'AUDITOR' }
const row = { id_auditoria: 2, fecha_hora: '2026-11-04T12:00:00', id_usuario: null, usuario: null, id_sucursal: null, sucursal: null, modulo: 'VENTAS', accion: 'CONFIRMAR', entidad: 'VENTA', id_entidad: 7, descripcion: 'Venta 7 confirmada' }

test('auditoría: permisos centrales y ruta protegida', () => {
  for (const nombre_rol of ['ADMINISTRADOR', 'AUDITOR', 'ENCARGADO', 'DESPACHO']) {
    const allowed = ['ADMINISTRADOR', 'AUDITOR'].includes(nombre_rol)
    assert.equal(hasPermission({ nombre_rol }, 'auditoria.read'), allowed)
    assert.equal(getAccessRedirect({ user: { nombre_rol } }, { permission: 'auditoria.read' }), allowed ? null : '/403')
  }
  assert.equal(getAccessRedirect(null, { permission: 'auditoria.read' }), '/login')
})

test('query exacta de ocho filtros; vacíos omitidos y campos ajenos nunca enviados', () => {
  assert.equal(auditPath({}), '/api/auditoria')
  assert.equal(auditPath({ fecha_desde: '', modulo: '', token: 'no-enviar' }), '/api/auditoria')
  assert.equal(auditPath({ fecha_desde: '2024-02-29', fecha_hasta: '2024-02-29', id_usuario: '42', id_sucursal: '2', modulo: 'INVENTARIO', accion: 'ENTRADA', entidad: 'INVENTARIO', id_entidad: '8' }), '/api/auditoria?fecha_desde=2024-02-29&fecha_hasta=2024-02-29&id_usuario=42&id_sucursal=2&modulo=INVENTARIO&accion=ENTRADA&entidad=INVENTARIO&id_entidad=8')
})

test('valida fechas reales, rango inclusivo e IDs positivos', () => {
  for (const fecha_desde of ['2023-02-29', '2026-04-31', '0000-01-01', '2026-1-01', '2026-01-01T00:00:00Z']) assert.throws(() => auditPath({ fecha_desde }))
  assert.throws(() => auditPath({ fecha_desde: '2026-11-05', fecha_hasta: '2026-11-04' }))
  for (const field of ['id_usuario', 'id_sucursal', 'id_entidad']) for (const value of ['0', '-1', '1.5', '10000000000']) assert.throws(() => auditPath({ [field]: value }))
})

test('catálogos exactos; no impone combinaciones que GET no valida', () => {
  assert.match(auditPath({ modulo: ' AUTH ', accion: 'LOGIN_OK', entidad: 'USUARIO' }), /modulo=AUTH/)
  assert.match(auditPath({ modulo: 'VENTAS', accion: 'ENTRADA', entidad: 'SUCURSAL' }), /accion=ENTRADA/)
  for (const filters of [{ modulo: 'OTRO' }, { accion: 'LOGIN_FALLIDO' }, { entidad: 'OTRA' }]) assert.throws(() => auditPath(filters))
})

test('GET conserva eventos y relaciones null; elimina propiedades fuera del contrato', async () => {
  const calls = []
  const api = createAuditApi(async (path, options) => { calls.push([path, options]); return [{ ...row, token: 'no-visible', password: 'no-visible', extra: { secret: 'no-visible' } }] })
  const controller = new AbortController()
  assert.deepEqual(await api.list({}, user, controller.signal), [row])
  assert.deepEqual(calls, [['/api/auditoria', { signal: controller.signal }]])
  assert.deepEqual(Object.keys(api), ['list'])
})

test('listado vacío válido y respuesta inválida rechazada', async () => {
  assert.deepEqual(await createAuditApi(async () => []).list({}, user), [])
  await assert.rejects(createAuditApi(async () => ({})).list({}, user))
})

test('error API conserva mensaje/código y permite reintentar GET', async () => {
  let fail = true
  const failure = Object.assign(new Error('Servicio no disponible'), { code: 'DATABASE_UNAVAILABLE' })
  const api = createAuditApi(async () => { if (fail) throw failure; return [row] })
  await assert.rejects(api.list({}, user), error => error === failure)
  fail = false
  assert.deepEqual(await api.list({}, user), [row])
})

test('sin permiso no envía solicitudes', async () => {
  let calls = 0
  const api = createAuditApi(async () => { calls++; return [] })
  for (const nombre_rol of ['ENCARGADO', 'DESPACHO']) await assert.rejects(api.list({}, { nombre_rol }))
  assert.equal(calls, 0)
})

test('texto seguro: null, objetos y credenciales reconocibles no se renderizan', () => {
  assert.equal(auditText(null), '—')
  assert.equal(auditText({ password: 'privado' }), '—')
  assert.equal(auditText('Venta 7 confirmada'), 'Venta 7 confirmada')
  for (const value of ['password=privado', 'token: privado', 'Authorization: Bearer privado', 'contraseña: privado', 'JWT_SECRET=privado', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature', '$2b$12$abcdefghijklmnopqrstuv']) {
    assert.equal(auditText(value), 'Contenido sensible oculto')
  }
})
