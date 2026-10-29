const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const oracledb = require('oracledb');
const pool = require('../src/database/pool');
const tokens = require('../src/shared/tokens');

const input = { id_sucursal: 1, categoria: 'Equipo', descripcion: 'Laptop administrativa', valor: 4500, estado: 'ACTIVO', responsable: 'Ana' };

for (const [method, branch, estado] of [['POST', 1, 'ACTIVO'], ['PUT', 1, 'ACTIVO'], ['PUT', 2, 'ACTIVO'], ['PUT', 1, 'MANTENIMIENTO'], ['PUT', 1, 'BAJA']]) {
  test(`CU-14 activo ${method} sucursal ${branch} estado ${estado} audita cambios seguros`, async t => {
    const api = await setup(t);
    const result = await api.request(method, method === 'POST' ? '' : '/1', { ...input, id_sucursal: branch, estado,
      descripcion: 'password token Authorization privado', responsable: 'persona privada' });
    assert.equal(result.status, method === 'POST' ? 201 : 200);
    assert.equal(api.audit().length, 1);
    const event = api.audit()[0];
    assert.deepEqual([event.modulo, event.accion, event.entidad, event.id_entidad, event.id_usuario, event.id_sucursal],
      ['ACTIVOS', method === 'POST' ? 'CREAR' : 'MODIFICAR', 'ACTIVO_FIJO', method === 'POST' ? 4 : 1, 42, branch]);
    assert.doesNotMatch(event.descripcion, /password|token|Authorization|privado|persona privada/);
    if (method === 'PUT') {
      assert.ok(event.descripcion.includes(`sucursal 1 -> ${branch}`));
      assert.ok(event.descripcion.includes(`ACTIVO -> ${estado}`));
    }
    assert.equal(api.acquisitions(), 1);
    assert.deepEqual(api.events, ['commit', 'close']);
  });
}
for (const method of ['POST', 'PUT']) test(`CU-14 activo ${method} revierte ante fallo auditoría`, async t => {
  const api = await setup(t, { fail: /INSERT INTO AUDITORIA\b/ });
  const before = api.state();
  assert.equal((await api.request(method, method === 'POST' ? '' : '/1', { ...input, id_sucursal: 2, estado: 'BAJA' })).status, 500);
  assert.deepEqual(api.state(), before);
  assert.deepEqual(api.audit(), []);
  assert.equal(api.acquisitions(), 1);
  assert.deepEqual(api.events, ['rollback', 'close']);
});
test('CU-14 activo rechaza EN_MANTENIMIENTO sin evento', async t => {
  const api = await setup(t);
  assert.equal((await api.request('PUT', '/1', { ...input, estado: 'EN_MANTENIMIENTO' })).status, 400);
  assert.deepEqual(api.audit(), []);
});
const fixtures = [
  { id_activo: 1, ...input, fecha_registro: '2026-10-01T08:00:00' },
  { id_activo: 2, id_sucursal: 2, categoria: 'Mobiliario', descripcion: 'Escritorio', valor: 0, estado: 'BAJA', responsable: null, fecha_registro: '2026-10-02T08:00:00' },
  { id_activo: 3, id_sucursal: 2, categoria: 'Equipo', descripcion: 'Laptop de consulta', valor: 3000.29, estado: 'MANTENIMIENTO', responsable: 'Luis', fecha_registro: '2026-10-03T08:00:00' },
];

// Solo Oracle se simula: las peticiones recorren JWT, rutas, servicios y repositories reales.
async function setup(t, config = {}) {
  let audit = [];
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  let state = structuredClone(fixtures);
  const calls = [], events = [];
  let acquisitions = 0;
  const view = row => ({ ...row, sucursal: row.id_sucursal === 1 ? 'Central' : 'Norte' });
  t.mock.method(pool, 'getConnection', async () => {
    acquisitions++;
    const pending = structuredClone(state);
    const pendingAudit = structuredClone(audit);
    let written = false;
    return {
      execute: async (sql, binds, options) => {
        calls.push({ sql, binds, options });
        if (config.fail?.test(sql)) throw new Error('ORA-99999 SQL privado');
        if (/INSERT INTO AUDITORIA\b/.test(sql)) { pendingAudit.push({ ...binds }); return { rowsAffected: 1 }; }
        if (/FROM SUCURSAL/.test(sql)) return { rows: binds.id === config.missingBranch ? [] : [{ id_sucursal: binds.id, activa: binds.id === config.inactiveBranch ? 'N' : 'S' }] };
        if (/INSERT INTO ACTIVO_FIJO/.test(sql)) {
          const { id, ...data } = binds;
          pending.push({ ...data, id_activo: 4, fecha_registro: '2026-10-27T12:00:00' });
          written = true;
          return { rowsAffected: 1, outBinds: { id: [4] } };
        }
        if (/^UPDATE ACTIVO_FIJO/.test(sql)) {
          const { id, ...data } = binds;
          const row = pending.find(row => row.id_activo === id);
          if (!row || config.zeroUpdate) return { rowsAffected: 0 };
          Object.assign(row, data);
          written = true;
          return { rowsAffected: 1 };
        }
        if (/FROM ACTIVO_FIJO/.test(sql)) {
          if (written && config.failReadback) throw new Error('ORA-99999 SQL privado');
          if (binds.id !== undefined) return { rows: pending.filter(row => row.id_activo === binds.id).map(view) };
          let rows = pending;
          for (const key of ['id_sucursal', 'categoria', 'estado', 'responsable']) {
            if (binds[key] != null) rows = rows.filter(row => row[key] === binds[key]);
          }
          if (binds.descripcion) rows = rows.filter(row => row.descripcion.toUpperCase().includes(binds.descripcion.toUpperCase()));
          return { rows: rows.sort((a, b) => b.id_activo - a.id_activo).map(view) };
        }
        throw new Error('SQL no simulado');
      },
      commit: async () => { events.push('commit'); if (config.failCommit) throw new Error('ORA-99999 commit'); state = pending; audit = pendingAudit; },
      rollback: async () => { events.push('rollback'); if (config.failRollback) throw new Error('ORA-99999 rollback'); },
      close: async () => events.push('close'),
    };
  });
  const server = require('../src/app').createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return {
    audit: () => structuredClone(audit), calls, events, acquisitions: () => acquisitions, state: () => structuredClone(state),
    request: async (method = 'GET', path = '', body, role = 'ADMINISTRADOR', branch = null) => {
      const headers = { 'Content-Type': 'application/json' };
      if (role) headers.Authorization = `Bearer ${tokens.sign({ id_usuario: 42, id_rol: 99, nombre_rol: role, id_sucursal: branch })}`;
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/activos${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json(), location: response.headers.get('location') };
    },
  };
}

for (const role of [null, 'ENCARGADO', 'DESPACHO']) test(`CU-09 rechaza todas las rutas para ${role}`, async t => {
  const api = await setup(t);
  for (const [method, path] of [['GET', ''], ['GET', '/1'], ['POST', ''], ['PUT', '/1']]) {
    const result = await api.request(method, path, method === 'GET' ? undefined : input, role, 1);
    assert.equal(result.status, role ? 403 : 401);
    assert.equal(result.body.code, role ? 'FORBIDDEN' : 'UNAUTHORIZED');
  }
  assert.equal(api.acquisitions(), 0);
});

for (const role of ['ADMINISTRADOR', 'AUDITOR']) test(`CU-09 ${role} consulta global sin sucursal JWT y obtiene detalle`, async t => {
  const api = await setup(t);
  const list = await api.request('GET', '', undefined, role);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.data.map(row => row.id_activo), [3, 2, 1]);
  assert.equal(api.calls[0].binds.id_sucursal, null);
  assert.match(api.calls[0].sql, /ORDER BY a.id_activo DESC/);
  const detail = await api.request('GET', '/2', undefined, role);
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.data, { ...fixtures[1], sucursal: 'Norte' });
  assert.match(api.calls[1].sql, /WHERE a.id_activo = :id/);
  assert.deepEqual(api.calls[1].binds, { id: 2 });
  assert.equal(api.calls[1].options.outFormat, oracledb.OUT_FORMAT_OBJECT);
  assert.deepEqual(api.events, ['close', 'close']);
});

test('CU-09 AUDITOR no crea ni modifica', async t => {
  const api = await setup(t);
  for (const [method, path] of [['POST', ''], ['PUT', '/1']]) assert.equal((await api.request(method, path, input, 'AUDITOR')).status, 403);
  assert.equal(api.acquisitions(), 0);
});

for (const estado of ['ACTIVO', 'MANTENIMIENTO', 'BAJA']) test(`CU-09 crea ${estado} con ID y fecha Oracle, sucursal elegida y commit`, async t => {
  const api = await setup(t);
  const result = await api.request('POST', '', { ...input, id_sucursal: 2, estado, categoria: ' Equipo ', descripcion: ' Laptop administrativa ', responsable: ' Ana ' }, 'ADMINISTRADOR', 1);
  assert.equal(result.status, 201);
  assert.equal(result.location, '/api/activos/4');
  assert.deepEqual(result.body.data, { ...input, id_sucursal: 2, estado, id_activo: 4, fecha_registro: '2026-10-27T12:00:00', sucursal: 'Norte' });
  assert.equal(api.state().length, 4);
  assert.deepEqual(api.events, ['commit', 'close']);
  assert.equal(api.acquisitions(), 1);
  const insert = api.calls.find(call => /INSERT/.test(call.sql));
  assert.match(insert.sql, /RETURNING id_activo INTO :id/);
  assert.doesNotMatch(insert.sql, /\bfecha_registro\b/);
  assert.equal(insert.binds.id.dir, oracledb.BIND_OUT);
  assert.equal(insert.options.autoCommit, false);
  for (const key of Object.keys(insert.binds)) assert.match(insert.sql, new RegExp(`:${key}\\b`));
});

for (const responsable of [null, undefined]) test(`CU-09 responsable ${responsable} se almacena NULL`, async t => {
  const api = await setup(t);
  const result = await api.request('POST', '', { ...input, responsable });
  assert.equal(result.status, 201);
  assert.equal(result.body.data.responsable, null);
});

for (const field of ['id_activo', 'fecha_registro', 'codigo', 'id_usuario', 'otro']) test(`CU-09 rechaza sobrescribir campo ${field}`, async t => {
  const api = await setup(t);
  for (const [method, path] of [['POST', ''], ['PUT', '/1']]) {
    const result = await api.request(method, path, { ...input, [field]: 99 });
    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'INVALID_INPUT');
  }
  assert.equal(api.acquisitions(), 0);
});

for (const [field, code, values] of [
  ['categoria', 'INVALID_CATEGORY', ['', ' ', 'a'.repeat(61), 'á'.repeat(31), null, 1]],
  ['descripcion', 'INVALID_DESCRIPTION', ['', ' ', 'a'.repeat(151), 'á'.repeat(76), null, 1]],
  ['responsable', 'INVALID_RESPONSIBLE', ['', ' ', 'a'.repeat(101), 'á'.repeat(51), 1, false]],
  ['estado', 'INVALID_ASSET_STATE', ['EN_MANTENIMIENTO', 'activo', 'OTRO', '', null]],
  ['valor', 'INVALID_VALUE', [-1, 0.001, 4500.001, 10000000000, '4500', null, true, 0.1 + 0.2, 1e30]],
  ['id_sucursal', 'INVALID_ID', [0, -1, 1.5, 10000000000, '1', null, true]],
]) test(`CU-09 valida ${field} en alta y modificación antes de Oracle`, async t => {
  const api = await setup(t);
  for (const value of values) {
    for (const [method, path] of [['POST', ''], ['PUT', '/1']]) {
      const result = await api.request(method, path, { ...input, [field]: value });
      assert.equal(result.status, 400, `${method}: ${String(value)}`);
      assert.equal(result.body.code, code);
    }
  }
  assert.equal(api.acquisitions(), 0);
});

for (const valor of [0, 0.01, 0.29, 9999999999.99]) test(`CU-09 valor ${valor} conserva centavos en alta y cambio`, async t => {
  const api = await setup(t);
  for (const [method, path] of [['POST', ''], ['PUT', '/1']]) {
    const result = await api.request(method, path, { ...input, valor });
    assert.equal(result.status, method === 'POST' ? 201 : 200);
    assert.equal(result.body.data.valor, valor);
  }
});

test('CU-09 acepta límites VARCHAR2 en bytes UTF-8', async t => {
  const api = await setup(t);
  const body = { ...input, categoria: 'á'.repeat(30), descripcion: 'á'.repeat(75), responsable: 'á'.repeat(50) };
  assert.equal((await api.request('POST', '', body)).status, 201);
  assert.equal((await api.request('PUT', '/1', body)).status, 200);
});

test('CU-09 exige campos completos y objetos en POST y PUT', async t => {
  const api = await setup(t);
  const incomplete = Object.keys(input).filter(key => key !== 'responsable').map(key => {
    const body = { ...input };
    delete body[key];
    return body;
  });
  for (const body of [null, [], {}, ...incomplete]) {
    for (const [method, path] of [['POST', ''], ['PUT', '/1']]) assert.equal((await api.request(method, path, body)).status, 400);
  }
  assert.equal(api.acquisitions(), 0);
});

for (const [config, status, code] of [[{ missingBranch: 2 }, 404, 'SUCURSAL_NOT_FOUND'], [{ inactiveBranch: 2 }, 409, 'SUCURSAL_INACTIVE']]) test(`CU-09 alta y reasignación rechazan ${code}`, async t => {
  const api = await setup(t, config);
  for (const [method, path] of [['POST', ''], ['PUT', '/1']]) {
    const result = await api.request(method, path, { ...input, id_sucursal: 2 });
    assert.equal(result.status, status);
    assert.equal(result.body.code, code);
  }
  assert.deepEqual(api.state(), fixtures);
  assert.equal(api.calls.some(call => /^INSERT|^UPDATE/.test(call.sql)), false);
  assert.deepEqual(api.events, ['rollback', 'close', 'rollback', 'close']);
});

test('CU-09 actualización modifica todos los campos permitidos sin cambiar identidad ni fecha', async t => {
  const api = await setup(t);
  const body = { id_sucursal: 2, categoria: 'Mobiliario', descripcion: 'Mesa administrativa', valor: 123.45, estado: 'MANTENIMIENTO', responsable: 'Luis' };
  const result = await api.request('PUT', '/1', body);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, { ...body, id_activo: 1, fecha_registro: fixtures[0].fecha_registro, sucursal: 'Norte' });
  assert.equal(api.state().length, 3);
  assert.deepEqual(api.state()[0], { ...body, id_activo: 1, fecha_registro: fixtures[0].fecha_registro });
  assert.deepEqual(api.events, ['commit', 'close']);
  assert.equal(api.acquisitions(), 1);
  const update = api.calls.find(call => /^UPDATE/.test(call.sql));
  assert.deepEqual(update.binds, { ...body, id: 1 });
  assert.equal(update.options.autoCommit, false);
  assert.doesNotMatch(update.sql, /fecha_registro|SET id_activo/);
  assert.match(api.calls[0].sql, /FOR UPDATE/);
  assert.equal(api.calls.some(call => /^INSERT INTO ACTIVO_FIJO\b|^DELETE/.test(call.sql)), false);
  for (const key of Object.keys(update.binds)) assert.match(update.sql, new RegExp(`:${key}\\b`));
});

test('CU-09 BAJA permanece en listado y detalle; PUT puede retirar responsable', async t => {
  const api = await setup(t);
  const { responsable, ...body } = input;
  const result = await api.request('PUT', '/1', { ...body, estado: 'BAJA' });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.estado, 'BAJA');
  assert.equal(result.body.data.responsable, null);
  const list = await api.request('GET', '?estado=BAJA');
  assert.deepEqual(list.body.data.map(row => row.id_activo), [2, 1]);
  assert.equal((await api.request('GET', '/1')).body.data.estado, 'BAJA');
  assert.equal(api.state().length, 3);
});

test('CU-09 sucursal inactiva conserva consulta y permite editar sin nueva asignación', async t => {
  const api = await setup(t, { inactiveBranch: 1 });
  assert.equal((await api.request('GET', '/1')).status, 200);
  assert.deepEqual((await api.request('GET', '?id_sucursal=1')).body.data.map(row => row.id_activo), [1]);
  const result = await api.request('PUT', '/1', { ...input, valor: 0, estado: 'BAJA' });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.estado, 'BAJA');
  assert.equal((await api.request('GET', '/1')).body.data.id_sucursal, 1);
});

test('CU-09 puede reasignar desde sucursal inactiva a destino activo', async t => {
  const api = await setup(t, { inactiveBranch: 1 });
  const result = await api.request('PUT', '/1', { ...input, id_sucursal: 2 });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.id_sucursal, 2);
  assert.equal(result.body.data.id_activo, 1);
});

for (const [query, ids] of [
  ['id_sucursal=2', [3, 2]], ['categoria=Equipo', [3, 1]], ['estado=BAJA', [2]],
  ['id_sucursal=2&categoria=Equipo&estado=MANTENIMIENTO', [3]],
  ['responsable=Ana', [1]], ['descripcion=LAPTOP', [3, 1]], ['categoria=Inexistente', []],
]) test(`CU-09 filtros parametrizados ${query}`, async t => {
  const api = await setup(t);
  const result = await api.request('GET', `?${query}`, undefined, 'AUDITOR');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.map(row => row.id_activo), ids);
  const { sql, binds } = api.calls[0];
  for (const key of Object.keys(binds)) assert.match(sql, new RegExp(`:${key}\\b`));
  for (const key of ['id_sucursal', 'categoria', 'estado', 'responsable']) assert.match(sql, new RegExp(`a.${key} = :${key}`));
  assert.match(sql, /INSTR\(UPPER\(a.descripcion\), UPPER\(:descripcion\)\) > 0/);
  assert.doesNotMatch(sql, /s.activa\s*=/);
});

test('CU-09 SQL y comodines en textos permanecen en binds', async t => {
  const api = await setup(t);
  const value = "%' OR 1=1 --_";
  for (const field of ['categoria', 'descripcion', 'responsable']) {
    const result = await api.request('GET', `?${field}=${encodeURIComponent(value)}`);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data, []);
    const call = api.calls.at(-1);
    assert.equal(call.binds[field], value);
    assert.equal(call.sql.includes(value), false);
  }
  for (const [method, path] of [['POST', ''], ['PUT', '/1']]) {
    assert.equal((await api.request(method, path, { ...input, descripcion: value })).status, method === 'POST' ? 201 : 200);
    const call = api.calls.findLast(call => /^(INSERT INTO|UPDATE) ACTIVO_FIJO\b/.test(call.sql));
    assert.equal(call.binds.descripcion, value);
    assert.equal(call.sql.includes(value), false);
  }
});

test('CU-09 filtros inválidos y desconocidos se rechazan antes de Oracle', async t => {
  const api = await setup(t);
  for (const query of ['id_sucursal=0', 'id_sucursal=1&id_sucursal=2', 'estado=EN_MANTENIMIENTO', 'estado=ACTIVO&estado=BAJA', 'categoria=', 'categoria=Equipo&categoria=Otro', 'responsable=', 'descripcion=', 'codigo=X', `categoria=${'a'.repeat(61)}`]) {
    assert.equal((await api.request('GET', `?${query}`)).status, 400, query);
  }
  assert.equal(api.acquisitions(), 0);
});

test('CU-09 IDs inválidos se rechazan antes de Oracle', async t => {
  const api = await setup(t);
  for (const id of ['0', '-1', '1.5', 'abc', '10000000000', '1e2']) {
    assert.equal((await api.request('GET', `/${id}`)).body.code, 'INVALID_ID');
    assert.equal((await api.request('PUT', `/${id}`, input)).body.code, 'INVALID_ID');
  }
  assert.equal(api.acquisitions(), 0);
});

for (const method of ['GET', 'PUT']) test(`CU-09 ${method} activo inexistente responde 404`, async t => {
  const api = await setup(t);
  const result = await api.request(method, '/99', method === 'PUT' ? input : undefined);
  assert.equal(result.status, 404);
  assert.equal(result.body.code, 'ACTIVO_NOT_FOUND');
  assert.deepEqual(api.events, method === 'PUT' ? ['rollback', 'close'] : ['close']);
  assert.deepEqual(api.state(), fixtures);
});

test('CU-09 no expone DELETE, PATCH ni endpoint separado de estado', async t => {
  const api = await setup(t);
  for (const [method, path] of [['DELETE', '/1'], ['PATCH', '/1'], ['PATCH', '/1/estado'], ['POST', '/1/baja']]) {
    assert.equal((await api.request(method, path, input)).status, 404);
  }
  assert.equal(api.acquisitions(), 0);
});

for (const method of ['POST', 'PUT']) {
  for (const [name, config] of [
    ['escritura', { fail: /^(INSERT|UPDATE)/ }], ['lectura posterior', { failReadback: true }],
    ['commit', { failCommit: true }], ['rollback', { failReadback: true, failRollback: true }],
  ]) test(`CU-09 ${method} fallo de ${name} revierte y libera sin filtrar Oracle`, async t => {
    const api = await setup(t, config);
    const result = await api.request(method, method === 'PUT' ? '/1' : '', { ...input, valor: 123.45 });
    assert.equal(result.status, 500);
    assert.equal(result.body.code, 'INTERNAL_ERROR');
    assert.doesNotMatch(JSON.stringify(result.body), /ORA-|SQL|stack|privado/);
    assert.deepEqual(api.state(), fixtures);
    assert.deepEqual(api.events, config.failCommit ? ['commit', 'rollback', 'close'] : ['rollback', 'close']);
  });
}

test('CU-09 UPDATE sin fila afectada no informa éxito ni commit', async t => {
  const api = await setup(t, { zeroUpdate: true });
  const result = await api.request('PUT', '/1', input);
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'ACTIVO_CONFLICT');
  assert.deepEqual(api.events, ['rollback', 'close']);
});

test('CU-09 error de lectura libera conexión y oculta Oracle', async t => {
  const api = await setup(t, { fail: /FROM ACTIVO_FIJO/ });
  for (const path of ['', '/1']) {
    const result = await api.request('GET', path);
    assert.equal(result.status, 500);
    assert.doesNotMatch(JSON.stringify(result.body), /ORA-|SQL|stack/);
  }
  assert.deepEqual(api.events, ['close', 'close']);
});
