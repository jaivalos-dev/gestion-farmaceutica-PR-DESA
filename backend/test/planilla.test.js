const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const oracledb = require('oracledb');
const pool = require('../src/database/pool');
const tokens = require('../src/shared/tokens');

const input = { id_sucursal: 1, periodo: '2026-10', concepto: 'Gasto mensual de planilla', monto: 18500 };
const fixtures = [
  { id_gasto: 1, id_sucursal: 1, id_usuario: 10, periodo: '2026-10', concepto: 'Planilla mensual', monto: 0.1, fecha_registro: '2026-10-01T08:00:00' },
  { id_gasto: 2, id_sucursal: 2, id_usuario: 11, periodo: '2026-10', concepto: 'Planilla mensual', monto: 0.2, fecha_registro: '2026-10-03T08:00:00' },
  { id_gasto: 3, id_sucursal: 1, id_usuario: 10, periodo: '2026-09', concepto: 'Gasto adicional', monto: 3.33, fecha_registro: '2026-10-04T08:00:00' },
  { id_gasto: 4, id_sucursal: 1, id_usuario: 10, periodo: '2026-10', concepto: 'Gasto adicional', monto: 5.01, fecha_registro: '2026-10-03T08:00:00' },
];

// Solo se sustituye Oracle. JWT, HTTP, capas y manejo de transacciones son reales.
async function setup(t, config = {}) {
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  let state = structuredClone(fixtures);
  let acquisitions = 0;
  const calls = [], events = [];
  const view = row => ({ ...row, sucursal: row.id_sucursal === 1 ? 'Central' : 'Norte', usuario: `Usuario ${row.id_usuario}` });
  t.mock.method(pool, 'getConnection', async () => {
    acquisitions++;
    const pending = structuredClone(state);
    let written = false;
    return {
      execute: async (sql, binds, options) => {
        calls.push({ sql, binds, options });
        if (config.fail?.test(sql)) throw new Error('ORA-99999 SQL privado');
        if (/FROM SUCURSAL/.test(sql)) return { rows: config.missingBranch ? [] : [{ id_sucursal: binds.id, activa: config.inactiveBranch ? 'N' : 'S' }] };
        if (/INSERT INTO GASTO_PLANILLA/.test(sql)) {
          const { id, ...data } = binds;
          const generated = pending.length + 1;
          pending.push({ ...data, id_gasto: generated, fecha_registro: '2026-10-27T12:00:00' });
          written = true;
          return { rowsAffected: 1, outBinds: { id: [generated] } };
        }
        if (/SUM\(/.test(sql)) {
          // Totales de las fixtures calculados a mano; no replicar SUM en JavaScript.
          const aggregates = {
            '*|*': { total: 8.64, cantidad_registros: 4 },
            '1|*': { total: 8.44, cantidad_registros: 3 },
            '*|2026-10': { total: 5.31, cantidad_registros: 3 },
            '1|2026-10': { total: 5.11, cantidad_registros: 2 },
          };
          const aggregate = config.summary ?? aggregates[`${binds.id_sucursal ?? '*'}|${binds.periodo ?? '*'}`] ?? { total: 0, cantidad_registros: 0 };
          return { rows: [aggregate] };
        }
        if (/FROM GASTO_PLANILLA/.test(sql)) {
          if (written && config.failReadback) throw new Error('ORA-99999 SQL privado');
          if (binds.id !== undefined) return { rows: pending.filter(row => row.id_gasto === binds.id).map(view) };
          let rows = pending;
          for (const key of ['id_sucursal', 'periodo']) {
            if (binds[key] != null) rows = rows.filter(row => row[key] === binds[key]);
          }
          if (binds.concepto) rows = rows.filter(row => row.concepto.toUpperCase().includes(binds.concepto.toUpperCase()));
          return { rows: rows.sort((a, b) => b.periodo.localeCompare(a.periodo) || b.fecha_registro.localeCompare(a.fecha_registro) || b.id_gasto - a.id_gasto).map(view) };
        }
        throw new Error('SQL no simulado');
      },
      commit: async () => { events.push('commit'); if (config.failCommit) throw new Error('ORA-99999 commit'); state = pending; },
      rollback: async () => { events.push('rollback'); if (config.failRollback) throw new Error('ORA-99999 rollback'); },
      close: async () => events.push('close'),
    };
  });
  const server = require('../src/app').createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return {
    calls, events, acquisitions: () => acquisitions, state: () => structuredClone(state),
    request: async (method = 'GET', path = '/gastos', body, role = 'ADMINISTRADOR', branch = null) => {
      const headers = { 'Content-Type': 'application/json' };
      if (role) headers.Authorization = `Bearer ${tokens.sign({ id_usuario: 42, id_rol: 99, nombre_rol: role, id_sucursal: branch })}`;
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/planilla${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json(), location: response.headers.get('location') };
    },
  };
}

for (const role of [null, 'ENCARGADO', 'DESPACHO']) test(`CU-10 protege todas las rutas: ${role}`, async t => {
  const api = await setup(t);
  for (const [method, path] of [['GET', '/gastos'], ['GET', '/gastos/1'], ['GET', '/resumen'], ['POST', '/gastos']]) {
    const result = await api.request(method, path, method === 'POST' ? input : undefined, role, 1);
    assert.equal(result.status, role ? 403 : 401);
    assert.equal(result.body.code, role ? 'FORBIDDEN' : 'UNAUTHORIZED');
  }
  assert.equal(api.acquisitions(), 0);
});

for (const role of ['ADMINISTRADOR', 'AUDITOR']) test(`CU-10 ${role} consulta global, detalle y resumen sin sucursal JWT`, async t => {
  const api = await setup(t);
  const list = await api.request('GET', '/gastos', undefined, role);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.data.map(row => row.id_gasto), [4, 2, 1, 3]);
  assert.equal(api.calls[0].binds.id_sucursal, null);
  assert.match(api.calls[0].sql, /ORDER BY g.periodo DESC, g.fecha_registro DESC, g.id_gasto DESC/);
  const detail = await api.request('GET', '/gastos/2', undefined, role);
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.data, { ...fixtures[1], sucursal: 'Norte', usuario: 'Usuario 11' });
  assert.match(api.calls[1].sql, /WHERE g.id_gasto = :id/);
  assert.deepEqual(api.calls[1].binds, { id: 2 });
  assert.equal(api.calls[1].options.outFormat, oracledb.OUT_FORMAT_OBJECT);
  const summary = await api.request('GET', '/resumen', undefined, role);
  assert.equal(summary.status, 200);
  assert.deepEqual(summary.body.data, { total: 8.64, cantidad_registros: 4 });
  assert.deepEqual(api.events, ['close', 'close', 'close']);
});

test('CU-10 AUDITOR no registra gastos', async t => {
  const api = await setup(t);
  assert.equal((await api.request('POST', '/gastos', input, 'AUDITOR')).status, 403);
  assert.equal(api.acquisitions(), 0);
});

test('CU-10 registra gasto con usuario JWT, sucursal elegida, ID/fecha Oracle y commit', async t => {
  const api = await setup(t);
  const result = await api.request('POST', '/gastos', { ...input, concepto: '  Gasto mensual de planilla  ' }, 'ADMINISTRADOR', 2);
  assert.equal(result.status, 201);
  assert.equal(result.location, '/api/planilla/gastos/5');
  assert.deepEqual(result.body.data, { ...input, id_usuario: 42, id_gasto: 5, fecha_registro: '2026-10-27T12:00:00', sucursal: 'Central', usuario: 'Usuario 42' });
  assert.deepEqual(api.state().at(-1), { ...input, id_usuario: 42, id_gasto: 5, fecha_registro: '2026-10-27T12:00:00' });
  assert.deepEqual(api.events, ['commit', 'close']);
  assert.equal(api.acquisitions(), 1);
  const insert = api.calls.find(call => /INSERT/.test(call.sql));
  assert.match(insert.sql, /RETURNING id_gasto INTO :id/);
  assert.doesNotMatch(insert.sql, /\bfecha_registro\b/);
  assert.equal(insert.binds.id.dir, oracledb.BIND_OUT);
  assert.equal(insert.options.autoCommit, false);
  for (const key of Object.keys(insert.binds)) assert.match(insert.sql, new RegExp(`:${key}\\b`));
});

for (const field of ['id_gasto', 'id_usuario', 'fecha_registro', 'fecha', 'estado', 'otro']) test(`CU-10 rechaza campo protegido/desconocido ${field}`, async t => {
  const api = await setup(t);
  const result = await api.request('POST', '/gastos', { ...input, [field]: 99 });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'INVALID_INPUT');
  assert.equal(api.acquisitions(), 0);
});

for (const periodo of ['2026-01', '2026-12', '2027-10']) test(`CU-10 registra período ${periodo}`, async t => {
  const api = await setup(t);
  const result = await api.request('POST', '/gastos', { ...input, periodo });
  assert.equal(result.status, 201);
  assert.equal(result.body.data.periodo, periodo);
});

test('CU-10 período estricto en POST, listado y resumen antes de Oracle', async t => {
  const api = await setup(t);
  for (const periodo of ['2026-1', '26-10', '2026-00', '2026-13', 'abcd-10', '2026-10 ', ' 2026-10', '2026-10\n', '', '2026-10-01']) {
    assert.equal((await api.request('POST', '/gastos', { ...input, periodo })).body.code, 'INVALID_PERIOD');
    for (const path of ['/gastos', '/resumen']) assert.equal((await api.request('GET', `${path}?periodo=${encodeURIComponent(periodo)}`)).body.code, 'INVALID_PERIOD');
  }
  for (const periodo of [null, 202610, true]) assert.equal((await api.request('POST', '/gastos', { ...input, periodo })).body.code, 'INVALID_PERIOD');
  assert.equal(api.acquisitions(), 0);
});

test('CU-10 concepto requerido y límites UTF-8', async t => {
  const api = await setup(t);
  for (const concepto of [undefined, null, '', ' \t ', 1, 'a'.repeat(121), 'á'.repeat(61)]) {
    assert.equal((await api.request('POST', '/gastos', { ...input, concepto })).body.code, 'INVALID_CONCEPT');
  }
  assert.equal(api.acquisitions(), 0);
  for (const concepto of ['a'.repeat(120), 'á'.repeat(60)]) {
    const result = await api.request('POST', '/gastos', { ...input, concepto });
    assert.equal(result.status, 201);
    assert.equal(result.body.data.concepto, concepto);
  }
});

for (const monto of [0, -1, 0.001, 18500.001, 10000000000, '18500', null, true, 0.1 + 0.2, 1e30]) test(`CU-10 rechaza monto ${monto}`, async t => {
  const api = await setup(t);
  const result = await api.request('POST', '/gastos', { ...input, monto });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'INVALID_AMOUNT');
  assert.equal(api.acquisitions(), 0);
});

for (const monto of [0.01, 0.29, 18500.25, 9999999999.99]) test(`CU-10 conserva monto ${monto}`, async t => {
  const api = await setup(t);
  const result = await api.request('POST', '/gastos', { ...input, monto });
  assert.equal(result.status, 201);
  assert.equal(result.body.data.monto, monto);
});

test('CU-10 valida objeto, campos requeridos e ID de sucursal antes de Oracle', async t => {
  const api = await setup(t);
  const incomplete = Object.keys(input).map(key => {
    const body = { ...input };
    delete body[key];
    return body;
  });
  for (const body of [null, [], {}, ...incomplete]) assert.equal((await api.request('POST', '/gastos', body)).status, 400);
  for (const id_sucursal of [0, -1, 1.5, 10000000000, '1', null]) assert.equal((await api.request('POST', '/gastos', { ...input, id_sucursal })).body.code, 'INVALID_ID');
  assert.equal(api.acquisitions(), 0);
});

for (const [config, status, code] of [[{ missingBranch: true }, 404, 'SUCURSAL_NOT_FOUND'], [{ inactiveBranch: true }, 409, 'SUCURSAL_INACTIVE']]) test(`CU-10 alta rechaza ${code}`, async t => {
  const api = await setup(t, config);
  const result = await api.request('POST', '/gastos', input);
  assert.equal(result.status, status);
  assert.equal(result.body.code, code);
  assert.deepEqual(api.state(), fixtures);
  assert.deepEqual(api.events, ['rollback', 'close']);
  assert.equal(api.calls.some(call => /INSERT/.test(call.sql)), false);
});

test('CU-10 permite gastos repetidos de sucursal, período y concepto', async t => {
  const api = await setup(t);
  const first = await api.request('POST', '/gastos', input);
  const second = await api.request('POST', '/gastos', input);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual(first.body.data.id_gasto, second.body.data.id_gasto);
  assert.equal(api.state().length, 6);
  const result = await api.request('GET', '/gastos?concepto=Gasto%20mensual');
  assert.deepEqual(result.body.data.map(row => row.id_gasto), [6, 5]);
});

for (const [query, ids] of [
  ['id_sucursal=2', [2]], ['periodo=2026-10', [4, 2, 1]], ['concepto=PLANILLA', [2, 1]],
  ['id_sucursal=1&periodo=2026-10&concepto=adicional', [4]], ['periodo=2027-01', []],
]) test(`CU-10 listado filtra ${query}`, async t => {
  const api = await setup(t);
  const result = await api.request('GET', `/gastos?${query}`);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.map(row => row.id_gasto), ids);
  const { sql, binds } = api.calls[0];
  for (const key of Object.keys(binds)) assert.match(sql, new RegExp(`:${key}\\b`));
  assert.match(sql, /g.id_sucursal = :id_sucursal/);
  assert.match(sql, /g.periodo = :periodo/);
  assert.match(sql, /INSTR\(UPPER\(g.concepto\), UPPER\(:concepto\)\) > 0/);
  assert.doesNotMatch(sql, /s.activa\s*=/);
});

for (const [query, expected] of [
  ['', { total: 8.64, cantidad_registros: 4 }],
  ['id_sucursal=1', { total: 8.44, cantidad_registros: 3 }],
  ['periodo=2026-10', { total: 5.31, cantidad_registros: 3 }],
  ['id_sucursal=1&periodo=2026-10', { total: 5.11, cantidad_registros: 2 }],
  ['periodo=2027-01', { total: 0, cantidad_registros: 0 }],
]) test(`CU-10 resumen SUM/COUNT con filtros ${query || 'global'}`, async t => {
  const api = await setup(t);
  const result = await api.request('GET', `/resumen?${query}`, undefined, 'AUDITOR');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, expected);
  assert.equal(api.calls.length, 1);
  const { sql, binds } = api.calls[0];
  assert.match(sql, /NVL\(SUM\(g.monto\), 0\) AS "total"/);
  assert.match(sql, /COUNT\(\*\) AS "cantidad_registros"/);
  assert.match(sql, /g.id_sucursal = :id_sucursal/);
  assert.match(sql, /g.periodo = :periodo/);
  assert.deepEqual(Object.keys(binds).sort(), ['id_sucursal', 'periodo']);
  assert.doesNotMatch(sql, /activa|GROUP BY/);
  assert.deepEqual(api.events, ['close']);
});

test('CU-10 resumen devuelve agregado Oracle sin sumar en Node ni limitarlo a una fila', async t => {
  const api = await setup(t, { summary: { total: 19999999999.98, cantidad_registros: 2 } });
  const result = await api.request('GET', '/resumen');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, { total: 19999999999.98, cantidad_registros: 2 });
  assert.equal(api.calls.length, 1);
  assert.match(api.calls[0].sql, /SUM\(g.monto\)/);
});

test('CU-10 históricos de sucursal inactiva siguen en listado, detalle y resumen', async t => {
  const api = await setup(t, { inactiveBranch: true });
  assert.equal((await api.request('GET', '/gastos?id_sucursal=1')).body.data.length, 3);
  assert.equal((await api.request('GET', '/gastos/1')).status, 200);
  assert.deepEqual((await api.request('GET', '/resumen?id_sucursal=1')).body.data, { total: 8.44, cantidad_registros: 3 });
  assert.equal(api.calls.some(call => /FROM SUCURSAL/.test(call.sql)), false);
});

test('CU-10 rechaza filtros desconocidos, repetidos e inválidos', async t => {
  const api = await setup(t);
  for (const path of ['/gastos', '/resumen']) {
    for (const query of ['id_sucursal=0', 'id_sucursal=10000000000', 'id_sucursal=1&id_sucursal=2', 'periodo=2026-10&periodo=2026-11', 'estado=REGISTRADO']) {
      assert.equal((await api.request('GET', `${path}?${query}`)).status, 400);
    }
  }
  for (const query of ['concepto=', 'concepto=a&concepto=b', `concepto=${'a'.repeat(121)}`]) assert.equal((await api.request('GET', `/gastos?${query}`)).status, 400);
  assert.equal((await api.request('GET', '/resumen?concepto=Planilla')).status, 400);
  assert.equal(api.acquisitions(), 0);
});

test('CU-10 concepto con SQL y comodines permanece literal en binds', async t => {
  const api = await setup(t);
  const concepto = "%' OR 1=1 --_";
  const result = await api.request('GET', `/gastos?concepto=${encodeURIComponent(concepto)}`);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, []);
  assert.equal(api.calls[0].binds.concepto, concepto);
  assert.equal(api.calls[0].sql.includes(concepto), false);
  assert.equal((await api.request('POST', '/gastos', { ...input, concepto })).status, 201);
  const insert = api.calls.find(call => /INSERT/.test(call.sql));
  assert.equal(insert.binds.concepto, concepto);
  assert.equal(insert.sql.includes(concepto), false);
});

test('CU-10 gasto inexistente devuelve 404 y libera conexión', async t => {
  const api = await setup(t);
  const result = await api.request('GET', '/gastos/99');
  assert.equal(result.status, 404);
  assert.equal(result.body.code, 'GASTO_NOT_FOUND');
  assert.deepEqual(api.events, ['close']);
});

test('CU-10 IDs inválidos se rechazan antes de Oracle', async t => {
  const api = await setup(t);
  for (const id of ['0', '-1', '1.5', 'abc', '10000000000', '1e2']) assert.equal((await api.request('GET', `/gastos/${id}`)).body.code, 'INVALID_ID');
  assert.equal(api.acquisitions(), 0);
});

test('CU-10 registros inmutables sin edición, eliminación o corrección', async t => {
  const api = await setup(t);
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    for (const path of ['/gastos', '/gastos/1', '/resumen']) assert.equal((await api.request(method, path, input)).status, 404);
  }
  for (const path of ['/gastos/1/anular', '/gastos/1/reversar', '/gastos/1/corregir']) assert.equal((await api.request('POST', path, input)).status, 404);
  assert.equal(api.acquisitions(), 0);
});

for (const [name, config] of [
  ['insert', { fail: /INSERT/ }], ['lectura posterior', { failReadback: true }],
  ['commit', { failCommit: true }], ['rollback', { failReadback: true, failRollback: true }],
]) test(`CU-10 fallo de ${name} revierte y libera sin filtrar Oracle`, async t => {
  const api = await setup(t, config);
  const result = await api.request('POST', '/gastos', input);
  assert.equal(result.status, 500);
  assert.equal(result.body.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify(result.body), /ORA-|SQL|stack|privado/);
  assert.deepEqual(api.state(), fixtures);
  assert.deepEqual(api.events, config.failCommit ? ['commit', 'rollback', 'close'] : ['rollback', 'close']);
});

for (const path of ['/gastos', '/gastos/1', '/resumen']) test(`CU-10 error de consulta ${path} libera y oculta Oracle`, async t => {
  const api = await setup(t, { fail: /FROM GASTO_PLANILLA/ });
  const result = await api.request('GET', path);
  assert.equal(result.status, 500);
  assert.doesNotMatch(JSON.stringify(result.body), /ORA-|SQL|stack/);
  assert.deepEqual(api.events, ['close']);
});
