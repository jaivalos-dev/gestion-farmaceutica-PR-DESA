const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const pool = require('../src/database/pool');
const tokens = require('../src/shared/tokens');

const input = { forma_pago: 'EFECTIVO', detalles: [{ id_medicamento: 3, cantidad: 2 }, { id_medicamento: 4, cantidad: 1 }] };

for (const confirming of [false, true]) {
  test(`CU-14 venta ${confirming ? 'confirmar' : 'crear'} registra un evento sin duplicar caja/inventario`, async t => {
    const api = await setup(t);
    const result = await api.request('POST', confirming ? '/7/confirmar' : '', confirming ? undefined : input);
    assert.equal(result.status, confirming ? 200 : 201);
    assert.equal(api.audit().length, 1);
    const event = api.audit()[0];
    assert.deepEqual([event.modulo, event.accion, event.entidad, event.id_entidad, event.id_usuario, event.id_sucursal],
      ['VENTAS', confirming ? 'CONFIRMAR' : 'CREAR', 'VENTA', 7, 42, 1]);
    if (confirming) {
      assert.match(event.descripcion, /0\.40/);
      assert.equal(api.state().movements.length, 2);
      assert.equal(api.state().cash.length, 1);
      assert.equal(api.state().sale.estado, 'CONFIRMADA');
    }
    assert.equal(api.acquisitions(), 1);
    assert.deepEqual(api.events, ['commit', 'close']);
  });
  test(`CU-14 fallo auditoría revierte venta ${confirming ? 'confirmada con stock y caja' : 'creada con detalles'}`, async t => {
    const api = await setup(t, { fail: /INSERT INTO AUDITORIA\b/ });
    const before = api.state();
    const result = await api.request('POST', confirming ? '/7/confirmar' : '', confirming ? undefined : input);
    assert.equal(result.status, 500);
    assert.deepEqual(api.state(), before);
    assert.deepEqual(api.audit(), []);
    assert.equal(api.acquisitions(), 1);
    assert.deepEqual(api.events, ['rollback', 'close']);
    if (confirming) {
      for (const pattern of [/UPDATE INVENTARIO/, /INSERT INTO MOVIMIENTO_INVENTARIO/, /INSERT INTO MOVIMIENTO_CAJA/, /UPDATE VENTA/]) {
        assert.ok(api.calls.some(call => pattern.test(call.sql)));
      }
    }
  });
}

// Solo se sustituye el driver; rutas, servicios, repositories y transacciones son reales.
async function setup(t, config = {}) {
  let audit = [];
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  let state = {
    sale: config.missingSale ? null : { id_venta: 7, id_sucursal: 1, id_usuario: 10, fecha: '2026-10-27', forma_pago: 'EFECTIVO', estado: config.state || 'CREADA', total: config.total ?? 0.4 },
    details: config.details || [{ id_detalle: 8, id_medicamento: 3, cantidad: 2, precio_unitario: 0.1, subtotal: 0.2, medicamento: 'Medicina A', codigo: 'MED3' }, { id_detalle: 9, id_medicamento: 4, cantidad: 1, precio_unitario: 0.2, subtotal: 0.2, medicamento: 'Medicina B', codigo: 'MED4' }],
    inventories: { 3: { id_inventario: 13, existencia: config.stock ?? 10 }, 4: { id_inventario: 14, existencia: 10 } },
    movements: [], cash: [],
  };
  if (config.missingInventory) delete state.inventories[config.missingInventory];
  const prices = { 3: config.price ?? 0.1, 4: config.price2 ?? 0.2 };
  const calls = [], events = [];
  let acquisitions = 0;
  t.mock.method(pool, 'getConnection', async () => {
    acquisitions++;
    const pending = structuredClone(state);
    const pendingAudit = structuredClone(audit);
    let updates = 0, movements = 0;
    return {
      execute: async (sql, binds, options) => {
        calls.push({ sql, binds, options });
        if (config.fail?.test(sql)) throw new Error('ORA-99999 SQL privado');
        if (/INSERT INTO AUDITORIA\b/.test(sql)) { pendingAudit.push({ ...binds }); return { rowsAffected: 1 }; }
        if (/^SELECT/.test(sql.trim())) {
          if (/FROM SUCURSAL/.test(sql)) return { rows: config.missingBranch ? [] : [{ activa: config.inactiveBranch ? 'N' : 'S' }] };
          if (/FROM MEDICAMENTO/.test(sql)) return { rows: binds.id === config.missingMedicine ? [] : [{ id_medicamento: binds.id, activo: binds.id === config.inactiveMedicine ? 'N' : 'S', precio: prices[binds.id] }] };
          if (/FROM DETALLE_VENTA/.test(sql)) return { rows: structuredClone(pending.details).sort((a, b) => a.id_medicamento - b.id_medicamento) };
          if (/FROM INVENTARIO/.test(sql)) return { rows: pending.inventories[binds.id_medicamento] ? [structuredClone(pending.inventories[binds.id_medicamento])] : [] };
          if (/FROM VENTA/.test(sql)) return { rows: pending.sale ? [structuredClone(pending.sale)] : [] };
        }
        if (/INSERT INTO VENTA/.test(sql)) {
          pending.sale = { id_venta: 7, fecha: '2026-10-27', ...Object.fromEntries(Object.entries(binds).filter(([k]) => k !== 'id')) };
          pending.details = [];
          return { outBinds: { id: [7] } };
        }
        if (/INSERT INTO DETALLE_VENTA/.test(sql)) { pending.details.push({ ...binds }); return { rowsAffected: 1 }; }
        if (/UPDATE INVENTARIO/.test(sql)) {
          if (++updates === config.failInventory) throw new Error('ORA-99999 SQL privado');
          Object.values(pending.inventories).find(i => i.id_inventario === binds.id_inventario).existencia = binds.existencia;
          return { rowsAffected: config.zeroInventory ? 0 : 1 };
        }
        if (/INSERT INTO MOVIMIENTO_INVENTARIO/.test(sql)) {
          if (++movements === config.failMovement) throw new Error('ORA-99999 SQL privado');
          pending.movements.push({ ...binds });
          return { outBinds: { id: [movements] } };
        }
        if (/INSERT INTO MOVIMIENTO_CAJA/.test(sql)) { pending.cash.push({ ...binds }); return { rowsAffected: 1 }; }
        if (/UPDATE VENTA/.test(sql)) { pending.sale.estado = binds.estado; return { rowsAffected: config.zeroSale ? 0 : 1 }; }
        throw new Error(`SQL no simulado: ${sql}`);
      },
      commit: async () => { events.push('commit'); if (config.failCommit) throw new Error('commit failed'); state = pending; audit = pendingAudit; },
      rollback: async () => { events.push('rollback'); if (config.failRollback) throw new Error('rollback failed'); },
      close: async () => events.push('close'),
    };
  });
  const server = require('../src/app').createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { audit: () => structuredClone(audit), calls, events, state: () => structuredClone(state), acquisitions: () => acquisitions,
    setPrice: (id, value) => { prices[id] = value; },
    setStock: (id, value) => { state.inventories[id].existencia = value; },
    request: async (method = 'GET', path = '', body, branch = 1, role = 'ENCARGADO') => {
      const headers = { 'Content-Type': 'application/json' };
      if (role) headers.Authorization = `Bearer ${tokens.sign({ id_usuario: 42, id_rol: 2, nombre_rol: role, id_sucursal: branch })}`;
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ventas${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    },
  };
}

for (const payment of ['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'OTRO']) test(`CU-07 crea venta ${payment} con precio Oracle y contexto JWT`, async t => {
  const api = await setup(t);
  const result = await api.request('POST', '', { ...input, forma_pago: payment });
  assert.equal(result.status, 201);
  assert.equal(result.body.data.estado, 'CREADA');
  assert.equal(result.body.data.id_sucursal, 1);
  assert.equal(result.body.data.id_usuario, 42);
  assert.equal(result.body.data.forma_pago, payment);
  assert.equal(result.body.data.total, 0.4);
  assert.deepEqual(api.state().details.map(d => [d.precio_unitario, d.subtotal]), [[0.1, 0.2], [0.2, 0.2]]);
  assert.equal(api.state().movements.length, 0);
  assert.equal(api.state().cash.length, 0);
  assert.equal(api.state().inventories[3].existencia, 10);
  assert.equal(api.calls.some(c => /FROM INVENTARIO|UPDATE INVENTARIO/.test(c.sql)), false);
  assert.equal(api.acquisitions(), 1);
  assert.deepEqual(api.events, ['commit', 'close']);
  assert.doesNotMatch(api.calls.find(c => /INSERT INTO VENTA/.test(c.sql)).sql, /\bfecha\b/);
  for (const c of api.calls) {
    for (const key of Object.keys(c.binds)) assert.match(c.sql, new RegExp(`:${key}\\b`));
    if (/^INSERT/.test(c.sql)) assert.equal(c.options.autoCommit, false);
  }
});

test('CU-07 consolida medicamentos repetidos antes de persistir', async t => {
  const api = await setup(t);
  const result = await api.request('POST', '', { forma_pago: 'EFECTIVO', detalles: [{ id_medicamento: 3, cantidad: 1 }, { id_medicamento: 3, cantidad: 2 }] });
  assert.equal(result.status, 201);
  assert.equal(api.state().details.length, 1);
  assert.equal(api.state().details[0].cantidad, 3);
  assert.equal(api.state().details[0].subtotal, 0.3);
  assert.equal(api.state().sale.total, 0.3);
});

for (const role of [null, 'ADMINISTRADOR', 'AUDITOR', 'DESPACHO']) test(`CU-07 protege todas las rutas: ${role}`, async t => {
  const api = await setup(t);
  for (const [method, path] of [['GET', ''], ['GET', '/7'], ['POST', ''], ['POST', '/7/confirmar']]) {
    assert.equal((await api.request(method, path, method === 'POST' ? input : undefined, 1, role)).status, role ? 403 : 401);
  }
  assert.equal(api.acquisitions(), 0);
});

test('CU-07 ENCARGADO sin sucursal no adquiere conexión', async t => {
  const api = await setup(t);
  for (const [method, path, body] of [['GET', ''], ['GET', '/7'], ['POST', '', input], ['POST', '/7/confirmar']]) {
    assert.equal((await api.request(method, path, body, null)).body.code, 'FORBIDDEN_BRANCH');
  }
  assert.equal(api.acquisitions(), 0);
});

test('CU-07 rechaza datos inválidos y campos protegidos antes de Oracle', async t => {
  const api = await setup(t);
  for (const forma_pago of ['efectivo', 'CHEQUE', null, 1, "' OR 1=1 --"]) assert.equal((await api.request('POST', '', { ...input, forma_pago })).body.code, 'INVALID_PAYMENT_METHOD');
  for (const detalles of [[], null, undefined]) assert.equal((await api.request('POST', '', { ...input, detalles })).body.code, 'EMPTY_SALE_DETAILS');
  for (const cantidad of [0, -1, 1.5, '2', null, 10000000000]) assert.equal((await api.request('POST', '', { ...input, detalles: [{ id_medicamento: 3, cantidad }] })).body.code, 'INVALID_QUANTITY');
  for (const id_medicamento of [0, -1, 1.5, '3', null, 10000000000]) assert.equal((await api.request('POST', '', { ...input, detalles: [{ id_medicamento, cantidad: 1 }] })).body.code, 'INVALID_ID');
  for (const field of ['id_venta', 'id_sucursal', 'id_usuario', 'fecha', 'estado', 'total', 'precio_unitario', 'subtotal']) assert.equal((await api.request('POST', '', { ...input, [field]: 9 })).body.code, 'INVALID_INPUT');
  for (const field of ['precio_unitario', 'subtotal', 'id_detalle', 'id_venta']) assert.equal((await api.request('POST', '', { ...input, detalles: [{ ...input.detalles[0], [field]: 9 }] })).body.code, 'INVALID_INPUT');
  for (const body of [null, [], {}, { ...input, detalles: [null] }]) assert.equal((await api.request('POST', '', body)).status, 400);
  for (const path of ['/0', '/abc', '/1.5', '/10000000000']) {
    assert.equal((await api.request('GET', path)).body.code, 'INVALID_ID');
    assert.equal((await api.request('POST', `${path}/confirmar`)).body.code, 'INVALID_ID');
  }
  assert.equal((await api.request('POST', '', { ...input, detalles: [{ id_medicamento: 3, cantidad: 9999999999 }, { id_medicamento: 3, cantidad: 1 }] })).body.code, 'INVALID_QUANTITY');
  assert.equal(api.acquisitions(), 0);
});

for (const [config, code] of [
  [{ missingBranch: true }, 'SUCURSAL_NOT_FOUND'], [{ inactiveBranch: true }, 'SUCURSAL_INACTIVE'],
  [{ missingMedicine: 3 }, 'MEDICAMENTO_NOT_FOUND'], [{ inactiveMedicine: 4 }, 'MEDICAMENTO_INACTIVE'],
]) {
  for (const creating of [true, false]) test(`CU-07 ${creating ? 'crear' : 'confirmar'} valida ${code}`, async t => {
    const api = await setup(t, config);
    const before = api.state();
    assert.equal((await api.request('POST', creating ? '' : '/7/confirmar', creating ? input : undefined)).body.code, code);
    assert.deepEqual(api.state(), before);
    assert.deepEqual(api.events, ['rollback', 'close']);
  });
}

test('CU-07 listado filtra exclusivamente por sucursal JWT y consulta detalle propio', async t => {
  const api = await setup(t);
  assert.equal((await api.request('GET', '?id_sucursal=2')).status, 200);
  assert.deepEqual(api.calls[0].binds, { id_sucursal: 1 });
  assert.match(api.calls[0].sql, /WHERE .*id_sucursal = :id_sucursal/);
  const result = await api.request('GET', '/7');
  assert.equal(result.status, 200);
  assert.equal(result.body.data.detalles[0].codigo, 'MED3');
  assert.equal(result.body.data.detalles[0].medicamento, 'Medicina A');
  assert.equal(result.body.data.detalles[0].precio_unitario, 0.1);
  assert.deepEqual(api.events, ['close', 'close']);
});

for (const method of ['GET', 'POST']) test(`CU-07 ${method} rechaza venta ajena`, async t => {
  const api = await setup(t);
  const before = api.state();
  assert.equal((await api.request(method, method === 'GET' ? '/7' : '/7/confirmar', undefined, 2)).body.code, 'FORBIDDEN_BRANCH');
  assert.deepEqual(api.state(), before);
  assert.equal(api.calls.some(c => /^INSERT|^UPDATE/.test(c.sql)), false);
});

for (const method of ['GET', 'POST']) test(`CU-07 ${method} venta inexistente`, async t => {
  const api = await setup(t, { missingSale: true });
  assert.equal((await api.request(method, method === 'GET' ? '/7' : '/7/confirmar')).body.code, 'VENTA_NOT_FOUND');
  assert.equal(api.events.at(-1), 'close');
});

test('CU-07 confirmar descuenta exactamente, registra VENTA y un INGRESO en una transacción', async t => {
  const api = await setup(t);
  const result = await api.request('POST', '/7/confirmar');
  assert.equal(result.status, 200);
  assert.equal(result.body.data.estado, 'CONFIRMADA');
  assert.equal(api.state().inventories[3].existencia, 8);
  assert.equal(api.state().inventories[4].existencia, 9);
  assert.deepEqual(api.state().movements.map(m => [m.id_inventario, m.id_usuario, m.tipo_movimiento, m.cantidad, m.saldo_anterior, m.saldo_nuevo, m.referencia]), [[13, 42, 'VENTA', 2, 10, 8, 'VENTA:7'], [14, 42, 'VENTA', 1, 10, 9, 'VENTA:7']]);
  assert.equal(api.state().cash.length, 1);
  assert.deepEqual(api.state().cash[0], { id_sucursal: 1, id_usuario: 42, id_venta: 7, tipo: 'INGRESO', monto: 0.4, concepto: 'Venta 7' });
  assert.equal(api.acquisitions(), 1);
  assert.deepEqual(api.events, ['commit', 'close']);
  assert.match(api.calls[0].sql, /FROM VENTA.*FOR UPDATE/s);
  const locks = api.calls.filter(c => /FROM INVENTARIO/.test(c.sql));
  assert.deepEqual(locks.map(c => c.binds.id_medicamento), [3, 4]);
  for (const c of locks) assert.match(c.sql, /FOR UPDATE/);
  const firstUpdate = api.calls.findIndex(c => /UPDATE INVENTARIO/.test(c.sql));
  assert.ok(firstUpdate > api.calls.findLastIndex(c => /FROM INVENTARIO/.test(c.sql)));
  assert.ok(api.calls.findIndex(c => /UPDATE VENTA/.test(c.sql)) > api.calls.findIndex(c => /INSERT INTO MOVIMIENTO_CAJA/.test(c.sql)));
  for (const c of api.calls) {
    for (const key of Object.keys(c.binds)) assert.match(c.sql, new RegExp(`:${key}\\b`));
    if (/^INSERT|^UPDATE/.test(c.sql)) assert.equal(c.options.autoCommit, false);
  }
});

test('CU-07 rechaza segunda confirmación sin nuevos efectos', async t => {
  const api = await setup(t);
  assert.equal((await api.request('POST', '/7/confirmar')).status, 200);
  const before = api.state();
  api.calls.length = 0;
  assert.equal((await api.request('POST', '/7/confirmar')).body.code, 'INVALID_SALE_STATE');
  assert.deepEqual(api.state(), before);
  assert.equal(api.calls.length, 1);
});

for (const [config, code] of [
  [{ state: 'ANULADA' }, 'INVALID_SALE_STATE'], [{ state: 'OTRO' }, 'INVALID_SALE_STATE'],
  [{ missingInventory: 4 }, 'INVENTARIO_NOT_FOUND'], [{ stock: 1 }, 'INSUFFICIENT_STOCK'],
  [{ total: 0 }, 'INVALID_TOTAL'], [{ details: [] }, 'EMPTY_SALE_DETAILS'],
]) test(`CU-07 confirma solo datos válidos: ${JSON.stringify(config)}`, async t => {
  const api = await setup(t, config);
  const before = api.state();
  assert.equal((await api.request('POST', '/7/confirmar')).body.code, code);
  assert.deepEqual(api.state(), before);
  assert.deepEqual(api.events, ['rollback', 'close']);
  assert.equal(api.calls.some(c => /^INSERT|^UPDATE/.test(c.sql)), false);
});

for (const config of [
  { failInventory: 2 }, { failMovement: 2 }, { fail: /INSERT INTO MOVIMIENTO_CAJA/ },
  { fail: /UPDATE VENTA/ }, { failCommit: true }, { failInventory: 1, failRollback: true },
]) test(`CU-07 rollback total y errores sanitizados ${JSON.stringify(config)}`, async t => {
  const api = await setup(t, config);
  const before = api.state();
  const result = await api.request('POST', '/7/confirmar');
  assert.equal(result.status, 500);
  assert.equal(result.body.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify(result.body), /ORA-|SQL|stack|privado/);
  assert.deepEqual(api.state(), before);
  assert.equal(api.state().sale.estado, 'CREADA');
  assert.deepEqual(api.events, config.failCommit ? ['commit', 'rollback', 'close'] : ['rollback', 'close']);
});

for (const config of [{ zeroInventory: true }, { zeroSale: true }]) test(`CU-07 filas no actualizadas revierten efectos ${JSON.stringify(config)}`, async t => {
  const api = await setup(t, config);
  const before = api.state();
  assert.equal((await api.request('POST', '/7/confirmar')).status, 409);
  assert.deepEqual(api.state(), before);
  assert.deepEqual(api.events, ['rollback', 'close']);
});

test('CU-07 creación fallida revierte cabecera y detalles', async t => {
  const api = await setup(t, { fail: /INSERT INTO DETALLE_VENTA/ });
  const before = api.state();
  assert.equal((await api.request('POST', '', input)).status, 500);
  assert.deepEqual(api.state(), before);
  assert.deepEqual(api.events, ['rollback', 'close']);
});

test('CU-07 precio histórico no cambia al confirmar y stock se vuelve a leer', async t => {
  const api = await setup(t);
  assert.equal((await api.request('POST', '', input)).status, 201);
  api.setPrice(3, 999);
  api.setStock(3, 1);
  assert.equal((await api.request('POST', '/7/confirmar')).body.code, 'INSUFFICIENT_STOCK');
  assert.equal(api.state().sale.estado, 'CREADA');
  api.setStock(3, 2);
  assert.equal((await api.request('POST', '/7/confirmar')).status, 200);
  assert.equal(api.state().sale.total, 0.4);
  assert.equal(api.state().details[0].precio_unitario, 0.1);
  assert.equal(api.state().cash[0].monto, 0.4);
  assert.equal(api.state().inventories[3].existencia, 0);
});

for (const [price, quantity, expected] of [[0.29, 3, 0.87], [99999999.99, 100, 9999999999], [0.01, 9999999999, 99999999.99]]) test(`CU-07 aritmética exacta ${price} x ${quantity}`, async t => {
  const api = await setup(t, { price });
  const result = await api.request('POST', '', { forma_pago: 'EFECTIVO', detalles: [{ id_medicamento: 3, cantidad: quantity }] });
  assert.equal(result.status, 201);
  assert.equal(api.state().sale.total, expected);
  assert.equal(api.state().details[0].subtotal, expected);
});

test('CU-07 rechaza desbordamiento subtotal y total NUMBER(12,2)', async t => {
  const api = await setup(t, { price: 99999999.99, price2: 99999999.99 });
  for (const detalles of [[{ id_medicamento: 3, cantidad: 101 }], [{ id_medicamento: 3, cantidad: 100 }, { id_medicamento: 4, cantidad: 1 }]]) {
    assert.equal((await api.request('POST', '', { forma_pago: 'EFECTIVO', detalles })).body.code, 'INVALID_TOTAL');
  }
  assert.equal(api.calls.some(c => /^INSERT/.test(c.sql)), false);
});

test('CU-07 venta de precio cero se crea pero no puede confirmarse', async t => {
  const api = await setup(t, { price: 0 });
  assert.equal((await api.request('POST', '', { forma_pago: 'EFECTIVO', detalles: [{ id_medicamento: 3, cantidad: 1 }] })).status, 201);
  assert.equal((await api.request('POST', '/7/confirmar')).body.code, 'INVALID_TOTAL');
  assert.equal(api.state().cash.length, 0);
});

test('CU-07 no implementa DELETE, anulación ni actualización genérica', async t => {
  const api = await setup(t);
  for (const [method, path] of [['DELETE', '/7'], ['POST', '/7/anular'], ['PATCH', '/7/estado'], ['PUT', '/7']]) assert.equal((await api.request(method, path)).status, 404);
  assert.equal(api.acquisitions(), 0);
});

test('CU-07 confirmar no acepta campos en el cuerpo', async t => {
  const api = await setup(t);
  for (const body of [null, [], { total: 1 }, { estado: 'CONFIRMADA' }]) assert.equal((await api.request('POST', '/7/confirmar', body)).status, 400);
  assert.equal(api.acquisitions(), 0);
});

test('CU-07 error de lectura libera conexión y oculta Oracle', async t => {
  const api = await setup(t, { fail: /FROM VENTA/ });
  const result = await api.request('GET');
  assert.equal(result.status, 500);
  assert.doesNotMatch(JSON.stringify(result.body), /ORA-|SQL|stack/);
  assert.deepEqual(api.events, ['close']);
});

test('CU-07 entrada desordenada persiste y bloquea por medicamento ascendente', async t => {
  const api = await setup(t);
  assert.equal((await api.request('POST', '', { ...input, detalles: [...input.detalles].reverse() })).status, 201);
  assert.deepEqual(api.state().details.map(d => d.id_medicamento), [3, 4]);
  assert.equal((await api.request('POST', '/7/confirmar')).status, 200);
  assert.deepEqual(api.calls.filter(c => /FROM INVENTARIO/.test(c.sql)).map(c => c.binds.id_medicamento), [3, 4]);
});

test('CU-07 stock insuficiente en segundo medicamento no realiza escrituras', async t => {
  const api = await setup(t);
  api.setStock(4, 0);
  const before = api.state();
  assert.equal((await api.request('POST', '/7/confirmar')).body.code, 'INSUFFICIENT_STOCK');
  assert.deepEqual(api.state(), before);
  assert.equal(api.calls.some(c => /^INSERT|^UPDATE/.test(c.sql)), false);
});

test('CU-07 consolidación produce un movimiento por medicamento', async t => {
  const api = await setup(t);
  assert.equal((await api.request('POST', '', { ...input, detalles: [input.detalles[0], input.detalles[0]] })).status, 201);
  assert.equal((await api.request('POST', '/7/confirmar')).status, 200);
  assert.equal(api.state().movements.length, 1);
  assert.equal(api.state().movements[0].cantidad, 4);
  assert.equal(api.state().inventories[3].existencia, 6);
  assert.equal(api.state().cash[0].monto, 0.4);
});

for (const price of [-1, 100000000, 0.001]) test(`CU-07 rechaza precio fuera de NUMBER(10,2): ${price}`, async t => {
  const api = await setup(t, { price });
  assert.equal((await api.request('POST', '', input)).body.code, 'INVALID_TOTAL');
  assert.deepEqual(api.events, ['rollback', 'close']);
  assert.equal(api.calls.some(c => /^INSERT/.test(c.sql)), false);
});

test('CU-07 total máximo NUMBER(12,2) conserva sus centavos', async t => {
  const api = await setup(t, { price: 99999999.99, price2: 0.99 });
  assert.equal((await api.request('POST', '', { ...input, detalles: [{ id_medicamento: 3, cantidad: 100 }, { id_medicamento: 4, cantidad: 1 }] })).status, 201);
  assert.equal(api.state().sale.total, 9999999999.99);
  api.setStock(3, 100);
  assert.equal((await api.request('POST', '/7/confirmar')).status, 200);
  assert.equal(api.state().cash[0].monto, 9999999999.99);
});
