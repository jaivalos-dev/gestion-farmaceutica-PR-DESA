const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const pool = require('../src/database/pool');
const tokens = require('../src/shared/tokens');

const query = { id_medicamento: '1', cantidad: '2', departamento: 'Guatemala', municipio: 'Guatemala' };
const candidates = [
  { id_sucursal: 4, nombre: 'Otra', tipo_sucursal: 'STAND', departamento: 'Otro', municipio: 'Guatemala', existencia: 100 },
  { id_sucursal: 3, nombre: 'Departamental', tipo_sucursal: 'FARMACIA', departamento: 'Guatemala', municipio: 'Mixco', existencia: 30 },
  { id_sucursal: 2, nombre: 'Local B', tipo_sucursal: 'FARMACIA', departamento: 'Guatemala', municipio: 'Guatemala', existencia: 20 },
  { id_sucursal: 1, nombre: 'Local A', tipo_sucursal: 'FARMACIA', departamento: 'Guatemala', municipio: 'Guatemala', existencia: 20 },
  { id_sucursal: 5, nombre: 'Local C', tipo_sucursal: 'STAND', departamento: 'Guatemala', municipio: 'Guatemala', existencia: 25 },
];

async function setup(t, config = {}) {
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  const calls = [], events = [];
  t.mock.method(pool, 'getConnection', async () => ({
    execute: async (sql, binds, options) => {
      calls.push({ sql, binds, options });
      if (config.fail) throw new Error('ORA-99999 SQL privado');
      if (/FROM MEDICAMENTO/.test(sql)) return { rows: config.missing ? [] : [{ id_medicamento: 1, activo: config.inactive ? 'N' : 'S' }] };
      if (/FROM INVENTARIO/.test(sql)) {
        // El doble entrega resultados SQL; comprobar los predicados evita ocultar su eliminación.
        assert.match(sql, /JOIN SUCURSAL/);
        assert.match(sql, /JOIN MEDICAMENTO/);
        assert.match(sql, /s\.activa\s*=\s*'S'/);
        assert.match(sql, /m\.activo\s*=\s*'S'/);
        assert.match(sql, /i\.existencia\s*>=\s*:cantidad/);
        assert.match(sql, /i\.id_medicamento\s*=\s*:id_medicamento/);
        assert.deepEqual(binds, { id_medicamento: 1, cantidad: 2 });
        return { rows: config.empty ? [] : structuredClone(candidates) };
      }
      throw new Error('SQL inesperado');
    },
    close: async () => events.push('close'),
    commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'),
  }));
  const server = require('../src/app').createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { calls, events, request: async (params = query, role = 'ENCARGADO') => {
    const headers = {};
    if (role) headers.Authorization = `Bearer ${tokens.sign({ id_usuario: 1, id_rol: 1, nombre_rol: role, id_sucursal: 1 })}`;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/disponibilidad?${new URLSearchParams(params)}`, { headers });
    return { status: response.status, body: await response.json() };
  } };
}

for (const role of [null, 'AUDITOR']) test(`CU-12 rechaza rol ${role}`, async t => {
  const api = await setup(t);
  assert.equal((await api.request(query, role)).status, role ? 403 : 401);
  assert.equal(api.calls.length, 0);
});

for (const role of ['ENCARGADO', 'DESPACHO', 'ADMINISTRADOR']) test(`CU-12 ${role}: prioridad, ETA, pagos y orden determinista sin escrituras`, async t => {
  const api = await setup(t);
  const result = await api.request({ ...query, departamento: ' guatemala ', municipio: ' GUATEMALA ' }, role);
  assert.equal(result.status, 200);
  assert.equal(result.body.data.disponible, true);
  assert.equal(result.body.data.id_medicamento, 1);
  assert.equal(result.body.data.cantidad, 2);
  assert.deepEqual(result.body.data.candidatos.map(row => [row.id_sucursal, row.prioridad, row.tiempo_estimado, row.eta_disponible]), [
    [5, 1, 30, true], [1, 1, 30, true], [2, 1, 30, true], [3, 2, 60, true], [4, 3, null, false],
  ]);
  for (const row of result.body.data.candidatos) {
    assert.equal(row.cantidad_solicitada, 2);
    assert.deepEqual(row.formas_pago, ['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'OTRO']);
    for (const key of ['nombre', 'tipo_sucursal', 'departamento', 'municipio', 'existencia']) assert.ok(Object.hasOwn(row, key));
  }
  assert.ok(api.calls.every(call => /^\s*SELECT/.test(call.sql)));
  assert.deepEqual(api.events, ['close']);
});

test('CU-12 sin disponibilidad es 200 con lista vacía', async t => {
  const api = await setup(t, { empty: true });
  const result = await api.request();
  assert.equal(result.status, 200);
  assert.equal(result.body.data.disponible, false);
  assert.deepEqual(result.body.data.candidatos, []);
});

for (const [config, status, code] of [
  [{ missing: true }, 404, 'MEDICAMENTO_NOT_FOUND'],
  [{ inactive: true }, 409, 'MEDICAMENTO_INACTIVE'],
  [{ fail: true }, 500, 'INTERNAL_ERROR'],
]) test(`CU-12 ${code}`, async t => {
  const api = await setup(t, config);
  const result = await api.request();
  assert.equal(result.status, status);
  assert.equal(result.body.code, code);
  assert.doesNotMatch(JSON.stringify(result.body), /ORA-|SQL|stack/);
  assert.deepEqual(api.events, ['close']);
});

for (const [field, value, code] of [
  ...['0', '-1', '1.5', 'x', '', '10000000000', '1e2'].map(value => ['cantidad', value, 'INVALID_QUANTITY']),
  ...['0', '-1', 'x', '1.2', '', '10000000000', '1 OR 1=1'].map(value => ['id_medicamento', value, 'INVALID_ID']),
  ...['departamento', 'municipio'].flatMap(field => ['', ' ', 'a'.repeat(51), 'á'.repeat(26)].map(value => [field, value, 'INVALID_LOCATION'])),
]) test(`CU-12 valida ${field}: ${JSON.stringify(value)}`, async t => {
  const api = await setup(t);
  const result = await api.request({ ...query, [field]: value });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, code);
  assert.equal(api.calls.length, 0);
});

for (const field of Object.keys(query)) test(`CU-12 requiere ${field}`, async t => {
  const api = await setup(t);
  const params = { ...query };
  delete params[field];
  assert.equal((await api.request(params)).status, 400);
  assert.equal(api.calls.length, 0);
});
