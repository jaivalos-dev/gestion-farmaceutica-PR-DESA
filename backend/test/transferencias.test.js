const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const tokens = require('../src/shared/tokens');
const pool = require('../src/database/pool');

const input = { id_sucursal_origen: 1, id_sucursal_destino: 2, observacion: "Traslado ' autorizado", detalles: [{ id_medicamento: 3, cantidad: 5 }] };

// Simula únicamente el driver: las cuatro capas y los límites transaccionales son reales.
async function setup(t, config = {}) {
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  let state = {
    transfer: config.missing ? null : { id_transferencia: 7, id_sucursal_origen: 1, id_sucursal_destino: 2, id_usuario: 10, fecha: '2026-10-27', estado: config.state || 'SOLICITADA', observacion: null, origen: 'Origen', destino: 'Destino', usuario: 'Creador' },
    details: config.details || [{ id_detalle: 8, id_medicamento: 3, cantidad: 5, medicamento: 'Medicina', codigo: 'MED3' }],
    inventories: { '1:3': { id_inventario: 13, existencia: config.stock ?? 10 }, '1:4': { id_inventario: 14, existencia: 10 }, ...(config.noDestination ? {} : { '2:3': { id_inventario: 23, existencia: config.destinationStock ?? 2 }, '2:4': { id_inventario: 24, existencia: 2 } }) },
    movements: [],
  };
  const calls = [], events = [];
  let acquisitions = 0;
  t.mock.method(pool, 'getConnection', async () => {
    acquisitions++;
    const pending = structuredClone(state);
    let movementCount = 0;
    return {
      execute: async (sql, binds, options) => {
        calls.push({ sql, binds, options });
        if (config.fail?.test(sql)) throw new Error('ORA-99999 SQL privado');
        if (/^SELECT/.test(sql.trim())) {
          if (/FROM SUCURSAL/.test(sql)) return { rows: binds.id === config.missingBranch ? [] : [{ activa: binds.id === config.inactiveBranch ? 'N' : 'S' }] };
          if (/FROM MEDICAMENTO/.test(sql)) return { rows: binds.id === config.missingMedicine ? [] : [{ activo: binds.id === config.inactiveMedicine ? 'N' : 'S' }] };
          if (/FROM DETALLE_TRANSFERENCIA/.test(sql)) return { rows: [...pending.details].sort((a, b) => a.id_medicamento - b.id_medicamento || a.id_detalle - b.id_detalle) };
          if (/FROM INVENTARIO/.test(sql)) return { rows: pending.inventories[`${binds.id_sucursal}:${binds.id_medicamento}`] ? [structuredClone(pending.inventories[`${binds.id_sucursal}:${binds.id_medicamento}`])] : [] };
          if (/FROM TRANSFERENCIA/.test(sql)) return { rows: pending.transfer ? [structuredClone(pending.transfer)] : [] };
        }
        if (/INSERT INTO TRANSFERENCIA/.test(sql)) {
          pending.transfer = { id_transferencia: 7, fecha: '2026-10-27', ...Object.fromEntries(Object.entries(binds).filter(([k]) => k !== 'id')) };
          pending.details = [];
          return { outBinds: { id: [7] } };
        }
        if (/INSERT INTO DETALLE_TRANSFERENCIA/.test(sql)) { pending.details.push({ ...binds }); return { rowsAffected: 1 }; }
        if (/UPDATE TRANSFERENCIA/.test(sql)) { pending.transfer.estado = binds.estado; return { rowsAffected: config.zeroState ? 0 : 1 }; }
        if (/UPDATE INVENTARIO/.test(sql)) {
          Object.values(pending.inventories).find(i => i.id_inventario === binds.id_inventario).existencia = binds.existencia;
          return { rowsAffected: config.zeroInventory ? 0 : 1 };
        }
        if (/INSERT INTO INVENTARIO/.test(sql)) {
          if (config.uniqueConflict) throw Object.assign(new Error('ORA-00001 (FARMACIA.UQ_INV_SUC_MED)'), { errorNum: 1 });
          pending.inventories[`${binds.id_sucursal}:${binds.id_medicamento}`] = { id_inventario: 30 + binds.id_medicamento, existencia: binds.existencia };
          return { outBinds: { id: [30 + binds.id_medicamento] } };
        }
        if (/INSERT INTO MOVIMIENTO_INVENTARIO/.test(sql)) {
          if (++movementCount === config.failMovement) throw new Error('ORA-99999 SQL privado');
          pending.movements.push({ ...binds });
          return { outBinds: { id: [movementCount] } };
        }
        throw new Error(`SQL no simulado: ${sql}`);
      },
      commit: async () => { events.push('commit'); if (config.failCommit) throw new Error('commit failed'); state = pending; },
      rollback: async () => { events.push('rollback'); if (config.failRollback) throw new Error('rollback failed'); },
      close: async () => events.push('close'),
    };
  });
  const server = require('../src/app').createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { calls, events, state: () => structuredClone(state), acquisitions: () => acquisitions,
    setStock: (branch, medicine, stock) => { state.inventories[`${branch}:${medicine}`].existencia = stock; },
    request: async (method = 'GET', path = '', body, branch = 1, role = 'ENCARGADO') => {
      const headers = { 'Content-Type': 'application/json' };
      if (role) headers.Authorization = `Bearer ${tokens.sign({ id_usuario: 42, id_rol: 2, nombre_rol: role, id_sucursal: branch })}`;
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/transferencias${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    },
  };
}

test('CU-06 crea cabecera y detalles SOLICITADA con usuario JWT sin afectar inventario', async t => {
  const api = await setup(t);
  const result = await api.request('POST', '', input);
  assert.equal(result.status, 201);
  assert.equal(result.body.data.estado, 'SOLICITADA');
  assert.equal(api.state().transfer.id_usuario, 42);
  assert.equal(api.state().details.length, 1);
  assert.equal(api.state().movements.length, 0);
  assert.equal(api.state().inventories['1:3'].existencia, 10);
  assert.equal(api.acquisitions(), 1);
  assert.deepEqual(api.events, ['commit', 'close']);
  const create = api.calls.find(c => /INSERT INTO TRANSFERENCIA/.test(c.sql));
  assert.doesNotMatch(create.sql, /\bfecha\b/);
  assert.equal(create.sql.includes(input.observacion), false);
  for (const call of api.calls) {
    for (const key of Object.keys(call.binds)) assert.match(call.sql, new RegExp(`:${key}\\b`));
    if (/^INSERT|^UPDATE/.test(call.sql)) assert.equal(call.options.autoCommit, false);
  }
});

for (const [config, code] of [
  [{ missingBranch: 1 }, 'SUCURSAL_NOT_FOUND'], [{ missingBranch: 2 }, 'SUCURSAL_NOT_FOUND'],
  [{ inactiveBranch: 1 }, 'SUCURSAL_INACTIVE'], [{ inactiveBranch: 2 }, 'SUCURSAL_INACTIVE'],
  [{ missingMedicine: 3 }, 'MEDICAMENTO_NOT_FOUND'], [{ inactiveMedicine: 3 }, 'MEDICAMENTO_INACTIVE'],
]) test(`CU-06 valida catálogos ${JSON.stringify(config)}`, async t => {
  const api = await setup(t, config);
  assert.equal((await api.request('POST', '', input)).body.code, code);
  assert.deepEqual(api.events, ['rollback', 'close']);
});

test('CU-06 valida contrato antes de adquirir conexión', async t => {
  const api = await setup(t);
  assert.equal((await api.request('POST', '', { ...input, id_sucursal_destino: 1 })).body.code, 'SAME_BRANCH_TRANSFER');
  for (const detalles of [[], null, undefined]) assert.equal((await api.request('POST', '', { ...input, detalles })).body.code, 'EMPTY_TRANSFER_DETAILS');
  for (const cantidad of [0, -1, 1.5, '5', null, 10000000000]) assert.equal((await api.request('POST', '', { ...input, detalles: [{ id_medicamento: 3, cantidad }] })).body.code, 'INVALID_QUANTITY');
  for (const field of ['id_transferencia', 'id_usuario', 'fecha', 'estado']) assert.equal((await api.request('POST', '', { ...input, [field]: 99 })).body.code, 'INVALID_INPUT');
  for (const body of [null, [], {}, { ...input, observacion: 'á'.repeat(126) }, { ...input, detalles: [null] }, { ...input, detalles: [{ id_medicamento: 3, cantidad: 5, extra: 1 }] }]) assert.equal((await api.request('POST', '', body)).status, 400);
  for (const id of [0, -1, 1.5, '3', null, 10000000000]) assert.equal((await api.request('POST', '', { ...input, id_sucursal_origen: id })).body.code, 'INVALID_ID');
  for (const path of ['/0', '/abc', '?id_sucursal_origen=0', '?id_sucursal_destino=1.5', '?id_sucursal_origen=1&id_sucursal_origen=2']) assert.equal((await api.request('GET', path)).body.code, 'INVALID_ID');
  assert.equal((await api.request('GET', '?estado=OTRO')).body.code, 'INVALID_TRANSFER_STATE');
  assert.equal(api.acquisitions(), 0);
});

test('CU-06 listado restringido por JWT y filtros parametrizados', async t => {
  const api = await setup(t);
  assert.equal((await api.request('GET', '?estado=SOLICITADA&id_sucursal_origen=1&id_sucursal_destino=2')).status, 200);
  const call = api.calls[0];
  assert.deepEqual(call.binds, { id_sucursal: 1, estado: 'SOLICITADA', id_sucursal_origen: 1, id_sucursal_destino: 2 });
  assert.match(call.sql, /id_sucursal_origen = :id_sucursal OR t.id_sucursal_destino = :id_sucursal/);
  assert.deepEqual(api.events, ['close']);
});

for (const branch of [1, 2]) test(`CU-06 lectura con detalles desde sucursal ${branch}`, async t => {
  const api = await setup(t);
  const result = await api.request('GET', '/7', undefined, branch);
  assert.equal(result.status, 200);
  assert.equal(result.body.data.detalles[0].codigo, 'MED3');
  assert.equal(result.body.data.detalles[0].cantidad, 5);
});

for (const role of [null, 'ADMINISTRADOR', 'AUDITOR', 'DESPACHO']) test(`CU-06 JWT obligatorio y rol exclusivo: ${role}`, async t => {
  const api = await setup(t);
  for (const [method, path] of [['GET', ''], ['GET', '/7'], ['POST', ''], ...['preparar', 'despachar', 'recibir', 'cancelar'].map(a => ['POST', `/7/${a}`])]) {
    assert.equal((await api.request(method, path, method === 'POST' ? input : undefined, 1, role)).status, role ? 403 : 401);
  }
  assert.equal(api.acquisitions(), 0);
});

test('CU-06 rechaza sucursal ajena, sin asignación y dirección incorrecta', async t => {
  const api = await setup(t, { state: 'DESPACHADA' });
  for (const branch of [3, null]) {
    assert.equal((await api.request('GET', '/7', undefined, branch)).body.code, 'FORBIDDEN_BRANCH');
    assert.equal((await api.request('POST', '', input, branch)).body.code, 'FORBIDDEN_BRANCH');
    for (const action of ['preparar', 'despachar', 'recibir', 'cancelar']) assert.equal((await api.request('POST', `/7/${action}`, undefined, branch)).body.code, 'FORBIDDEN_BRANCH');
  }
  for (const action of ['preparar', 'despachar', 'cancelar']) assert.equal((await api.request('POST', `/7/${action}`, undefined, 2)).body.code, 'FORBIDDEN_BRANCH');
  assert.equal((await api.request('POST', '/7/recibir', undefined, 1)).body.code, 'FORBIDDEN_BRANCH');
  assert.equal(api.state().transfer.estado, 'DESPACHADA');
});

for (const [state, action, next, branch] of [
  ['SOLICITADA', 'preparar', 'PREPARADA', 1], ['PREPARADA', 'despachar', 'DESPACHADA', 1],
  ['DESPACHADA', 'recibir', 'RECIBIDA', 2], ['SOLICITADA', 'cancelar', 'CANCELADA', 1], ['PREPARADA', 'cancelar', 'CANCELADA', 1],
]) test(`CU-06 ${state} -> ${next}`, async t => {
  const api = await setup(t, { state });
  assert.equal((await api.request('POST', `/7/${action}`, undefined, branch)).status, 200);
  assert.equal(api.state().transfer.estado, next);
  assert.deepEqual(api.events, ['commit', 'close']);
  assert.match(api.calls[0].sql, /FOR UPDATE/);
  if (action === 'preparar' || action === 'cancelar') {
    assert.equal(api.state().movements.length, 0);
    assert.equal(api.state().inventories['1:3'].existencia, 10);
  } else {
    const sending = action === 'despachar';
    const movement = api.state().movements[0];
    assert.equal(movement.id_usuario, 42);
    assert.equal(movement.tipo_movimiento, sending ? 'TRANSFERENCIA_DESPACHO' : 'TRANSFERENCIA_RECEPCION');
    assert.equal(movement.cantidad, 5);
    assert.equal(movement.saldo_anterior, sending ? 10 : 2);
    assert.equal(movement.saldo_nuevo, sending ? 5 : 7);
    assert.equal(movement.referencia, 'TRANSFERENCIA:7');
    assert.equal(api.state().inventories[`${branch}:3`].existencia, sending ? 5 : 7);
    assert.equal(api.state().inventories[`${sending ? 2 : 1}:3`].existencia, sending ? 2 : 10);
    assert.match(api.calls.find(c => /FROM INVENTARIO/.test(c.sql)).sql, /FOR UPDATE/);
    for (const c of api.calls.filter(c => /^INSERT|^UPDATE/.test(c.sql))) assert.equal(c.options.autoCommit, false);
  }
});

const transitions = { preparar: ['SOLICITADA'], despachar: ['PREPARADA'], recibir: ['DESPACHADA'], cancelar: ['SOLICITADA', 'PREPARADA'] };
for (const state of ['SOLICITADA', 'PREPARADA', 'DESPACHADA', 'RECIBIDA', 'CANCELADA']) {
  for (const [action, allowed] of Object.entries(transitions)) {
    if (allowed.includes(state)) continue;
    test(`CU-06 rechaza ${state} / ${action}`, async t => {
      const api = await setup(t, { state });
      const before = api.state();
      assert.equal((await api.request('POST', `/7/${action}`, undefined, action === 'recibir' ? 2 : 1)).body.code, 'INVALID_STATE_TRANSITION');
      assert.deepEqual(api.state(), before);
      assert.deepEqual(api.events, ['rollback', 'close']);
    });
  }
}

for (const [state, action] of [['SOLICITADA', 'preparar'], ['PREPARADA', 'despachar']]) test(`CU-06 stock insuficiente en ${action}`, async t => {
  const api = await setup(t, { state, stock: 4 });
  const before = api.state();
  assert.equal((await api.request('POST', `/7/${action}`)).body.code, 'INSUFFICIENT_STOCK');
  assert.deepEqual(api.state(), before);
  assert.deepEqual(api.events, ['rollback', 'close']);
});

test('CU-06 recepción crea inventario destino y movimiento desde cero', async t => {
  const api = await setup(t, { state: 'DESPACHADA', noDestination: true });
  assert.equal((await api.request('POST', '/7/recibir', undefined, 2)).status, 200);
  assert.equal(api.state().inventories['2:3'].existencia, 5);
  assert.equal(api.state().movements[0].saldo_anterior, 0);
  assert.equal(api.state().movements[0].saldo_nuevo, 5);
  assert.equal(api.state().movements[0].id_inventario, 33);
});

for (const action of ['despachar', 'recibir']) test(`CU-06 fallo del segundo detalle revierte íntegramente ${action}`, async t => {
  const api = await setup(t, { state: action === 'despachar' ? 'PREPARADA' : 'DESPACHADA', noDestination: true, failMovement: 2, details: [{ id_detalle: 9, id_medicamento: 4, cantidad: 3 }, { id_detalle: 8, id_medicamento: 3, cantidad: 5 }] });
  const before = api.state();
  const result = await api.request('POST', `/7/${action}`, undefined, action === 'recibir' ? 2 : 1);
  assert.equal(result.status, 500);
  assert.doesNotMatch(JSON.stringify(result.body), /ORA-|SQL|stack/);
  assert.deepEqual(api.state(), before);
  assert.deepEqual(api.events, ['rollback', 'close']);
  assert.deepEqual(api.calls.filter(c => /FROM INVENTARIO/.test(c.sql)).map(c => c.binds.id_medicamento), [3, 4]);
});

test('CU-06 medicamentos repetidos validan disponibilidad acumulada al preparar', async t => {
  const api = await setup(t, { details: [{ id_detalle: 1, id_medicamento: 3, cantidad: 6 }, { id_detalle: 2, id_medicamento: 3, cantidad: 6 }] });
  assert.equal((await api.request('POST', '/7/preparar')).body.code, 'INSUFFICIENT_STOCK');
  assert.equal(api.state().transfer.estado, 'SOLICITADA');
});

for (const [config, action, code] of [
  [{ missing: true }, 'preparar', 'TRANSFERENCIA_NOT_FOUND'],
  [{ state: 'OTRO' }, 'preparar', 'INVALID_TRANSFER_STATE'],
  [{ state: 'DESPACHADA', noDestination: true, uniqueConflict: true }, 'recibir', 'INVENTARIO_CONFLICT'],
  [{ state: 'DESPACHADA', destinationStock: 9999999999 }, 'recibir', 'INVALID_QUANTITY'],
  [{ state: 'PREPARADA', zeroInventory: true }, 'despachar', 'INVENTARIO_CONFLICT'],
  [{ zeroState: true }, 'preparar', 'TRANSFERENCIA_CONFLICT'],
]) test(`CU-06 error controlado ${code}`, async t => {
  const api = await setup(t, config);
  const before = api.state();
  assert.equal((await api.request('POST', `/7/${action}`, undefined, action === 'recibir' ? 2 : 1)).body.code, code);
  assert.deepEqual(api.state(), before);
  assert.deepEqual(api.events, ['rollback', 'close']);
});

for (const config of [{ fail: /INSERT INTO DETALLE_TRANSFERENCIA/ }, { failCommit: true }, { fail: /INSERT INTO TRANSFERENCIA/, failRollback: true }]) test(`CU-06 creación fallida libera conexión ${JSON.stringify(config)}`, async t => {
  const api = await setup(t, config);
  const before = api.state();
  assert.equal((await api.request('POST', '', input)).status, 500);
  assert.deepEqual(api.state(), before);
  assert.deepEqual(api.events, config.failCommit ? ['commit', 'rollback', 'close'] : ['rollback', 'close']);
});

test('CU-06 no expone DELETE', async t => {
  const api = await setup(t);
  assert.equal((await api.request('DELETE', '/7')).status, 404);
  assert.equal(api.acquisitions(), 0);
});

test('CU-06 ciclo completo afecta cada sucursal una sola vez', async t => {
  const api = await setup(t, { noDestination: true });
  assert.equal((await api.request('POST', '', input)).status, 201);
  assert.equal((await api.request('POST', '/7/preparar')).status, 200);
  assert.equal((await api.request('POST', '/7/despachar')).status, 200);
  assert.equal((await api.request('POST', '/7/despachar')).body.code, 'INVALID_STATE_TRANSITION');
  assert.equal((await api.request('POST', '/7/recibir', undefined, 2)).status, 200);
  assert.equal((await api.request('POST', '/7/recibir', undefined, 2)).body.code, 'INVALID_STATE_TRANSITION');
  assert.equal(api.state().transfer.estado, 'RECIBIDA');
  assert.equal(api.state().inventories['1:3'].existencia, 5);
  assert.equal(api.state().inventories['2:3'].existencia, 5);
  assert.equal(api.state().movements.length, 2);
});

test('CU-06 stock consumido después de preparar impide despacho sin escrituras', async t => {
  const api = await setup(t);
  assert.equal((await api.request('POST', '/7/preparar')).status, 200);
  api.setStock(1, 3, 4);
  const before = api.state();
  api.calls.length = 0;
  assert.equal((await api.request('POST', '/7/despachar')).body.code, 'INSUFFICIENT_STOCK');
  assert.deepEqual(api.state(), before);
  assert.equal(api.state().transfer.estado, 'PREPARADA');
  assert.equal(api.calls.some(c => /^UPDATE|^INSERT/.test(c.sql)), false);
});

for (const action of ['despachar', 'recibir']) {
  for (const config of [{ fail: /UPDATE TRANSFERENCIA/ }, { failCommit: true }]) {
    test(`CU-06 revierte inventario y movimientos por fallo final en ${action}: ${JSON.stringify(config)}`, async t => {
      const api = await setup(t, { ...config, state: action === 'despachar' ? 'PREPARADA' : 'DESPACHADA' });
      const before = api.state();
      assert.equal((await api.request('POST', `/7/${action}`, undefined, action === 'recibir' ? 2 : 1)).status, 500);
      assert.ok(api.calls.some(c => /INSERT INTO MOVIMIENTO_INVENTARIO/.test(c.sql)));
      assert.deepEqual(api.state(), before);
      assert.equal(api.events.at(-1), 'close');
      assert.ok(api.events.includes('rollback'));
    });
  }
}

test('CU-06 detalles repetidos conservan un movimiento por detalle y saldos consecutivos', async t => {
  const api = await setup(t, { state: 'PREPARADA', noDestination: true, details: [{ id_detalle: 1, id_medicamento: 3, cantidad: 4 }, { id_detalle: 2, id_medicamento: 3, cantidad: 6 }] });
  assert.equal((await api.request('POST', '/7/despachar')).status, 200);
  assert.equal((await api.request('POST', '/7/recibir', undefined, 2)).status, 200);
  assert.deepEqual(api.state().movements.map(m => [m.saldo_anterior, m.saldo_nuevo]), [[10, 6], [6, 0], [0, 4], [4, 10]]);
  assert.equal(api.calls.filter(c => /INSERT INTO INVENTARIO/.test(c.sql)).length, 1);
});

test('CU-06 lectura inexistente y fallo de consulta liberan conexión', async t => {
  const api = await setup(t, { missing: true });
  assert.equal((await api.request('GET', '/7')).body.code, 'TRANSFERENCIA_NOT_FOUND');
  assert.deepEqual(api.events, ['close']);
});

test('CU-06 error interno de consulta no filtra Oracle', async t => {
  const api = await setup(t, { fail: /FROM TRANSFERENCIA/ });
  const result = await api.request('GET');
  assert.equal(result.status, 500);
  assert.doesNotMatch(JSON.stringify(result.body), /ORA-|SQL|stack/);
  assert.deepEqual(api.events, ['close']);
});

test('CU-06 acciones rechazan cuerpos que intentan sobrescribir estado o usuario', async t => {
  const api = await setup(t);
  for (const body of [{ estado: 'RECIBIDA' }, { id_usuario: 99 }, [], null]) {
    assert.equal((await api.request('POST', '/7/preparar', body)).status, 400);
  }
  assert.equal(api.acquisitions(), 0);
});

test('CU-06 disponibilidad acumulada rechaza segundo medicamento sin descuentos parciales', async t => {
  const api = await setup(t, { state: 'PREPARADA', details: [{ id_detalle: 1, id_medicamento: 3, cantidad: 5 }, { id_detalle: 2, id_medicamento: 4, cantidad: 11 }] });
  const before = api.state();
  assert.equal((await api.request('POST', '/7/despachar')).body.code, 'INSUFFICIENT_STOCK');
  assert.deepEqual(api.state(), before);
  assert.equal(api.calls.some(c => /^UPDATE|^INSERT/.test(c.sql)), false);
});
