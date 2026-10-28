const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const pool = require('../src/database/pool');
const tokens = require('../src/shared/tokens');

const input = { id_venta: 1, nombre_cliente: 'Cliente Demo', telefono: '55551234', direccion: 'Zona 1', departamento: 'Guatemala', municipio: 'Guatemala' };
const initial = { ...input, id_entrega: 1, id_sucursal: 1, tiempo_estimado: 30, estado: 'CREADA', fecha_solicitud: '2026-10-27T10:00:00', fecha_entrega: null, observaciones: null };
const states = ['CREADA', 'ASIGNADA', 'PREPARADA', 'EN_RUTA', 'ENTREGADA', 'CANCELADA'];

// Se simula únicamente la conexión Oracle, manteniendo HTTP, JWT y las cuatro capas reales.
async function setup(t, config = {}) {
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  let rows = config.existing ? [{ ...initial, estado: config.state ?? 'CREADA', fecha_entrega: config.state === 'ENTREGADA' ? '2026-10-27T12:00:00' : null },
    { ...initial, id_entrega: 2, id_venta: 2, id_sucursal: 2, departamento: 'Sacatepequez', municipio: 'Antigua', estado: 'PREPARADA' }] : [];
  const calls = [], events = [];
  t.mock.method(pool, 'getConnection', async () => {
    const pending = structuredClone(rows);
    return {
      execute: async (sql, binds, options) => {
        calls.push({ sql, binds, options });
        if (config.fail?.test(sql)) throw new Error('ORA-99999 SQL privado');
        if (/FROM VENTA/.test(sql)) return { rows: config.missingSale ? [] : [{ id_venta: binds.id, id_sucursal: config.saleBranch ?? 1, estado: config.saleState ?? 'CONFIRMADA' }] };
        if (/FROM SUCURSAL/.test(sql)) return { rows: config.missingBranch ? [] : [{ id_sucursal: binds.id, activa: config.inactiveBranch ? 'N' : 'S', departamento: 'Guatemala', municipio: 'Guatemala' }] };
        if (/INSERT INTO ENTREGA/.test(sql)) {
          if (config.unique) throw Object.assign(new Error('ORA-00001 FARMACIA.UQ_ENTREGA_VENTA'), { errorNum: 1 });
          const { id, ...data } = binds;
          const generated = pending.length + 1;
          pending.push({ ...data, id_entrega: generated, fecha_solicitud: '2026-10-27T10:00:00', fecha_entrega: null });
          return { rowsAffected: 1, outBinds: { id: [generated] } };
        }
        if (/UPDATE ENTREGA/.test(sql)) {
          const row = pending.find(row => row.id_entrega === binds.id);
          if (!row || config.conflict) return { rowsAffected: 0 };
          row.estado = binds.estado;
          if (binds.estado === 'ENTREGADA') row.fecha_entrega = '2026-10-27T12:00:00';
          return { rowsAffected: 1 };
        }
        if (/FROM ENTREGA/.test(sql)) {
          if (binds.id !== undefined) return { rows: pending.filter(row => row.id_entrega === binds.id) };
          let selected = pending;
          for (const key of ['id_venta', 'id_sucursal', 'estado', 'departamento', 'municipio']) {
            if (binds[key] != null) selected = selected.filter(row => String(row[key]).toUpperCase() === String(binds[key]).toUpperCase());
          }
          return { rows: selected };
        }
        throw new Error('SQL inesperado');
      },
      commit: async () => { events.push('commit'); if (config.failCommit) throw new Error('ORA-99999 commit'); rows = pending; },
      rollback: async () => { events.push('rollback'); },
      close: async () => events.push('close'),
    };
  });
  const server = require('../src/app').createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { calls, events, rows: () => structuredClone(rows), request: async (method = 'GET', path = '', body, role = 'ENCARGADO', branch = 1) => {
    const headers = { 'Content-Type': 'application/json' };
    if (role) headers.Authorization = `Bearer ${tokens.sign({ id_usuario: 1, id_rol: 1, nombre_rol: role, id_sucursal: branch })}`;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/entregas${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json(), location: response.headers.get('location') };
  } };
}

for (const role of [null, 'AUDITOR']) test(`CU-11 protege todas las rutas: ${role}`, async t => {
  const api = await setup(t);
  for (const [method, path, data] of [['GET', ''], ['GET', '/1'], ['POST', '', input], ['PUT', '/1/estado', { estado: 'ASIGNADA' }]]) {
    assert.equal((await api.request(method, path, data, role)).status, role ? 403 : 401);
  }
  assert.equal(api.calls.length, 0);
});

for (const role of ['DESPACHO', 'ADMINISTRADOR']) test(`CU-11 ${role} no crea`, async t => {
  const api = await setup(t);
  assert.equal((await api.request('POST', '', input, role)).status, 403);
  assert.equal(api.calls.length, 0);
});

test('CU-11 crea desde venta confirmada, deriva sucursal, ETA, fechas y confirma transacción sin stock', async t => {
  const api = await setup(t);
  const result = await api.request('POST', '', { ...input, nombre_cliente: ' Cliente Demo ', observaciones: ' Recepción ' });
  assert.equal(result.status, 201);
  assert.equal(result.location, '/api/entregas/1');
  assert.deepEqual(result.body.data, { ...initial, observaciones: 'Recepción' });
  assert.deepEqual(api.events, ['commit', 'close']);
  const insert = api.calls.find(call => /INSERT INTO ENTREGA/.test(call.sql));
  assert.match(insert.sql, /SYSTIMESTAMP/);
  assert.match(insert.sql, /NULL/);
  assert.equal(insert.options.autoCommit, false);
  assert.ok(api.calls.every(call => !/INVENTARIO|MOVIMIENTO_CAJA|UPDATE VENTA/.test(call.sql)));
});

for (const [location, eta] of [[{ municipio: 'Mixco' }, 60], [{ departamento: 'Otro' }, null]]) test(`CU-11 calcula ETA ${eta} sin stock disponible`, async t => {
  const api = await setup(t);
  const result = await api.request('POST', '', { ...input, ...location });
  assert.equal(result.status, 201);
  assert.equal(result.body.data.tiempo_estimado, eta);
  assert.ok(api.calls.every(call => !/INVENTARIO/.test(call.sql)));
});

for (const [config, status, code] of [
  [{ missingSale: true }, 404, 'VENTA_NOT_FOUND'],
  [{ saleState: 'CREADA' }, 409, 'INVALID_SALE_STATE'],
  [{ saleState: 'ANULADA' }, 409, 'INVALID_SALE_STATE'],
  [{ saleBranch: 2 }, 403, 'FORBIDDEN_BRANCH'],
  [{ existing: true }, 409, 'DELIVERY_ALREADY_EXISTS'],
  [{ unique: true }, 409, 'DELIVERY_ALREADY_EXISTS'],
  [{ inactiveBranch: true }, 409, 'SUCURSAL_INACTIVE'],
  [{ missingBranch: true }, 404, 'SUCURSAL_NOT_FOUND'],
  [{ fail: /INSERT INTO ENTREGA/ }, 500, 'INTERNAL_ERROR'],
  [{ fail: /FROM ENTREGA.*WHERE id_entrega/s }, 500, 'INTERNAL_ERROR'],
  [{ failCommit: true }, 500, 'INTERNAL_ERROR'],
]) test(`CU-11 creación rechazada y rollback: ${JSON.stringify(config)} ${code}`, async t => {
  const api = await setup(t, config);
  const before = api.rows();
  const result = await api.request('POST', '', input);
  assert.equal(result.status, status);
  assert.equal(result.body.code, code);
  assert.deepEqual(api.rows(), before);
  assert.deepEqual(api.events.slice(-2), ['rollback', 'close']);
  assert.doesNotMatch(JSON.stringify(result.body), /ORA-|SQL|stack/);
});

for (const field of ['id_entrega', 'id_sucursal', 'estado', 'tiempo_estimado', 'fecha_solicitud', 'fecha_entrega']) test(`CU-11 impide sobrescribir ${field}`, async t => {
  const api = await setup(t);
  assert.equal((await api.request('POST', '', { ...input, [field]: 1 })).status, 400);
  assert.equal(api.calls.length, 0);
});

const fields = [
  ['nombre_cliente', 100, 'INVALID_CLIENT_NAME'], ['telefono', 20, 'INVALID_PHONE'],
  ['direccion', 200, 'INVALID_ADDRESS'], ['departamento', 50, 'INVALID_DEPARTMENT'],
  ['municipio', 50, 'INVALID_MUNICIPALITY'],
];
for (const [field, limit, code] of fields) {
  for (const value of [undefined, null, '', ' ', 12, 'x'.repeat(limit + 1), 'á'.repeat(limit / 2 + 1)]) test(`CU-11 valida ${field}: ${JSON.stringify(value)}`, async t => {
    const api = await setup(t);
    const result = await api.request('POST', '', { ...input, [field]: value });
    assert.equal(result.status, 400);
    assert.equal(result.body.code, code);
    assert.equal(api.calls.length, 0);
  });
  test(`CU-11 acepta límite físico de ${field}`, async t => {
    const api = await setup(t);
    assert.equal((await api.request('POST', '', { ...input, [field]: 'x'.repeat(limit) })).status, 201);
  });
}

for (const value of [null, '', ' ', 'Recepción', 'x'.repeat(250)]) test(`CU-11 observaciones opcionales: ${JSON.stringify(value)}`, async t => {
  const api = await setup(t);
  const result = await api.request('POST', '', { ...input, observaciones: value });
  assert.equal(result.status, 201);
  assert.equal(result.body.data.observaciones, value?.trim() || null);
});
for (const value of ['x'.repeat(251), 'á'.repeat(126), 12, {}]) test(`CU-11 observaciones inválidas: ${JSON.stringify(value)}`, async t => {
  const api = await setup(t);
  const result = await api.request('POST', '', { ...input, observaciones: value });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'INVALID_OBSERVATIONS');
});

test('CU-11 una segunda entrega de la misma venta se rechaza', async t => {
  const api = await setup(t);
  assert.equal((await api.request('POST', '', input)).status, 201);
  assert.equal((await api.request('POST', '', input)).body.code, 'DELIVERY_ALREADY_EXISTS');
  assert.equal(api.rows().length, 1);
});

test('CU-11 Encargado consulta únicamente su sucursal y rechaza otra', async t => {
  const api = await setup(t, { existing: true, inactiveBranch: true });
  const result = await api.request();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.map(row => row.id_entrega), [1]);
  assert.equal((await api.request('GET', '/1')).status, 200);
  assert.equal((await api.request('GET', '/2')).body.code, 'FORBIDDEN_BRANCH');
  assert.equal((await api.request('GET', '?id_sucursal=2')).body.code, 'FORBIDDEN_BRANCH');
  assert.equal((await api.request('GET', '', undefined, 'ENCARGADO', null)).body.code, 'FORBIDDEN_BRANCH');
  assert.ok(api.calls.every(call => !/activa/.test(call.sql)));
});

for (const role of ['DESPACHO', 'ADMINISTRADOR']) test(`CU-11 lectura global e históricos: ${role}`, async t => {
  const api = await setup(t, { existing: true, inactiveBranch: true });
  const result = await api.request('GET', '', undefined, role, null);
  assert.equal(result.status, 200);
  assert.equal(result.body.data.length, 2);
  assert.equal((await api.request('GET', '/2', undefined, role, null)).status, 200);
});

for (const filter of ['estado=PREPARADA', 'id_sucursal=2', 'id_venta=2', 'departamento=Sacatepequez', 'municipio=Antigua']) test(`CU-11 filtro ${filter}`, async t => {
  const api = await setup(t, { existing: true });
  const result = await api.request('GET', `?${filter}`, undefined, 'DESPACHO', null);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.map(row => row.id_entrega), [2]);
  const field = filter.split('=')[0];
  assert.match(api.calls[0].sql, new RegExp(`:${field}`));
});

test('CU-11 entrega inexistente y entradas inválidas', async t => {
  const api = await setup(t);
  assert.equal((await api.request('GET', '/99')).body.code, 'ENTREGA_NOT_FOUND');
  assert.equal((await api.request('PUT', '/99/estado', { estado: 'ASIGNADA' })).body.code, 'ENTREGA_NOT_FOUND');
  for (const path of ['/0', '/abc', '/10000000000', '?id_sucursal=abc', '?id_venta=0', '?estado=OTRO', '?municipio=', '?departamento=']) {
    assert.equal((await api.request('GET', path)).status, 400);
  }
  for (const id_venta of [0, -1, 1.5, '1', null, 10000000000]) {
    assert.equal((await api.request('POST', '', { ...input, id_venta })).body.code, 'INVALID_ID');
  }
});

const transitions = [
  ['CREADA', 'ASIGNADA', 'ENCARGADO'], ['ASIGNADA', 'PREPARADA', 'ENCARGADO'],
  ['PREPARADA', 'EN_RUTA', 'DESPACHO'], ['EN_RUTA', 'ENTREGADA', 'DESPACHO'],
  ['CREADA', 'CANCELADA', 'ENCARGADO'], ['ASIGNADA', 'CANCELADA', 'ENCARGADO'], ['PREPARADA', 'CANCELADA', 'ENCARGADO'],
];
for (const [from, to, role] of transitions) test(`CU-11 ${from} -> ${to}: lock, commit, fechas sin cambios de stock`, async t => {
  const api = await setup(t, { existing: true, state: from });
  const result = await api.request('PUT', '/1/estado', { estado: to }, role);
  assert.equal(result.status, 200);
  assert.equal(result.body.data.estado, to);
  assert.equal(result.body.data.fecha_entrega, to === 'ENTREGADA' ? '2026-10-27T12:00:00' : null);
  assert.match(api.calls[0].sql, /FOR UPDATE/);
  const update = api.calls.find(call => /UPDATE ENTREGA/.test(call.sql));
  assert.equal(update.options.autoCommit, false);
  assert.match(update.sql, /SYSTIMESTAMP/);
  assert.deepEqual(api.events, ['commit', 'close']);
  assert.equal(api.calls.filter(call => /UPDATE ENTREGA/.test(call.sql)).length, 1);
  assert.ok(api.calls.every(call => !/INVENTARIO|MOVIMIENTO_CAJA|UPDATE VENTA/.test(call.sql)));
});

for (const from of states) for (const to of states) {
  if (transitions.some(([a, b]) => a === from && b === to)) continue;
  test(`CU-11 rechaza transición ${from} -> ${to}`, async t => {
    const api = await setup(t, { existing: true, state: from });
    const before = api.rows();
    const result = await api.request('PUT', '/1/estado', { estado: to }, ['EN_RUTA', 'ENTREGADA'].includes(to) ? 'DESPACHO' : 'ENCARGADO');
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'INVALID_DELIVERY_TRANSITION');
    assert.deepEqual(api.rows(), before);
    assert.deepEqual(api.events, ['rollback', 'close']);
  });
}

for (const [from, to, role] of transitions) test(`CU-11 impide transición ${from} -> ${to} por rol incorrecto`, async t => {
  const api = await setup(t, { existing: true, state: from });
  const result = await api.request('PUT', '/1/estado', { estado: to }, role === 'ENCARGADO' ? 'DESPACHO' : 'ENCARGADO');
  assert.equal(result.status, 403);
  assert.equal(result.body.code, 'FORBIDDEN');
  assert.ok(api.calls.every(call => !/UPDATE ENTREGA/.test(call.sql)));
});

test('CU-11 no permite cambiar estado a Administrador ni a Encargado de otra sucursal', async t => {
  const api = await setup(t, { existing: true });
  assert.equal((await api.request('PUT', '/1/estado', { estado: 'ASIGNADA' }, 'ADMINISTRADOR')).status, 403);
  assert.equal((await api.request('PUT', '/1/estado', { estado: 'ASIGNADA' }, 'ENCARGADO', 2)).body.code, 'FORBIDDEN_BRANCH');
});

for (const body of [{}, { estado: 'otro' }, { estado: 'ASIGNADA', id_sucursal: 2 }, { estado: 'ENTREGADA', fecha_entrega: '2026-01-01' }, null, []]) test(`CU-11 estado/body inválido: ${JSON.stringify(body)}`, async t => {
  const api = await setup(t, { existing: true });
  assert.equal((await api.request('PUT', '/1/estado', body)).status, 400);
  assert.equal(api.calls.length, 0);
});

for (const config of [{ fail: /UPDATE ENTREGA/ }, { conflict: true }, { failCommit: true }]) test(`CU-11 rollback de cambio de estado: ${JSON.stringify(config)}`, async t => {
  const api = await setup(t, { existing: true, ...config });
  const before = api.rows();
  const result = await api.request('PUT', '/1/estado', { estado: 'ASIGNADA' });
  assert.equal(result.status, config.conflict ? 409 : 500);
  assert.deepEqual(api.rows(), before);
  assert.deepEqual(api.events.slice(-2), ['rollback', 'close']);
  assert.doesNotMatch(JSON.stringify(result.body), /ORA-|SQL|stack/);
});

test('CU-11 no expone borrado ni modificación genérica', async t => {
  const api = await setup(t, { existing: true });
  for (const method of ['DELETE', 'PUT', 'PATCH']) assert.equal((await api.request(method, '/1', {})).status, 404);
  assert.equal(api.calls.length, 0);
});
