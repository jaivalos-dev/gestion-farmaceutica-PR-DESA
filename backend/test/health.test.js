const { startTestServer } = require('../test-support/testServer');
const { test } = require('node:test');
const assert = require('node:assert/strict');

// Oracle se sustituye en el límite del driver; HTTP y todas las capas son reales.
async function requestHealth(t, connection) {
  const oracledb = require('oracledb');
  t.mock.method(oracledb, 'createPool', async () => ({
    getConnection: async () => {
      if (connection instanceof Error) throw connection;
      return connection;
    },
    close: async () => {},
  }));
  const database = require('../src/database/pool');
  await database.initializePool({});
  const server = await startTestServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await database.closePool();
  });
  return fetch(`http://127.0.0.1:${server.address().port}/api/health`);
}

test('health responde 200 solo tras consultar Oracle y libera la conexión', async (t) => {
  let closed = false;
  const response = await requestHealth(t, {
    execute: async (sql) => {
      assert.equal(sql, 'SELECT 1 FROM dual');
      return { rows: [[1]] };
    },
    close: async () => { closed = true; },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true, data: { api: 'up', oracle: 'up' }, message: 'API y Oracle disponibles',
  });
  assert.equal(closed, true);
});

test('health devuelve 503 sin filtrar detalles cuando no obtiene conexión', async (t) => {
  const response = await requestHealth(t, new Error('detalle privado del driver'));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false, code: 'DATABASE_UNAVAILABLE', message: 'Oracle no está disponible',
  });
});

test('health libera la conexión y devuelve 503 si falla la consulta', async (t) => {
  let closed = false;
  const response = await requestHealth(t, {
    execute: async () => { throw new Error('detalle privado de SQL'); },
    close: async () => { closed = true; },
  });
  assert.equal(response.status, 503);
  assert.equal(closed, true);
  assert.equal((await response.json()).code, 'DATABASE_UNAVAILABLE');
});
