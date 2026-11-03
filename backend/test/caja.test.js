const { startTestServer } = require('../test-support/testServer');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const pool = require('../src/database/pool');
const tokens = require('../src/shared/tokens');

const input = { tipo: 'EGRESO', monto: 125.5, concepto: 'Pago de mensajería' };

for (const tipo of ['INGRESO', 'EGRESO']) {
  test(`CU-14 caja manual ${tipo} audita sin concepto libre`, async t => {
    const api = await setup(t);
    assert.equal((await api.request('POST', '', { ...input, tipo, concepto: 'password token Authorization privado' })).status, 201);
    assert.equal(api.audit().length, 1);
    const event = api.audit()[0];
    assert.deepEqual([event.modulo, event.accion, event.entidad, event.id_entidad, event.id_usuario, event.id_sucursal],
      ['CAJA', 'REGISTRAR', 'MOVIMIENTO_CAJA', 5, 42, 1]);
    assert.ok(event.descripcion.includes(tipo));
    assert.match(event.descripcion, /125\.50/);
    assert.doesNotMatch(event.descripcion, /password|token|Authorization|privado/);
    assert.equal(api.acquisitions(), 1);
    assert.deepEqual(api.events, ['commit', 'close']);
  });
  test(`CU-14 caja ${tipo} revierte si auditoría falla`, async t => {
    const api = await setup(t, { fail: /INSERT INTO AUDITORIA\b/ });
    const before = api.state();
    assert.equal((await api.request('POST', '', { ...input, tipo })).status, 500);
    assert.deepEqual(api.state(), before);
    assert.deepEqual(api.audit(), []);
    assert.equal(api.acquisitions(), 1);
    assert.deepEqual(api.events, ['rollback', 'close']);
  });
}
const fixtures = [
  { id_mov_caja: 1, id_sucursal: 1, id_usuario: 10, id_venta: 1, tipo: 'INGRESO', monto: 100, concepto: 'Venta 1', fecha: '2026-10-01T08:00:00' },
  { id_mov_caja: 2, id_sucursal: 2, id_usuario: 11, id_venta: null, tipo: 'INGRESO', monto: 50, concepto: 'Aporte', fecha: '2026-10-02T10:00:00' },
  { id_mov_caja: 3, id_sucursal: 1, id_usuario: 10, id_venta: null, tipo: 'EGRESO', monto: 20, concepto: 'Mensajería', fecha: '2026-10-03T23:59:59.999999' },
  { id_mov_caja: 4, id_sucursal: 1, id_usuario: 10, id_venta: null, tipo: 'INGRESO', monto: 10, concepto: 'Aporte', fecha: '2026-10-03T23:59:59.999999' },
];

// Se sustituye solo la conexión Oracle: HTTP, JWT, capas y transacciones son reales.
async function setup(t, config = {}) {
  let audit = [];
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  let state = structuredClone(fixtures);
  const calls = [], events = [];
  let acquisitions = 0;
  t.mock.method(pool, 'getConnection', async () => {
    acquisitions++;
    const pending = structuredClone(state);
    const pendingAudit = structuredClone(audit);
    return {
      execute: async (sql, binds, options) => {
        calls.push({ sql, binds, options });
        if (config.fail?.test(sql)) throw new Error('ORA-99999 SQL privado');
        if (/INSERT INTO AUDITORIA\b/.test(sql)) { pendingAudit.push({ ...binds }); return { rowsAffected: 1 }; }
        if (/FROM SUCURSAL/.test(sql)) return { rows: config.missingBranch ? [] : [{ id_sucursal: binds.id, activa: config.inactiveBranch ? 'N' : 'S' }] };
        if (/INSERT INTO MOVIMIENTO_CAJA/.test(sql)) {
          const { id, ...data } = binds;
          pending.push({ ...data, id_mov_caja: 5, fecha: '2026-10-27T12:00:00' });
          return { outBinds: { id: [5] } };
        }
        if (/FROM MOVIMIENTO_CAJA/.test(sql)) {
          if (binds.id !== undefined) return { rows: pending.filter(row => row.id_mov_caja === binds.id) };
          let rows = pending;
          for (const key of ['id_sucursal', 'tipo', 'id_venta']) {
            if (binds[key] != null) rows = rows.filter(row => row[key] === binds[key]);
          }
          if (binds.fecha_desde) rows = rows.filter(row => row.fecha.slice(0, 10) >= binds.fecha_desde);
          if (binds.fecha_hasta) rows = rows.filter(row => row.fecha.slice(0, 10) <= binds.fecha_hasta);
          if (binds.concepto) rows = rows.filter(row => row.concepto.toUpperCase().includes(binds.concepto.toUpperCase()));
          return { rows: rows.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id_mov_caja - a.id_mov_caja) };
        }
        throw new Error('SQL no simulado');
      },
      commit: async () => { events.push('commit'); if (config.failCommit) throw new Error('ORA-99999 commit'); state = pending; audit = pendingAudit; },
      rollback: async () => { events.push('rollback'); if (config.failRollback) throw new Error('ORA-99999 rollback'); },
      close: async () => events.push('close'),
    };
  });
  const server = await startTestServer();
  t.after(() => new Promise(resolve => server.close(resolve)));
  return {
    audit: () => structuredClone(audit), calls, events, state: () => structuredClone(state), acquisitions: () => acquisitions,
    request: async (method = 'GET', path = '', body, branch = 1, role = 'ENCARGADO') => {
      const headers = { 'Content-Type': 'application/json' };
      if (role) headers.Authorization = `Bearer ${tokens.sign({ id_usuario: 42, id_rol: 2, nombre_rol: role, id_sucursal: branch })}`;
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/caja/movimientos${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}

for (const role of [null, 'ADMINISTRADOR', 'DESPACHO']) test(`CU-08 protege todas las rutas: ${role}`, async t => {
  const api = await setup(t);
  for (const [method, path] of [['GET', ''], ['GET', '/1'], ['POST', '']]) {
    assert.equal((await api.request(method, path, method === 'POST' ? input : undefined, 1, role)).status, role ? 403 : 401);
  }
  assert.equal(api.acquisitions(), 0);
});

test('CU-08 ENCARGADO sin sucursal no accede a Oracle', async t => {
  const api = await setup(t);
  for (const [method, path] of [['GET', ''], ['GET', '/1'], ['POST', '']]) {
    assert.equal((await api.request(method, path, method === 'POST' ? input : undefined, null)).body.code, 'USER_BRANCH_REQUIRED');
  }
  assert.equal(api.acquisitions(), 0);
});

test('CU-08 ENCARGADO consulta exclusivamente su sucursal y conserva ventas', async t => {
  const api = await setup(t);
  const result = await api.request();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.map(row => row.id_mov_caja), [4, 3, 1]);
  assert.equal(result.body.data.at(-1).id_venta, 1);
  assert.equal(api.calls[0].binds.id_sucursal, 1);
  assert.match(api.calls[0].sql, /id_sucursal = :id_sucursal/);
  assert.match(api.calls[0].sql, /ORDER BY fecha DESC, id_mov_caja DESC/);
  assert.deepEqual(api.events, ['close']);
});

test('CU-08 ENCARGADO no puede filtrar otra sucursal', async t => {
  const api = await setup(t);
  const result = await api.request('GET', '?id_sucursal=2');
  assert.equal(result.status, 403);
  assert.equal(result.body.code, 'FORBIDDEN_BRANCH');
  assert.equal(api.acquisitions(), 0);
  assert.equal((await api.request('GET', '?id_sucursal=1')).status, 200);
});

test('CU-08 AUDITOR sin sucursal consulta globalmente y filtra sucursal', async t => {
  const api = await setup(t);
  const all = await api.request('GET', '', undefined, null, 'AUDITOR');
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.data.map(row => row.id_mov_caja), [4, 3, 2, 1]);
  assert.equal(api.calls[0].binds.id_sucursal, null);
  const filtered = await api.request('GET', '?id_sucursal=2', undefined, null, 'AUDITOR');
  assert.deepEqual(filtered.body.data.map(row => row.id_mov_caja), [2]);
});

test('CU-08 AUDITOR no registra movimientos', async t => {
  const api = await setup(t);
  assert.equal((await api.request('POST', '', input, null, 'AUDITOR')).status, 403);
  assert.equal(api.acquisitions(), 0);
});

for (const tipo of ['INGRESO', 'EGRESO']) test(`CU-08 crea ${tipo} manual con contexto JWT, fecha Oracle y commit`, async t => {
  const api = await setup(t);
  const result = await api.request('POST', '', { ...input, tipo, concepto: '  Pago de mensajería  ' });
  assert.equal(result.status, 201);
  assert.deepEqual(result.body.data, { id_mov_caja: 5, id_sucursal: 1, id_usuario: 42, id_venta: null, tipo, monto: 125.5, concepto: input.concepto, fecha: '2026-10-27T12:00:00' });
  assert.deepEqual(api.state().at(-1), result.body.data);
  assert.deepEqual(api.events, ['commit', 'close']);
  assert.equal(api.acquisitions(), 1);
  const insert = api.calls.find(call => /INSERT/.test(call.sql));
  assert.equal(insert.options.autoCommit, false);
  assert.doesNotMatch(insert.sql, /\bfecha\b/);
  assert.match(insert.sql, /RETURNING id_mov_caja INTO :id/);
  assert.doesNotMatch(insert.sql, /Pago de mensajería/);
  for (const key of Object.keys(insert.binds)) assert.match(insert.sql, new RegExp(`:${key}\\b`));
  // El egreso supera el neto de la sucursal: no se consulta ni exige saldo.
  assert.equal(api.calls.filter(call => /SELECT/.test(call.sql)).length, 2);
});

for (const field of ['id_mov_caja', 'id_sucursal', 'id_usuario', 'id_venta', 'fecha', 'saldo', 'otro']) test(`CU-08 rechaza campo protegido/desconocido ${field}`, async t => {
  const api = await setup(t);
  const result = await api.request('POST', '', { ...input, [field]: 9 });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'INVALID_INPUT');
  assert.equal(api.acquisitions(), 0);
});

for (const monto of [0, -1, 0.001, 125.501, 10000000000, '125.50', null, true, 1e30, 0.1 + 0.2]) test(`CU-08 rechaza monto ${monto}`, async t => {
  const api = await setup(t);
  assert.equal((await api.request('POST', '', { ...input, monto })).body.code, 'INVALID_AMOUNT');
  assert.equal(api.acquisitions(), 0);
});

for (const monto of [0.01, 0.29, 9999999999.99]) test(`CU-08 conserva monto exacto ${monto}`, async t => {
  const api = await setup(t);
  const result = await api.request('POST', '', { ...input, monto });
  assert.equal(result.status, 201);
  assert.equal(result.body.data.monto, monto);
});

test('CU-08 valida tipo, concepto y estructura antes de Oracle', async t => {
  const api = await setup(t);
  for (const tipo of ['ingreso', 'VENTA', '', null, 1]) assert.equal((await api.request('POST', '', { ...input, tipo })).body.code, 'INVALID_MOVEMENT_TYPE');
  for (const concepto of ['', '  ', null, 1, 'a'.repeat(201), 'á'.repeat(101)]) assert.equal((await api.request('POST', '', { ...input, concepto })).body.code, 'INVALID_CONCEPT');
  for (const body of [null, [], {}, { tipo: 'INGRESO' }]) assert.equal((await api.request('POST', '', body)).status, 400);
  assert.equal(api.acquisitions(), 0);
  assert.equal((await api.request('POST', '', { ...input, concepto: 'á'.repeat(100) })).status, 201);
});

for (const [config, code, status] of [[{ inactiveBranch: true }, 'SUCURSAL_INACTIVE', 409], [{ missingBranch: true }, 'SUCURSAL_NOT_FOUND', 404]]) test(`CU-08 escritura valida ${code}`, async t => {
  const api = await setup(t, config);
  const result = await api.request('POST', '', input);
  assert.equal(result.status, status);
  assert.equal(result.body.code, code);
  assert.deepEqual(api.state(), fixtures);
  assert.deepEqual(api.events, ['rollback', 'close']);
});

test('CU-08 consultas históricas no dependen de sucursal activa', async t => {
  const api = await setup(t, { inactiveBranch: true });
  assert.equal((await api.request()).status, 200);
  assert.equal((await api.request('GET', '/1')).status, 200);
  assert.equal(api.calls.some(call => /FROM SUCURSAL/.test(call.sql)), false);
});

for (const [query, ids] of [
  ['tipo=EGRESO', [3]], ['fecha_desde=2026-10-03', [4, 3]],
  ['fecha_hasta=2026-10-01', [1]], ['fecha_desde=2026-10-03&fecha_hasta=2026-10-03', [4, 3]],
  ['id_venta=1', [1]], ['concepto=venta', [1]], ['tipo=INGRESO&fecha_hasta=2026-10-03', [4, 1]],
]) test(`CU-08 filtra ${query}`, async t => {
  const api = await setup(t);
  const result = await api.request('GET', `?${query}`);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.map(row => row.id_mov_caja), ids);
  const { sql, binds } = api.calls[0];
  for (const key of Object.keys(binds)) assert.match(sql, new RegExp(`:${key}\\b`));
  assert.match(sql, /fecha >= TO_DATE\(:fecha_desde, 'FXYYYY-MM-DD'\)/);
  assert.match(sql, /TRUNC\(fecha\) <= TO_DATE\(:fecha_hasta, 'FXYYYY-MM-DD'\)/);
  assert.match(sql, /tipo = :tipo/);
  assert.match(sql, /id_venta = :id_venta/);
  assert.match(sql, /INSTR\(UPPER\(concepto\), UPPER\(:concepto\)\) > 0/);
});

test('CU-08 concepto con SQL y comodines se usa como texto literal parametrizado', async t => {
  const api = await setup(t);
  const concepto = "%' OR 1=1 --_";
  const result = await api.request('GET', `?concepto=${encodeURIComponent(concepto)}`);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, []);
  assert.equal(api.calls[0].binds.concepto, concepto);
  assert.equal(api.calls[0].sql.includes(concepto), false);
});

test('CU-08 rechaza filtros y fechas inválidos antes de Oracle', async t => {
  const api = await setup(t);
  for (const query of ['fecha_desde=2026-02-29', 'fecha_hasta=2026-04-31', 'fecha_desde=0000-01-01', 'fecha_desde=2026-1-01', 'fecha_desde=ayer', 'fecha_desde=', 'fecha_desde=2026-10-04&fecha_hasta=2026-10-03', 'fecha_desde=2026-10-01&fecha_desde=2026-10-02', 'tipo=VENTA', 'tipo=INGRESO&tipo=EGRESO', 'id_venta=0', 'id_sucursal=10000000000', 'id_venta=1&id_venta=2', 'concepto=', 'otro=1']) {
    assert.equal((await api.request('GET', `?${query}`)).status, 400, query);
  }
  assert.equal(api.acquisitions(), 0);
  assert.equal((await api.request('GET', '?fecha_desde=2024-02-29&fecha_hasta=9999-12-31')).status, 200);
});

test('CU-08 consulta individual propia y AUDITOR global conservan id_venta', async t => {
  const api = await setup(t);
  assert.deepEqual((await api.request('GET', '/1')).body.data, fixtures[0]);
  assert.deepEqual((await api.request('GET', '/2', undefined, null, 'AUDITOR')).body.data, fixtures[1]);
  assert.match(api.calls[0].sql, /WHERE id_mov_caja = :id/);
  assert.deepEqual(api.calls[0].binds, { id: 1 });
});

test('CU-08 inexistente devuelve 404 y movimiento ajeno devuelve 403 sin datos', async t => {
  const api = await setup(t);
  const absent = await api.request('GET', '/99');
  assert.equal(absent.status, 404);
  assert.equal(absent.body.code, 'MOVEMENT_NOT_FOUND');
  const foreign = await api.request('GET', '/2');
  assert.equal(foreign.status, 403);
  assert.equal(foreign.body.code, 'FORBIDDEN_BRANCH');
  assert.equal(foreign.body.data, undefined);
});

test('CU-08 identificadores inválidos no llegan a Oracle', async t => {
  const api = await setup(t);
  for (const id of ['0', '-1', '1.5', 'abc', '10000000000', '1e2']) assert.equal((await api.request('GET', `/${id}`)).body.code, 'INVALID_ID');
  assert.equal(api.acquisitions(), 0);
});

test('CU-08 movimientos manuales y de venta son inmutables', async t => {
  const api = await setup(t);
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    for (const path of ['', '/1', '/3']) assert.equal((await api.request(method, path, input)).status, 404);
  }
  for (const path of ['/1/reversar', '/1/anular', '/abrir', '/cerrar']) assert.equal((await api.request('POST', path)).status, 404);
  assert.equal(api.acquisitions(), 0);
});

for (const config of [{ fail: /INSERT/ }, { fail: /FROM MOVIMIENTO_CAJA/ }, { failCommit: true }, { fail: /INSERT/, failRollback: true }]) test(`CU-08 rollback, liberación y error sanitizado ${String(config.fail ?? 'commit')}/${!!config.failRollback}`, async t => {
  const api = await setup(t, config);
  const result = await api.request('POST', '', input);
  assert.equal(result.status, 500);
  assert.equal(result.body.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify(result.body), /ORA-|SQL|stack|privado/);
  assert.deepEqual(api.state(), fixtures);
  assert.deepEqual(api.events, config.failCommit ? ['commit', 'rollback', 'close'] : ['rollback', 'close']);
});

test('CU-08 error de consulta libera conexión y oculta Oracle', async t => {
  const api = await setup(t, { fail: /FROM MOVIMIENTO_CAJA/ });
  const result = await api.request();
  assert.equal(result.status, 500);
  assert.doesNotMatch(JSON.stringify(result.body), /ORA-|SQL|stack/);
  assert.deepEqual(api.events, ['close']);
});
