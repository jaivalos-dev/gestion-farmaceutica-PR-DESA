const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const oracledb = require('oracledb');
const pool = require('../src/database/pool');
const tokens = require('../src/shared/tokens');
const { startTestServer } = require('../test-support/testServer');

const globalRow = {
  unidades: 125, registros: 3, ingresos: 200, egresos: 50, saldo: 150,
  cantidad_confirmadas: 2, monto_confirmado: 200, cantidad_activos: 3, valor_total: 4500,
  cantidad_registros: 2, total_planilla: 3000, total_entregas: 6,
  pendientes: 4, entregadas: 1, canceladas: 1,
};
const branchRow = {
  unidades: 25, registros: 1, ingresos: 20, egresos: 50, saldo: -30,
  cantidad_confirmadas: 1, monto_confirmado: 20, cantidad_activos: 1, valor_total: 500,
  cantidad_registros: 1, total_planilla: 1000, total_entregas: 3,
  pendientes: 1, entregadas: 1, canceladas: 1,
};
const globalData = {
  inventario: { unidades: 125, registros: 3 }, caja: { ingresos: 200, egresos: 50, saldo: 150 },
  ventas: { cantidad_confirmadas: 2, monto_confirmado: 200 }, activos: { cantidad: 3, valor_total: 4500 },
  planilla: { cantidad_registros: 2, total: 3000 }, entregas: { total: 6, pendientes: 4, entregadas: 1, canceladas: 1 },
};
const zeroData = {
  inventario: { unidades: 0, registros: 0 }, caja: { ingresos: 0, egresos: 0, saldo: 0 },
  ventas: { cantidad_confirmadas: 0, monto_confirmado: 0 }, activos: { cantidad: 0, valor_total: 0 },
  planilla: { cantidad_registros: 0, total: 0 }, entregas: { total: 0, pendientes: 0, entregadas: 0, canceladas: 0 },
};

// Sustituye únicamente el driver Oracle; HTTP, JWT, validaciones y capas son reales.
async function setup(t, config = {}) {
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  const calls = [], events = [];
  let acquisitions = 0;
  t.mock.method(pool, 'getConnection', async () => {
    acquisitions++;
    if (config.acquireError) throw new Error('ORA-99999 conexión privada');
    return {
      execute: async (sql, binds, options) => {
        calls.push({ sql, binds, options });
        if (config.executeError) throw new Error('ORA-99999 SQL privado');
        const empty = config.empty || binds.id_sucursal === 9999999999;
        const row = empty ? Object.fromEntries(Object.keys(globalRow).map(key => [key, 0]))
          : config.row ?? (binds.id_sucursal === null ? globalRow : branchRow);
        return { rows: [row] };
      },
      close: async () => { events.push('close'); },
    };
  });
  const server = await startTestServer();
  t.after(() => new Promise(resolve => server.close(resolve)));
  return {
    calls, events, acquisitions: () => acquisitions,
    request: async (query = '', role = 'ADMINISTRADOR', path = '/api/dashboard/resumen') => {
      const headers = {};
      if (role) headers.Authorization = `Bearer ${tokens.sign({ id_usuario: 42, id_rol: 99, nombre_rol: role, id_sucursal: 1 })}`;
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}${query}`, { headers });
      return { status: response.status, body: await response.json() };
    },
  };
}

for (const role of ['ADMINISTRADOR', 'AUDITOR']) test(`dashboard: ${role} consulta global sin limitarse a sucursal JWT`, async t => {
  const api = await setup(t);
  const result = await api.request('', role);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, data: globalData, message: 'Resumen de dashboard consultado' });
  assert.equal(api.calls.length, 1);
  assert.deepEqual(api.calls[0].binds, { id_sucursal: null });
  assert.equal(api.calls[0].options.outFormat, oracledb.OUT_FORMAT_OBJECT);
  assert.deepEqual(api.events, ['close']);
});

for (const role of ['ENCARGADO', 'DESPACHO', 'OTRO', null]) test(`dashboard: rechaza ${role} antes de Oracle`, async t => {
  const api = await setup(t);
  const result = await api.request('', role);
  assert.equal(result.status, role ? 403 : 401);
  assert.equal(result.body.code, role ? 'FORBIDDEN' : 'UNAUTHORIZED');
  assert.equal(api.acquisitions(), 0);
});

test('dashboard: filtra todos los agregados por sucursal y conserva saldo negativo', async t => {
  const api = await setup(t);
  const result = await api.request('?id_sucursal=2', 'AUDITOR');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, {
    inventario: { unidades: 25, registros: 1 }, caja: { ingresos: 20, egresos: 50, saldo: -30 },
    ventas: { cantidad_confirmadas: 1, monto_confirmado: 20 }, activos: { cantidad: 1, valor_total: 500 },
    planilla: { cantidad_registros: 1, total: 1000 }, entregas: { total: 3, pendientes: 1, entregadas: 1, canceladas: 1 },
  });
  assert.deepEqual(api.calls[0].binds, { id_sucursal: 2 });
  assert.equal((api.calls[0].sql.match(/WHERE \(:id_sucursal IS NULL OR id_sucursal = :id_sucursal\)/g) ?? []).length, 6);
  assert.doesNotMatch(api.calls[0].sql, /FROM SUCURSAL|activa|GROUP BY|FOR UPDATE|INSERT|UPDATE|DELETE/);
});

for (const [name, query, config] of [['sin datos', '', { empty: true }], ['sucursal inexistente', '?id_sucursal=9999999999', {}]]) {
  test(`dashboard: ${name} devuelve 200 y ceros`, async t => {
    const api = await setup(t, config);
    const result = await api.request(query);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data, zeroData);
  });
}

for (const id of ['', '0', '-1', '01', '1.5', '1e2', 'abc', '10000000000', ' 1', '1 OR 1=1']) {
  test(`dashboard: rechaza id_sucursal ${JSON.stringify(id)}`, async t => {
    const api = await setup(t);
    const result = await api.request(`?id_sucursal=${encodeURIComponent(id)}`);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'INVALID_ID');
    assert.equal(api.acquisitions(), 0);
  });
}

test('dashboard: rechaza parámetros repetidos y filtros no soportados', async t => {
  const api = await setup(t);
  for (const query of ['?id_sucursal=1&id_sucursal=2', '?periodo=2026-11', '?fecha_desde=2026-11-01', '?id_sucursal[x]=1']) {
    assert.equal((await api.request(query)).status, 400);
  }
  assert.equal(api.acquisitions(), 0);
});

test('dashboard: Oracle calcula sumas, conteos, saldo y estados sin multiplicar filas', async t => {
  const api = await setup(t);
  await api.request();
  const sql = api.calls[0].sql;
  assert.match(sql, /NVL\(SUM\(existencia\), 0\) AS "unidades", COUNT\(\*\) AS "registros"/);
  assert.match(sql, /NVL\(SUM\(CASE WHEN tipo = 'INGRESO' THEN monto ELSE 0 END\), 0\) AS "ingresos"/);
  assert.match(sql, /NVL\(SUM\(CASE WHEN tipo = 'EGRESO' THEN monto ELSE 0 END\), 0\) AS "egresos"/);
  assert.match(sql, /c\."ingresos" - c\."egresos" AS "saldo"/);
  assert.match(sql, /COUNT\(\*\) AS "cantidad_confirmadas", NVL\(SUM\(total\), 0\) AS "monto_confirmado"[\s\S]*?FROM VENTA[\s\S]*?AND estado = 'CONFIRMADA'/);
  assert.match(sql, /COUNT\(\*\) AS "cantidad_activos", NVL\(SUM\(valor\), 0\) AS "valor_total"/);
  assert.match(sql, /COUNT\(\*\) AS "cantidad_registros", NVL\(SUM\(monto\), 0\) AS "total_planilla"/);
  assert.match(sql, /COUNT\(\*\) AS "total_entregas"/);
  assert.match(sql, /NVL\(SUM\(CASE WHEN estado IN \('CREADA', 'ASIGNADA', 'PREPARADA', 'EN_RUTA'\) THEN 1 ELSE 0 END\), 0\) AS "pendientes"/);
  for (const [state, alias] of [['ENTREGADA', 'entregadas'], ['CANCELADA', 'canceladas']]) {
    assert.ok(sql.includes(`NVL(SUM(CASE WHEN estado = '${state}' THEN 1 ELSE 0 END), 0) AS "${alias}"`));
  }
  for (const table of ['INVENTARIO', 'MOVIMIENTO_CAJA', 'VENTA', 'ACTIVO_FIJO', 'GASTO_PLANILLA', 'ENTREGA']) {
    assert.equal((sql.match(new RegExp(`FROM ${table}\\b`, 'g')) ?? []).length, 1);
  }
  assert.equal((sql.match(/CROSS JOIN/g) ?? []).length, 5);
});

test('dashboard: transmite valores Oracle sin recalcular ni limitar sumas a una fila', async t => {
  const api = await setup(t, { row: { ...globalRow, ingresos: 0.3, egresos: 0.1, saldo: 0.2, total_planilla: 19999999999.98 } });
  const result = await api.request();
  assert.deepEqual(result.body.data.caja, { ingresos: 0.3, egresos: 0.1, saldo: 0.2 });
  assert.equal(result.body.data.planilla.total, 19999999999.98);
});

for (const failure of ['acquireError', 'executeError']) test(`dashboard: ${failure} sanitizado y conexión liberada`, async t => {
  const api = await setup(t, { [failure]: true });
  const result = await api.request();
  assert.equal(result.status, 500);
  assert.equal(result.body.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify(result.body), /ORA-|SQL|stack|privad/);
  assert.deepEqual(api.events, failure === 'executeError' ? ['close'] : []);
});

test('dashboard: no amplía permisos operativos de ventas o caja', async t => {
  const api = await setup(t);
  for (const role of ['ADMINISTRADOR', 'AUDITOR']) assert.equal((await api.request('', role, '/api/ventas')).status, 403);
  assert.equal((await api.request('', 'ADMINISTRADOR', '/api/caja/movimientos')).status, 403);
  assert.equal(api.acquisitions(), 0);
});
