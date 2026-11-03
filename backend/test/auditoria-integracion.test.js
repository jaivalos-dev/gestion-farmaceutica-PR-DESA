const { startTestServer } = require('../test-support/testServer');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const pool = require('../src/database/pool');
const tokens = require('../src/shared/tokens');

async function setup(t, config = {}) {
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  let state = { inventory: config.initial ? null : { id_inventario: 8, existencia: 10 },
    branch: { id_sucursal: 2, nombre: 'Sucursal', tipo_sucursal: 'FARMACIA', departamento: 'Guatemala', municipio: 'Guatemala', direccion: 'Centro', activa: 'S' },
    medicine: { id_medicamento: 3, codigo: 'MED3', nombre: 'Medicina', categoria: 'General', presentacion: 'Caja', precio: 10, activo: 'S' },
    movements: [], audit: [] };
  const calls = [], events = [];
  let acquisitions = 0;
  t.mock.method(pool, 'getConnection', async () => {
    acquisitions++;
    const pending = structuredClone(state);
    return {
      execute: async (sql, binds, options) => {
        calls.push({ sql, binds, options });
        if (/INSERT INTO AUDITORIA\b/.test(sql)) {
          if (config.failAudit) throw new Error('ORA-99999 SQL privado');
          pending.audit.push({ ...binds });
          return { rowsAffected: 1 };
        }
        if (/INSERT INTO MOVIMIENTO_INVENTARIO\b/.test(sql)) {
          pending.movements.push({ ...binds });
          return { outBinds: { id: [9] } };
        }
        if (/INSERT INTO INVENTARIO\b/.test(sql)) {
          pending.inventory = { id_inventario: 8, existencia: binds.existencia };
          return { outBinds: { id: [8] } };
        }
        if (/UPDATE INVENTARIO\b/.test(sql)) { pending.inventory.existencia = binds.existencia; return { rowsAffected: 1 }; }
        for (const [table, key, idField, id] of [['SUCURSAL', 'branch', 'id_sucursal', 2], ['MEDICAMENTO', 'medicine', 'id_medicamento', 3]]) {
          if (new RegExp(`INSERT INTO ${table}\\b`).test(sql)) {
            const { id: out, ...data } = binds;
            pending[key] = { ...data, [idField]: id };
            return { outBinds: { id: [id] } };
          }
          if (new RegExp(`UPDATE ${table}\\b`).test(sql)) {
            const { id: target, ...data } = binds;
            Object.assign(pending[key], data);
            return { rowsAffected: 1 };
          }
          if (new RegExp(`FROM ${table}\\b`).test(sql)) return { rows: [{ ...pending[key] }] };
        }
        if (/FROM INVENTARIO\b/.test(sql)) return { rows: pending.inventory ? [{ ...pending.inventory }] : [] };
        throw new Error('SQL no simulado');
      },
      commit: async () => { events.push('commit'); state = pending; },
      rollback: async () => events.push('rollback'),
      close: async () => events.push('close'),
    };
  });
  const server = await startTestServer();
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { calls, events, state: () => structuredClone(state), acquisitions: () => acquisitions,
    request: async (path, body, method = 'POST', role = 'ADMINISTRADOR') => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/${path}`, {
        method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.sign({ id_usuario: 42, id_rol: 9, nombre_rol: role, id_sucursal: 2 })}` },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    } };
}

const input = { id_sucursal: 2, id_medicamento: 3, tipo_movimiento: 'ENTRADA', cantidad: 4,
  referencia: 'password password_hash token Authorization' };

for (const [type, balance] of [['ENTRADA', 14], ['SALIDA', 6], ['AJUSTE', 14]]) {
  test(`CU-14 ${type} confirma saldo, movimiento y evento juntos`, async t => {
    const api = await setup(t);
    assert.equal((await api.request('inventario/ajustes', { ...input, tipo_movimiento: type })).status, 201);
    const state = api.state();
    assert.equal(state.inventory.existencia, balance);
    assert.equal(state.movements.length, 1);
    assert.equal(state.audit.length, 1);
    assert.deepEqual(Object.fromEntries(Object.entries(state.audit[0]).filter(([key]) => key !== 'descripcion')),
      { id_usuario: 42, id_sucursal: 2, modulo: 'INVENTARIO', accion: type, entidad: 'INVENTARIO', id_entidad: 8 });
    assert.match(state.audit[0].descripcion, new RegExp(`10 -> ${balance}`));
    assert.doesNotMatch(state.audit[0].descripcion, /password|password_hash|token|Authorization/);
    assert.equal(api.acquisitions(), 1);
    assert.deepEqual(api.events, ['commit', 'close']);
    const movement = api.calls.findIndex(call => /INSERT INTO MOVIMIENTO_INVENTARIO/.test(call.sql));
    const audit = api.calls.findIndex(call => /INSERT INTO AUDITORIA/.test(call.sql));
    assert.ok(audit > movement);
  });
}

for (const initial of [false, true]) test(`CU-14 fallo de auditoría revierte inventario ${initial ? 'nuevo' : 'existente'} y movimiento`, async t => {
  const api = await setup(t, { initial, failAudit: true });
  const before = api.state();
  const result = await api.request('inventario/ajustes', input);
  assert.equal(result.status, 500);
  assert.equal(result.body.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify(result.body), /ORA-|SQL privado|stack/);
  assert.deepEqual(api.state(), before);
  assert.equal(api.acquisitions(), 1);
  assert.deepEqual(api.events, ['rollback', 'close']);
  assert.ok(api.calls.some(call => /INSERT INTO MOVIMIENTO_INVENTARIO/.test(call.sql)));
  assert.ok(api.calls.some(call => /INSERT INTO AUDITORIA/.test(call.sql)));
});

test('CU-14 entrada inicial audita el inventario generado', async t => {
  const api = await setup(t, { initial: true });
  assert.equal((await api.request('inventario/ajustes', input)).status, 201);
  assert.equal(api.state().audit[0].id_entidad, 8);
  assert.match(api.state().audit[0].descripcion, /0 -> 4/);
});

for (const [module, key, entity, id, branch, stateField] of [
  ['sucursales', 'branch', 'SUCURSAL', 2, 2, 'activa'],
  ['medicamentos', 'medicine', 'MEDICAMENTO', 3, null, 'activo'],
]) {
  for (const method of ['POST', 'PUT', 'PATCH']) {
    for (const failAudit of [false, true]) test(`CU-14 ${module} ${method} ${failAudit ? 'revierte ante fallo' : 'audita actor y entidad'}`, async t => {
      const api = await setup(t, { failAudit });
      const before = api.state();
      const body = { ...before[key], nombre: 'password password_hash token Authorization' };
      delete body[`id_${entity.toLowerCase()}`];
      const path = `${module}${method === 'POST' ? '' : `/${id}${method === 'PATCH' ? '/estado' : ''}`}`;
      const result = await api.request(path, method === 'PATCH' ? { [stateField]: 'N' } : body, method);
      assert.equal(result.status, failAudit ? 500 : method === 'POST' ? 201 : 200);
      assert.equal(api.acquisitions(), 1);
      assert.deepEqual(api.events, [failAudit ? 'rollback' : 'commit', 'close']);
      if (failAudit) {
        assert.deepEqual(api.state(), before);
      } else {
        const events = api.state().audit;
        assert.equal(events.length, 1);
        assert.equal(events[0].modulo, module.toUpperCase());
        assert.equal(events[0].entidad, entity);
        assert.equal(events[0].id_entidad, id);
        assert.equal(events[0].id_usuario, 42);
        assert.equal(events[0].id_sucursal, branch);
        assert.equal(events[0].accion, method === 'POST' ? 'CREAR' : 'MODIFICAR');
        assert.doesNotMatch(events[0].descripcion, /password|password_hash|token|Authorization/);
      }
    });
  }
}
