const { test } = require('node:test');
const assert = require('node:assert/strict');

test('config rechaza variables Oracle ausentes sin mostrar sus valores', () => {
  const { readConfig } = require('../src/config/env');
  assert.throws(() => readConfig({}), /ORACLE_USER, ORACLE_PASSWORD, ORACLE_CONNECT_STRING/);
});

test('config valida el puerto y conserva la contraseña sin transformarla', () => {
  const { readConfig } = require('../src/config/env');
  const env = {
    ORACLE_USER: 'usuario_prueba', ORACLE_PASSWORD: ' valor_ficticio ',
    ORACLE_CONNECT_STRING: 'localhost:1521/XEPDB1',
  };
  assert.equal(readConfig(env).port, 3000);
  assert.equal(readConfig(env).oracle.password, env.ORACLE_PASSWORD);
  for (const PORT of ['0', '-1', '65536', '3000abc', '1.5']) {
    assert.throws(() => readConfig({ ...env, PORT }), /PORT/);
  }
});
