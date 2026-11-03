const { startTestServer } = require('../test-support/testServer');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const jwt = require('jsonwebtoken');
const pool = require('../src/database/pool');

const input = { id_sucursal: 2, id_medicamento: 3, tipo_movimiento: 'ENTRADA', cantidad: 4, referencia: 'Recepción autorizada' };
const row = { id_inventario: 7, id_sucursal: 2, id_medicamento: 3, sucursal: 'Central', medicamento: 'Paracetamol', existencia: 10, fecha_actualizacion: '2026-10-26' };

async function setup(t, config = {}) {
  const calls = [], events = [];
  let acquisitions = 0;
  const secret = randomBytes(32).toString('hex');
  process.env.JWT_SECRET = secret;
  t.mock.method(pool, 'getConnection', async () => {
    acquisitions++;
    return {
      execute: async (sql, binds, options) => {
        calls.push({ sql, binds, options });
        if (config.fail?.test(sql)) throw Object.assign(new Error(config.message || 'ORA-99999 SQL privado'), { errorNum: config.errorNum });
        if (/^SELECT/.test(sql.trim())) {
          if (/FROM SUCURSAL/.test(sql)) return { rows: config.sucursalMissing ? [] : [{ id_sucursal: 2, activa: config.inactiveSucursal ? 'N' : 'S' }] };
          if (/FROM MEDICAMENTO/.test(sql)) return { rows: config.medicamentoMissing ? [] : [{ id_medicamento: 3, activo: config.inactiveMedicamento ? 'N' : 'S' }] };
          if (/FROM MOVIMIENTO_INVENTARIO/.test(sql)) return { rows: [{ id_movimiento: 9, id_inventario: 7 }] };
          return { rows: config.missing ? [] : [{ ...row, existencia: config.stock ?? 10 }] };
        }
        if (/INSERT INTO INVENTARIO/.test(sql)) return { rowsAffected: 1, outBinds: { id: [8] } };
        if (/INSERT INTO MOVIMIENTO_INVENTARIO/.test(sql)) return { rowsAffected: 1, outBinds: { id: [9] } };
        if (/INSERT INTO AUDITORIA\b/.test(sql)) return { rowsAffected: 1 };
        if (/UPDATE INVENTARIO\b/.test(sql)) return { rowsAffected: config.zeroUpdate ? 0 : 1 };
        throw new Error('SQL no simulado');
      },
      commit: async () => { events.push('commit'); if (config.failCommit) throw new Error('commit failed'); },
      rollback: async () => { events.push('rollback'); if (config.failRollback) throw new Error('rollback failed'); },
      close: async () => events.push('close'),
    };
  });
  const server = await startTestServer();
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { calls, events, acquisitions: () => acquisitions, request: async (method = 'GET', path = '', body, role = 'ADMINISTRADOR', branch = 2) => {
    const headers = { 'Content-Type': 'application/json' };
    if (role) headers.Authorization = `Bearer ${jwt.sign({ id_usuario: 42, id_rol: 1, nombre_rol: role, id_sucursal: branch }, secret, { expiresIn: '1h' })}`;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/inventario${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  } };
}

test('lista inventario real y filtra con binds', async t => {
  const api = await setup(t);
  const result = await api.request('GET', '?id_sucursal=2&id_medicamento=3');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, [row]);
  assert.deepEqual(api.calls[0].binds, { id_sucursal: 2, id_medicamento: 3 });
  assert.deepEqual(api.events, ['close']);
});

test('consulta individual e historial ordenado', async t => {
  const api = await setup(t);
  assert.deepEqual((await api.request('GET', '/7')).body.data, row);
  assert.deepEqual((await api.request('GET', '/7/movimientos')).body.data, [{ id_movimiento: 9, id_inventario: 7 }]);
  const history = api.calls.find(c => /FROM MOVIMIENTO_INVENTARIO/.test(c.sql));
  assert.match(history.sql, /ORDER BY fecha DESC, id_movimiento DESC/);
  assert.deepEqual(history.binds, { id_inventario: 7 });
});

for (const path of ['/7', '/7/movimientos']) {
  test(`404 controlado ${path}`, async t => {
    const api = await setup(t, { missing: true });
    const result = await api.request('GET', path);
    assert.equal(result.status, 404);
    assert.equal(result.body.code, 'INVENTARIO_NOT_FOUND');
    assert.deepEqual(api.events, ['close']);
  });
}

for (const role of [null, 'DESPACHO']) {
  test(`JWT y rol requerido: ${role}`, async t => {
    const api = await setup(t);
    for (const path of ['', '/7', '/7/movimientos']) assert.equal((await api.request('GET', path, undefined, role)).status, role ? 403 : 401);
    assert.equal((await api.request('POST', '/ajustes', input, role)).status, role ? 403 : 401);
    assert.equal(api.acquisitions(), 0);
  });
}

test('AUDITOR lee todas las rutas pero no escribe', async t => {
  const api = await setup(t);
  for (const path of ['', '/7', '/7/movimientos']) assert.equal((await api.request('GET', path, undefined, 'AUDITOR', null)).status, 200);
  assert.equal((await api.request('POST', '/ajustes', input, 'AUDITOR')).status, 403);
});

test('ENCARGADO filtra por JWT y opera su sucursal', async t => {
  const api = await setup(t);
  assert.equal((await api.request('GET', '', undefined, 'ENCARGADO')).status, 200);
  assert.equal(api.calls[0].binds.id_sucursal, 2);
  for (const path of ['/7', '/7/movimientos']) assert.equal((await api.request('GET', path, undefined, 'ENCARGADO')).status, 200);
  assert.equal((await api.request('POST', '/ajustes', input, 'ENCARGADO')).status, 201);
});

for (const branch of [1, null]) {
  test(`ENCARGADO no cruza sucursales ni opera sin contexto: ${branch}`, async t => {
    const api = await setup(t);
    for (const path of ['?id_sucursal=2', '/7', '/7/movimientos']) assert.equal((await api.request('GET', path, undefined, 'ENCARGADO', branch)).status, 403);
    assert.equal((await api.request('POST', '/ajustes', input, 'ENCARGADO', branch)).status, 403);
    assert.equal(api.calls.some(c => /INSERT|UPDATE/.test(c.sql)), false);
  });
}

for (const [type, balance] of [['ENTRADA', 14], ['SALIDA', 6], ['AJUSTE', 14]]) {
  test(`${type} calcula saldos y usuario JWT en una transacción con bloqueo`, async t => {
    const api = await setup(t);
    const result = await api.request('POST', '/ajustes', { ...input, tipo_movimiento: type });
    assert.equal(result.status, 201);
    assert.equal(api.acquisitions(), 1);
    const lock = api.calls.findIndex(c => /FOR UPDATE/.test(c.sql));
    const update = api.calls.findIndex(c => /UPDATE INVENTARIO/.test(c.sql));
    const movement = api.calls.findIndex(c => /INSERT INTO MOVIMIENTO_INVENTARIO/.test(c.sql));
    assert.ok(lock >= 0 && update > lock && movement > update);
    assert.equal(api.calls[update].binds.existencia, balance);
    const binds = api.calls[movement].binds;
    assert.equal(binds.id_usuario, 42);
    assert.equal(binds.saldo_anterior, 10);
    assert.equal(binds.saldo_nuevo, balance);
    assert.equal(binds.tipo_movimiento, type);
    for (const c of api.calls.filter(c => /INSERT|UPDATE INVENTARIO/.test(c.sql))) {
      assert.equal(c.options.autoCommit, false);
      assert.equal(c.sql.includes(input.referencia), false);
      for (const key of Object.keys(c.binds)) assert.match(c.sql, new RegExp(`:${key}\\b`));
    }
    assert.deepEqual(api.events, ['commit', 'close']);
  });
}

test('ENTRADA inicial crea inventario y movimiento desde cero', async t => {
  const api = await setup(t, { missing: true });
  assert.equal((await api.request('POST', '/ajustes', input)).status, 201);
  const create = api.calls.find(c => /INSERT INTO INVENTARIO/.test(c.sql));
  const movement = api.calls.find(c => /INSERT INTO MOVIMIENTO_INVENTARIO/.test(c.sql));
  assert.equal(create.binds.existencia, 4);
  assert.equal(movement.binds.id_inventario, 8);
  assert.equal(movement.binds.saldo_anterior, 0);
  assert.equal(movement.binds.saldo_nuevo, 4);
  assert.equal(api.acquisitions(), 1);
  assert.deepEqual(api.events, ['commit', 'close']);
});

for (const type of ['SALIDA', 'AJUSTE']) {
  test(`${type} no crea inventario inexistente`, async t => {
    const api = await setup(t, { missing: true });
    const result = await api.request('POST', '/ajustes', { ...input, tipo_movimiento: type });
    assert.equal(result.body.code, 'INVENTARIO_NOT_FOUND');
    assert.equal(api.calls.some(c => /INSERT/.test(c.sql)), false);
    assert.deepEqual(api.events, ['rollback', 'close']);
  });
}

for (const [config, code] of [
  [{ sucursalMissing: true }, 'SUCURSAL_NOT_FOUND'], [{ medicamentoMissing: true }, 'MEDICAMENTO_NOT_FOUND'],
  [{ inactiveSucursal: true }, 'SUCURSAL_INACTIVE'], [{ inactiveMedicamento: true }, 'MEDICAMENTO_INACTIVE'],
  [{ stock: 2 }, 'INSUFFICIENT_STOCK'],
]) {
  test(`validación funcional ${code}`, async t => {
    const api = await setup(t, config);
    const result = await api.request('POST', '/ajustes', { ...input, tipo_movimiento: 'SALIDA' });
    assert.equal(result.body.code, code);
    assert.equal(api.calls.some(c => /INSERT|UPDATE INVENTARIO/.test(c.sql)), false);
    assert.deepEqual(api.events, ['rollback', 'close']);
  });
}

test('valida cantidades, tipos reservados, ids y referencia antes de Oracle', async t => {
  const api = await setup(t);
  for (const cantidad of [0, -1, 1.5, '4', null, 10000000000]) assert.equal((await api.request('POST', '/ajustes', { ...input, cantidad })).body.code, 'INVALID_QUANTITY');
  for (const tipo_movimiento of ['VENTA', 'TRANSFERENCIA_DESPACHO', 'TRANSFERENCIA_RECEPCION', 'REVERSO', 'otro', null]) assert.equal((await api.request('POST', '/ajustes', { ...input, tipo_movimiento })).body.code, 'INVALID_MOVEMENT_TYPE');
  for (const id of [0, -1, 1.5, '2', null, 10000000000]) {
    for (const field of ['id_sucursal', 'id_medicamento']) assert.equal((await api.request('POST', '/ajustes', { ...input, [field]: id })).body.code, 'INVALID_ID');
  }
  for (const referencia of ['', '   ', 'x'.repeat(101), 'á'.repeat(51), null]) assert.equal((await api.request('POST', '/ajustes', { ...input, tipo_movimiento: 'AJUSTE', referencia })).status, 400);
  for (const field of ['id_usuario', 'saldo_anterior', 'saldo_nuevo', 'fecha', 'id_movimiento']) assert.equal((await api.request('POST', '/ajustes', { ...input, [field]: 99 })).status, 400);
  for (const body of [null, [], {}, { ...input, referencia: undefined }]) assert.equal((await api.request('POST', '/ajustes', body)).status, 400);
  for (const path of ['/0', '/abc/movimientos', '?id_sucursal=0', '?id_medicamento=1.5', '?id_sucursal=2&id_sucursal=3']) assert.equal((await api.request('GET', path)).status, 400);
  assert.equal(api.acquisitions(), 0);
});

test('rechaza desbordamiento de saldo NUMBER(10)', async t => {
  const api = await setup(t, { stock: 9999999999 });
  assert.equal((await api.request('POST', '/ajustes', input)).body.code, 'INVALID_QUANTITY');
  assert.deepEqual(api.events, ['rollback', 'close']);
});

for (const config of [
  { fail: /UPDATE INVENTARIO/ }, { fail: /INSERT INTO MOVIMIENTO_INVENTARIO/ },
  { missing: true, fail: /INSERT INTO INVENTARIO/ }, { missing: true, fail: /INSERT INTO MOVIMIENTO_INVENTARIO/ },
  { failCommit: true }, { fail: /UPDATE INVENTARIO/, failRollback: true },
]) {
  test(`fallo revierte y libera: ${JSON.stringify(config)}`, async t => {
    const api = await setup(t, config);
    const result = await api.request('POST', '/ajustes', input);
    assert.equal(result.status, 500);
    assert.equal(result.body.code, 'INTERNAL_ERROR');
    assert.doesNotMatch(JSON.stringify(result.body), /ORA-|SQL privado|stack/);
    assert.deepEqual(api.events, config.failCommit ? ['commit', 'rollback', 'close'] : ['rollback', 'close']);
  });
}

test('conflicto de combinación inicial devuelve 409 sin Oracle interno', async t => {
  const api = await setup(t, { missing: true, fail: /INSERT INTO INVENTARIO/, errorNum: 1, message: 'ORA-00001: unique constraint (FARMACIA.UQ_INV_SUC_MED) violated' });
  const result = await api.request('POST', '/ajustes', input);
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'INVENTARIO_CONFLICT');
  assert.doesNotMatch(JSON.stringify(result.body), /ORA-|FARMACIA/);
  assert.deepEqual(api.events, ['rollback', 'close']);
});

test('listado sin filtros puede estar vacío y usa binds nulos', async t => {
  const api = await setup(t, { missing: true });
  const result = await api.request();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, []);
  assert.deepEqual(api.calls[0].binds, { id_sucursal: null, id_medicamento: null });
});

test('SALIDA puede consumir exactamente toda la existencia', async t => {
  const api = await setup(t);
  const result = await api.request('POST', '/ajustes', { ...input, tipo_movimiento: 'SALIDA', cantidad: 10 });
  assert.equal(result.status, 201);
  assert.equal(result.body.data.saldo_nuevo, 0);
  assert.deepEqual(api.events, ['commit', 'close']);
});

test('UPDATE sin fila afectada no registra movimiento ni confirma', async t => {
  const api = await setup(t, { zeroUpdate: true });
  const result = await api.request('POST', '/ajustes', input);
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'INVENTARIO_CONFLICT');
  assert.equal(api.calls.some(c => /INSERT/.test(c.sql)), false);
  assert.deepEqual(api.events, ['rollback', 'close']);
});

test('otra constraint UNIQUE no se confunde con conflicto de combinación', async t => {
  const api = await setup(t, { missing: true, fail: /INSERT INTO INVENTARIO/, errorNum: 1, message: 'ORA-00001: PK_INVENTARIO' });
  const result = await api.request('POST', '/ajustes', input);
  assert.equal(result.status, 500);
  assert.equal(result.body.code, 'INTERNAL_ERROR');
  assert.deepEqual(api.events, ['rollback', 'close']);
});

test('fallo de lectura libera conexión y oculta SQL', async t => {
  const api = await setup(t, { fail: /FROM INVENTARIO/ });
  const result = await api.request();
  assert.equal(result.status, 500);
  assert.equal(result.body.code, 'INTERNAL_ERROR');
  assert.deepEqual(api.events, ['close']);
});

test('referencia de 100 bytes y caracteres SQL se conserva como bind', async t => {
  const api = await setup(t);
  const referencia = "' OR 1=1 --".padEnd(100, 'x');
  const result = await api.request('POST', '/ajustes', { ...input, referencia });
  assert.equal(result.status, 201);
  const movement = api.calls.find(c => /INSERT INTO MOVIMIENTO_INVENTARIO/.test(c.sql));
  assert.equal(movement.binds.referencia, referencia);
  assert.equal(movement.sql.includes(referencia), false);
});
