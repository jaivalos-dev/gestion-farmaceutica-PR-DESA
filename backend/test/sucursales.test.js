const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const jwt = require('jsonwebtoken');
const oracledb = require('oracledb');
const database = require('../src/database/pool');
const record = { id_sucursal: 7, nombre: 'Central', tipo_sucursal: 'FARMACIA', departamento: 'Guatemala', municipio: 'Guatemala', direccion: 'Zona 1', activa: 'S' };
const { id_sucursal, ...input } = record;

async function setup(t, execute) {
  let stored = { ...record };
  const calls = [];
  const events = [];
  const secret = randomBytes(32).toString('hex');
  process.env.JWT_SECRET = secret;
  t.mock.method(database, 'getConnection', async () => ({
    execute: async (sql, binds, options) => {
      calls.push({ sql, binds, options });
      if (execute) return execute(sql, binds, options);
      if (/INSERT INTO AUDITORIA\b/.test(sql)) return { rowsAffected: 1 };
      if (/INSERT INTO SUCURSAL\b/.test(sql)) {
        const { id, ...fields } = binds;
        stored = { ...fields, id_sucursal: 7 };
        return { rowsAffected: 1, outBinds: { id: [7] } };
      }
      if (/UPDATE SUCURSAL\b/.test(sql)) {
        const { id, ...fields } = binds;
        stored = { ...stored, ...fields };
        return { rowsAffected: 1 };
      }
      if (/FROM SUCURSAL\b/.test(sql)) return { rows: [stored] };
      throw new Error('SQL no simulado');
    },
    commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'),
    close: async () => events.push('close'),
  }));
  const server = require('../src/app').createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { calls, events, request: async (method, path = '', body, role = 'ADMINISTRADOR') => {
    const headers = { 'Content-Type': 'application/json' };
    if (role) headers.Authorization = `Bearer ${jwt.sign({ id_usuario: 1, id_rol: 99, nombre_rol: role, id_sucursal: null }, secret, { expiresIn: '1h' })}`;
    return fetch(`http://127.0.0.1:${server.address().port}/api/sucursales${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } };
}

test('listar sucursales para usuario autenticado y liberar conexión', async t => {
  const api = await setup(t);
  const response = await api.request('GET', '', undefined, 'AUDITOR');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, [record]);
  assert.deepEqual(api.events, ['close']);
});

test('consultar sucursal usa id parametrizado y formato objeto Oracle', async t => {
  const api = await setup(t);
  const response = await api.request('GET', '/7');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, record);
  assert.match(api.calls[0].sql, /:id/);
  assert.deepEqual(api.calls[0].binds, { id: 7 });
  assert.equal(api.calls[0].options.outFormat, oracledb.OUT_FORMAT_OBJECT);
});

for (const method of ['GET', 'PUT', 'PATCH']) {
  test(`${method} sucursal inexistente responde 404`, async t => {
    const api = await setup(t, async () => ({ rows: [], rowsAffected: 0 }));
    const response = await api.request(method, method === 'PATCH' ? '/7/estado' : '/7', method === 'GET' ? undefined : method === 'PUT' ? input : { activa: 'N' });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, 'SUCURSAL_NOT_FOUND');
    assert.equal(api.events.includes('commit'), false);
  });
}

test('crear sucursal con binds, RETURNING y commit', async t => {
  const api = await setup(t);
  const body = { ...input, nombre: "Central ' OR 1=1 --" };
  delete body.activa;
  const response = await api.request('POST', '', body);
  assert.equal(response.status, 201);
  assert.equal((await response.json()).data.id_sucursal, 7);
  const insert = api.calls.find(call => /INSERT/.test(call.sql));
  assert.equal(insert.sql.includes(body.nombre), false);
  for (const key of Object.keys(input)) assert.match(insert.sql, new RegExp(`:${key}\\b`));
  assert.equal(insert.binds.nombre, body.nombre);
  assert.equal(insert.binds.activa, 'S');
  assert.equal(insert.binds.id.dir, oracledb.BIND_OUT);
  assert.deepEqual(api.events, ['commit', 'close']);
});

test('actualizar sucursal usa campos e id parametrizados', async t => {
  const api = await setup(t);
  assert.equal((await api.request('PUT', '/7', input)).status, 200);
  const update = api.calls.find(call => /UPDATE/.test(call.sql));
  assert.deepEqual(update.binds, { ...input, id: 7 });
  assert.deepEqual(api.events, ['commit', 'close']);
});

test('activar y desactivar solo cambia activa mediante bind', async t => {
  const api = await setup(t);
  for (const activa of ['N', 'S']) {
    const response = await api.request('PATCH', '/7/estado', { activa });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.activa, activa);
    const update = api.calls.filter(call => /UPDATE/.test(call.sql)).at(-1);
    assert.deepEqual(update.binds, { id: 7, activa });
    assert.match(update.sql, /SET activa = :activa/);
  }
});

test('rechazar datos ausentes, largos, desconocidos y valores inválidos antes de Oracle', async t => {
  const api = await setup(t);
  for (const body of [null, [], {}, { ...input, nombre: ' ' }, { ...input, direccion: 3 },
    { ...input, nombre: 'x'.repeat(101) }, { ...input, tipo_sucursal: 'BODEGA' },
    { ...input, activa: 'X' }, { ...input, id_sucursal: 9 }]) {
    assert.equal((await api.request('POST', '', body)).status, 400);
  }
  assert.equal((await api.request('PUT', '/7', { nombre: 'Central' })).status, 400);
  assert.equal((await api.request('PATCH', '/7/estado', { activa: 'N', nombre: 'otro' })).status, 400);
  assert.equal(api.calls.length, 0);
});

test('id inválido se rechaza sin consultar Oracle', async t => {
  const api = await setup(t);
  for (const id of ['0', '-1', '1.5', 'abc', '10000000000', '1e2']) {
    assert.equal((await api.request('GET', `/${id}`)).status, 400);
  }
  assert.equal(api.calls.length, 0);
});

test('todos los endpoints requieren JWT y escrituras requieren nombre ADMINISTRADOR', async t => {
  const api = await setup(t);
  for (const [method, path, body] of [['GET', '', undefined], ['GET', '/7', undefined], ['POST', '', input], ['PUT', '/7', input], ['PATCH', '/7/estado', { activa: 'N' }]]) {
    assert.equal((await api.request(method, path, body, null)).status, 401);
    if (method !== 'GET') assert.equal((await api.request(method, path, body, 'ENCARGADO')).status, 403);
  }
  assert.equal(api.calls.length, 0);
});

test('error Oracle hace rollback, libera conexión y no filtra detalles', async t => {
  const api = await setup(t, async () => { throw new Error('ORA-privado SQL password'); });
  const response = await api.request('POST', '', input);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { ok: false, code: 'INTERNAL_ERROR', message: 'Error interno del servidor' });
  assert.deepEqual(api.events, ['rollback', 'close']);
});

test('sucursal inactiva sigue consultable pero no está disponible para operaciones', async t => {
  const api = await setup(t, async () => ({ rows: [{ ...record, activa: 'N' }] }));
  assert.equal((await api.request('GET', '/7')).status, 200);
  const service = require('../src/modules/sucursales/sucursales.service');
  await assert.rejects(service.requireActive(7), error => error.code === 'SUCURSAL_INACTIVE' && error.status === 409);
});

test('listar catálogo vacío y validar disponibilidad activa', async t => {
  const api = await setup(t, async () => ({ rows: [] }));
  const response = await api.request('GET');
  assert.deepEqual((await response.json()).data, []);
  const service = require('../src/modules/sucursales/sucursales.service');
  const connection = { execute: async () => ({ rows: [record] }) };
  assert.deepEqual(await service.requireActive(7, connection), record);
});

test('Oracle no disponible devuelve 503', async t => {
  const api = await setup(t);
  const AppError = require('../src/shared/AppError');
  t.mock.method(database, 'getConnection', async () => {
    throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Oracle no está disponible');
  });
  assert.equal((await api.request('GET')).status, 503);
});

test('fallo de commit intenta rollback y cierra conexión', async t => {
  const events = [];
  t.mock.method(database, 'getConnection', async () => ({
    commit: async () => { events.push('commit'); throw new Error('commit fallido'); },
    rollback: async () => events.push('rollback'),
    close: async () => events.push('close'),
  }));
  await assert.rejects(require('../src/database/connection').withTransaction(async () => 'resultado'), /commit fallido/);
  assert.deepEqual(events, ['commit', 'rollback', 'close']);
});

test('fallo de rollback también libera conexión', async t => {
  let closed = false;
  t.mock.method(database, 'getConnection', async () => ({
    rollback: async () => { throw new Error('rollback fallido'); },
    close: async () => { closed = true; },
  }));
  await assert.rejects(require('../src/database/connection').withTransaction(async () => { throw new Error('consulta fallida'); }));
  assert.equal(closed, true);
});
