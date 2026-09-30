const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const jwt = require('jsonwebtoken');
const oracledb = require('oracledb');
const database = require('../src/database/pool');
const record = { id_medicamento: 7, codigo: 'MED-01', nombre: 'Paracetamol', categoria: 'Analgesico', presentacion: 'Tabletas', precio: 0, activo: 'S' };
const { id_medicamento, ...input } = record;

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
      if (/INSERT/.test(sql)) {
        const { id, ...fields } = binds;
        stored = { ...fields, id_medicamento: 7 };
        return { rowsAffected: 1, outBinds: { id: [7] } };
      }
      if (/UPDATE/.test(sql)) {
        const { id, ...fields } = binds;
        stored = { ...stored, ...fields };
        return { rowsAffected: 1 };
      }
      return { rows: [stored] };
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
    return fetch(`http://127.0.0.1:${server.address().port}/api/medicamentos${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } };
}

test('listar medicamentos para usuario autenticado y liberar conexión', async t => {
  const api = await setup(t);
  const response = await api.request('GET', '', undefined, 'AUDITOR');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, [record]);
  assert.deepEqual(api.events, ['close']);
});

test('consultar medicamento usa id parametrizado y formato objeto Oracle', async t => {
  const api = await setup(t);
  const response = await api.request('GET', '/7');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, record);
  assert.match(api.calls[0].sql, /:id/);
  assert.deepEqual(api.calls[0].binds, { id: 7 });
  assert.equal(api.calls[0].options.outFormat, oracledb.OUT_FORMAT_OBJECT);
});

for (const method of ['GET', 'PUT', 'PATCH']) {
  test(`${method} medicamento inexistente responde 404`, async t => {
    const api = await setup(t, async () => ({ rows: [], rowsAffected: 0 }));
    const response = await api.request(method, method === 'PATCH' ? '/7/estado' : '/7', method === 'GET' ? undefined : method === 'PUT' ? input : { activo: 'N' });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, 'MEDICAMENTO_NOT_FOUND');
    assert.equal(api.events.includes('commit'), false);
  });
}

test('crear medicamento con binds, RETURNING y commit', async t => {
  const api = await setup(t);
  const body = { ...input, nombre: "Central ' OR 1=1 --" };
  delete body.activo;
  const response = await api.request('POST', '', body);
  assert.equal(response.status, 201);
  assert.equal((await response.json()).data.id_medicamento, 7);
  const insert = api.calls.find(call => /INSERT/.test(call.sql));
  assert.equal(insert.sql.includes(body.nombre), false);
  for (const key of Object.keys(input)) assert.match(insert.sql, new RegExp(`:${key}\\b`));
  assert.equal(insert.binds.nombre, body.nombre);
  assert.equal(insert.binds.activo, 'S');
  assert.equal(insert.binds.id.dir, oracledb.BIND_OUT);
  assert.deepEqual(api.events, ['commit', 'close']);
});

test('actualizar medicamento usa campos e id parametrizados', async t => {
  const api = await setup(t);
  assert.equal((await api.request('PUT', '/7', input)).status, 200);
  const update = api.calls.find(call => /UPDATE/.test(call.sql));
  assert.deepEqual(update.binds, { ...input, id: 7 });
  assert.deepEqual(api.events, ['commit', 'close']);
});

test('activar y desactivar solo cambia activo mediante bind', async t => {
  const api = await setup(t);
  for (const activo of ['N', 'S']) {
    const response = await api.request('PATCH', '/7/estado', { activo });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.activo, activo);
    const update = api.calls.filter(call => /UPDATE/.test(call.sql)).at(-1);
    assert.deepEqual(update.binds, { id: 7, activo });
    assert.match(update.sql, /SET activo = :activo/);
  }
});

test('rechazar datos ausentes, largos, desconocidos y valores inválidos antes de Oracle', async t => {
  const api = await setup(t);
  for (const body of [null, [], {}, { ...input, nombre: ' ' }, { ...input, precio: -1 },
    { ...input, nombre: 'x'.repeat(121) }, { ...input, precio: '10' },
    { ...input, activo: 'X' }, { ...input, id_medicamento: 9 }]) {
    assert.equal((await api.request('POST', '', body)).status, 400);
  }
  assert.equal((await api.request('PUT', '/7', { nombre: 'Central' })).status, 400);
  assert.equal((await api.request('PATCH', '/7/estado', { activo: 'N', nombre: 'otro' })).status, 400);
  assert.equal(api.calls.length, 0);
});

test('id inválido se rechaza sin consultar Oracle', async t => {
  const api = await setup(t);
  for (const id of ['0', '-1', '1.5', 'abc', '10000000000', '1e2']) {
    assert.equal((await api.request('GET', `/${id}`)).status, 400);
  }
  assert.equal(api.calls.length, 0);
});

test('todos los endpoints requieren JWT y rechazan escrituras de AUDITOR', async t => {
  const api = await setup(t);
  for (const [method, path, body] of [['GET', '', undefined], ['GET', '/7', undefined], ['POST', '', input], ['PUT', '/7', input], ['PATCH', '/7/estado', { activo: 'N' }]]) {
    assert.equal((await api.request(method, path, body, null)).status, 401);
    if (method !== 'GET') assert.equal((await api.request(method, path, body, 'AUDITOR')).status, 403);
  }
  assert.equal(api.calls.length, 0);
});

for (const method of ['POST', 'PUT']) {
  test(`${method} traduce código duplicado a 409 y hace rollback`, async t => {
    const api = await setup(t, async () => {
      throw Object.assign(new Error('ORA-00001: unique constraint (FARMACIA.UQ_MED_CODIGO) violated'), { errorNum: 1 });
    });
    const response = await api.request(method, method === 'POST' ? '' : '/7', input);
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { ok: false, code: 'MEDICAMENTO_CODE_DUPLICATE', message: 'El código de medicamento ya existe' });
    assert.deepEqual(api.events, ['rollback', 'close']);
  });
}

test('otra constraint UNIQUE no se presenta como código duplicado', async t => {
  const api = await setup(t, async () => {
    throw Object.assign(new Error('ORA-00001 (FARMACIA.PK_MEDICAMENTO)'), { errorNum: 1 });
  });
  const response = await api.request('POST', '', input);
  assert.equal(response.status, 500);
  assert.equal((await response.json()).code, 'INTERNAL_ERROR');
});

test('ENCARGADO puede crear, modificar y cambiar estado de medicamentos', async t => {
  const api = await setup(t);
  for (const [method, path, body, status] of [['POST', '', input, 201], ['PUT', '/7', { ...input, nombre: 'Nuevo' }, 200], ['PATCH', '/7/estado', { activo: 'N' }, 200]]) {
    const response = await api.request(method, path, body, 'ENCARGADO');
    assert.equal(response.status, status);
    const data = (await response.json()).data;
    if (method === 'PUT') assert.equal(data.nombre, 'Nuevo');
    if (method === 'PATCH') assert.equal(data.activo, 'N');
  }
});

test('valida cada campo obligatorio y sus límites UTF-8', async t => {
  const api = await setup(t);
  for (const [field, limit] of Object.entries({ codigo: 30, nombre: 120, categoria: 60, presentacion: 80 })) {
    const missing = { ...input };
    delete missing[field];
    assert.equal((await api.request('POST', '', missing)).status, 400);
    for (const value of ['', ' ', 1, 'x'.repeat(limit + 1), 'á'.repeat(limit)]) {
      assert.equal((await api.request('POST', '', { ...input, [field]: value })).status, 400);
    }
    assert.equal((await api.request('POST', '', { ...input, [field]: 'x'.repeat(limit) })).status, 201);
  }
});

test('precio permite cero y decimales, rechaza negativos y desbordamiento', async t => {
  const api = await setup(t);
  for (const precio of [0, 0.001, 1.235, 99999999.99]) {
    assert.equal((await api.request('POST', '', { ...input, precio })).status, 201);
  }
  for (const precio of [undefined, null, true, '', '2.50', -1, -0.01, 100000000, 99999999.995]) {
    assert.equal((await api.request('POST', '', { ...input, precio })).status, 400);
  }
});

test('error Oracle hace rollback, libera conexión y no filtra detalles', async t => {
  const api = await setup(t, async () => { throw new Error('ORA-privado SQL password'); });
  const response = await api.request('POST', '', input);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { ok: false, code: 'INTERNAL_ERROR', message: 'Error interno del servidor' });
  assert.deepEqual(api.events, ['rollback', 'close']);
});

test('medicamento inactivo sigue consultable pero no está disponible para operaciones', async t => {
  const api = await setup(t, async () => ({ rows: [{ ...record, activo: 'N' }] }));
  assert.equal((await api.request('GET', '/7')).status, 200);
  const service = require('../src/modules/medicamentos/medicamentos.service');
  await assert.rejects(service.requireActive(7), error => error.code === 'MEDICAMENTO_INACTIVE' && error.status === 409);
});

test('listar catálogo vacío y validar disponibilidad activa', async t => {
  const api = await setup(t, async () => ({ rows: [] }));
  const response = await api.request('GET');
  assert.deepEqual((await response.json()).data, []);
  const service = require('../src/modules/medicamentos/medicamentos.service');
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

