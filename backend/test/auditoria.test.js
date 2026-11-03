const { startTestServer } = require('../test-support/testServer');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const pool = require('../src/database/pool');
const tokens = require('../src/shared/tokens');

async function setup(t, config = {}) {
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  const calls = [], events = [];
  t.mock.method(pool, 'getConnection', async () => {
    events.push('open');
    return {
      execute: async (sql, binds, options) => {
        calls.push({ sql, binds, options });
        if (config.fail) throw new Error('ORA-99999 SQL privado');
        return { rows: config.rows || [] };
      },
      close: async () => events.push('close'),
    };
  });
  const server = await startTestServer();
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { calls, events, request: async (query = '', role = 'AUDITOR', method = 'GET') => {
    const headers = {};
    if (role) headers.Authorization = `Bearer ${tokens.sign({ id_usuario: 42, id_rol: 9, nombre_rol: role, id_sucursal: null })}`;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auditoria${query}`, { method, headers });
    return { status: response.status, body: await response.json() };
  } };
}

for (const role of [null, 'ENCARGADO', 'DESPACHO']) test(`CU-14 rechaza consulta de ${role}`, async t => {
  const api = await setup(t);
  assert.equal((await api.request('', role)).status, role ? 403 : 401);
  assert.deepEqual(api.events, []);
});

for (const role of ['ADMINISTRADOR', 'AUDITOR']) test(`CU-14 ${role} consulta global y conserva relaciones nulas`, async t => {
  const rows = [{ id_auditoria: 2, id_usuario: null, usuario: null, id_sucursal: null, sucursal: null,
    modulo: 'MEDICAMENTOS', accion: 'CREAR', entidad: 'MEDICAMENTO', id_entidad: 7,
    descripcion: 'Medicamento 7 creado', fecha_hora: '2026-10-29T12:00:00' }];
  const api = await setup(t, { rows });
  const result = await api.request('', role);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, rows);
  assert.match(api.calls[0].sql, /LEFT JOIN USUARIO/);
  assert.match(api.calls[0].sql, /LEFT JOIN SUCURSAL/);
  assert.match(api.calls[0].sql, /ORDER BY a.fecha_hora DESC, a.id_auditoria DESC/);
  assert.doesNotMatch(api.calls[0].sql, /password|correo|SELECT \*/i);
  assert.deepEqual(api.events, ['open', 'close']);
});

const filters = { fecha_desde: '2024-02-29', fecha_hasta: '2024-02-29', id_usuario: 42,
  id_sucursal: 2, modulo: 'INVENTARIO', accion: 'ENTRADA', entidad: 'INVENTARIO', id_entidad: 8 };
for (const [field, value] of Object.entries(filters)) test(`CU-14 filtra ${field} con bind`, async t => {
  const api = await setup(t);
  assert.equal((await api.request(`?${field}=${value}`)).status, 200);
  assert.equal(api.calls[0].binds[field], value);
  assert.match(api.calls[0].sql, new RegExp(`:${field}\\b`));
});

test('CU-14 combina filtros y usa intervalo inclusivo de días sin TRUNC sobre columna', async t => {
  const api = await setup(t);
  const result = await api.request(`?${new URLSearchParams(filters)}`);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, []);
  assert.deepEqual(api.calls[0].binds, filters);
  assert.match(api.calls[0].sql, /a.fecha_hora >= TO_DATE\(:fecha_desde, 'FXYYYY-MM-DD'\)/);
  assert.match(api.calls[0].sql, /a.fecha_hora < TO_DATE\(:fecha_hasta, 'FXYYYY-MM-DD'\) \+ 1/);
  assert.doesNotMatch(api.calls[0].sql, /TRUNC\(a.fecha_hora\)/);
});

for (const query of ['id_usuario=0', 'id_sucursal=-1', 'id_entidad=10000000000', 'id_usuario=1.5',
  'id_usuario=1&id_usuario=2', 'fecha_desde=2023-02-29', 'fecha_hasta=2026-04-31',
  'fecha_desde=0000-01-01', 'fecha_hasta=2026-10-29T12:00:00Z',
  'fecha_desde=2026-10-30&fecha_hasta=2026-10-29', 'modulo=DESCONOCIDO', 'accion=LOGIN_FALLIDO',
  'entidad=DESCONOCIDA', 'otro=1', 'modulo=%27%20OR%201%3D1--']) test(`CU-14 rechaza filtro inválido ${query}`, async t => {
  const api = await setup(t);
  assert.equal((await api.request(`?${query}`)).status, 400);
  assert.deepEqual(api.events, []);
});

for (const [modulo, accion, entidad] of [
  ['TRANSFERENCIAS', 'CAMBIO_ESTADO', 'TRANSFERENCIA'], ['VENTAS', 'CONFIRMAR', 'VENTA'],
  ['CAJA', 'REGISTRAR', 'MOVIMIENTO_CAJA'], ['ACTIVOS', 'MODIFICAR', 'ACTIVO_FIJO'],
  ['PLANILLA', 'REGISTRAR', 'GASTO_PLANILLA'], ['ENTREGAS', 'CAMBIO_ESTADO', 'ENTREGA'],
  ['AUTH', 'LOGIN_OK', 'USUARIO'],
]) test(`CU-14 consulta los eventos nuevos de ${modulo}`, async t => {
  const api = await setup(t);
  const result = await api.request(`?${new URLSearchParams({ modulo, accion, entidad })}`);
  assert.equal(result.status, 200);
  assert.deepEqual([api.calls[0].binds.modulo, api.calls[0].binds.accion, api.calls[0].binds.entidad], [modulo, accion, entidad]);
});

for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) test(`CU-14 no expone ${method}`, async t => {
  const api = await setup(t);
  assert.equal((await api.request('', 'ADMINISTRADOR', method)).status, 404);
  assert.deepEqual(api.events, []);
});

test('CU-14 error de lectura libera conexión y sanitiza Oracle', async t => {
  const api = await setup(t, { fail: true });
  const result = await api.request();
  assert.equal(result.status, 500);
  assert.equal(result.body.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify(result.body), /ORA-|SQL privado|stack/);
  assert.deepEqual(api.events, ['open', 'close']);
});

const event = { id_usuario: null, id_sucursal: null, modulo: 'MEDICAMENTOS', accion: 'CREAR',
  entidad: 'MEDICAMENTO', id_entidad: 7, descripcion: 'Medicamento 7 creado' };

test('CU-14 escritura interna usa binds y conexión prestada sin gestionar su ciclo de vida', async t => {
  const service = require('../src/modules/auditoria/auditoria.service');
  t.mock.method(pool, 'getConnection', () => { throw new Error('Conexión adicional'); });
  const calls = [];
  await service.registrarEvento({ execute: async (...args) => { calls.push(args); return { rowsAffected: 1 }; } }, event);
  assert.equal(calls.length, 1);
  const [sql, binds, options] = calls[0];
  assert.match(sql, /INSERT INTO AUDITORIA/);
  assert.deepEqual(binds, event);
  assert.equal(options.autoCommit, false);
  assert.doesNotMatch(sql, /fecha_hora/);
  for (const key of Object.keys(event)) assert.match(sql, new RegExp(`:${key}\\b`));
});

for (const change of [{ id_entidad: undefined }, { id_entidad: 0 }, { id_usuario: -1 },
  { id_sucursal: 10000000000 }, { descripcion: '' }, { descripcion: 'á'.repeat(251) },
  { modulo: 'x'.repeat(51) }, { accion: 'SALIDA' }, { entidad: 'SUCURSAL' }, { token: 'prohibido' }]) {
  test(`CU-14 valida evento interno ${Object.keys(change)[0]}: ${String(Object.values(change)[0]).slice(0, 20)}`, async () => {
    const service = require('../src/modules/auditoria/auditoria.service');
    let executed = false;
    await assert.rejects(service.registrarEvento({ execute: async () => { executed = true; } }, { ...event, ...change }));
    assert.equal(executed, false);
  });
}

test('CU-14 admite 500 bytes y propaga el error Oracle original', async () => {
  const service = require('../src/modules/auditoria/auditoria.service');
  const failure = new Error('Oracle interno');
  await assert.rejects(service.registrarEvento({ execute: async () => { throw failure; } },
    { ...event, descripcion: 'á'.repeat(250) }), error => error === failure);
});
