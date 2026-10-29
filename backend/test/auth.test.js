const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const express = require('express');

const secret = randomBytes(32).toString('hex');
const password = randomBytes(18).toString('hex');
const context = { id_usuario: 1, id_rol: 2, nombre_rol: 'Encargado', id_sucursal: 3 };
const hash = bcrypt.hashSync(password, 4);

async function setup(t, user, failure, config = {}) {
  process.env.JWT_SECRET = secret;
  const database = require('../src/database/pool');
  let closed = false;
  const events = [], audit = [];
  let acquisitions = 0;
  t.mock.method(database, 'getConnection', async () => {
    const number = ++acquisitions;
    events.push(`open:${number}`);
    let pending;
    return {
    execute: async (sql, binds, options) => {
      if (/INSERT INTO AUDITORIA\b/.test(sql)) {
        assert.equal(number, 2);
        assert.equal(options.autoCommit, false);
        if (config.failAudit) throw new Error('ORA-99999 SQL privado');
        pending = { ...binds };
        return { rowsAffected: 1 };
      }
      assert.equal(number, 1);
      assert.match(sql, /JOIN ROL/i);
      assert.match(sql, /u.correo = :correo/);
      assert.equal(binds.correo, 'test@example.com');
      assert.equal(options.outFormat, require('oracledb').OUT_FORMAT_OBJECT);
      if (failure) throw new Error('detalle privado Oracle');
      return { rows: user ? [user] : [] };
    },
    commit: async () => {
      events.push(`commit:${number}`);
      if (config.failCommit) throw new Error('ORA-99999 commit');
      if (pending) audit.push(pending);
    },
    rollback: async () => events.push(`rollback:${number}`),
    close: async () => { closed = true; events.push(`close:${number}`); },
  };
  });
  const { createApp } = require('../src/app');
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return {
    events, audit, acquisitions: () => acquisitions,
    login: (body) => fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
    closed: () => closed,
  };
}

const user = { ...context, password_hash: hash, activo: 'S' };

for (const branch of [3, null]) test(`CU-14 LOGIN_OK sucursal ${branch} libera lectura antes de bcrypt y confirma antes de responder`, async t => {
  const api = await setup(t, { ...user, id_sucursal: branch });
  const compare = bcrypt.compare;
  t.mock.method(bcrypt, 'compare', async (...args) => {
    assert.deepEqual(api.events, ['open:1', 'close:1']);
    api.events.push('bcrypt');
    return compare(...args);
  });
  const response = await api.login({ correo: 'test@example.com', password });
  assert.equal(response.status, 200);
  assert.equal(api.audit.length, 1);
  assert.deepEqual(api.audit[0], { id_usuario: 1, id_sucursal: branch, modulo: 'AUTH', accion: 'LOGIN_OK',
    entidad: 'USUARIO', id_entidad: 1, descripcion: 'Usuario 1 autenticado correctamente' });
  assert.deepEqual(api.events, ['open:1', 'close:1', 'bcrypt', 'open:2', 'commit:2', 'close:2']);
  const body = await response.json();
  for (const secretValue of [password, hash, body.data.token, 'test@example.com']) assert.equal(JSON.stringify(api.audit).includes(secretValue), false);
});

for (const config of [{ failAudit: true }, { failCommit: true }]) test(`CU-14 LOGIN_OK falla sin token si falla ${Object.keys(config)[0]}`, async t => {
  const api = await setup(t, user, false, config);
  const logs = [];
  t.mock.method(console, 'info', (...args) => logs.push(args));
  const response = await api.login({ correo: 'test@example.com', password });
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.code, 'INTERNAL_ERROR');
  assert.equal(body.data, undefined);
  assert.deepEqual(api.audit, []);
  assert.deepEqual(logs, []);
  assert.deepEqual(api.events, ['open:1', 'close:1', 'open:2', ...(config.failCommit ? ['commit:2'] : []), 'rollback:2', 'close:2']);
});

for (const record of [null, user, { ...user, activo: 'N' }]) test(`CU-14 LOGIN_FALLIDO ${record ? record.activo : 'inexistente'} no audita ni expone secretos`, async t => {
  const api = await setup(t, record);
  const logs = [];
  t.mock.method(console, 'info', (...args) => logs.push(args));
  t.mock.method(console, 'error', (...args) => logs.push(args));
  const response = await api.login({ correo: 'test@example.com', password: 'incorrecta-ficticia' });
  assert.equal(response.status, 401);
  assert.deepEqual(api.audit, []);
  assert.equal(api.acquisitions(), 1);
  assert.deepEqual(api.events, ['open:1', 'close:1']);
  const output = JSON.stringify({ body: await response.json(), logs });
  for (const value of [hash, password, 'incorrecta-ficticia', 'test@example.com', 'Authorization']) assert.equal(output.includes(value), false);
});
test('login válido usa bcrypt y entrega JWT limitado sin credenciales', async t => {
  const api = await setup(t, user);
  const response = await api.login({ correo: 'test@example.com', password });
  assert.equal(response.status, 200);
  const body = await response.json();
  const claims = jwt.verify(body.data.token, secret, { algorithms: ['HS256'] });
  assert.deepEqual(body.data.user, context);
  assert.deepEqual(Object.keys(claims).sort(), [...Object.keys(context), 'iat', 'exp'].sort());
  assert.equal(claims.exp - claims.iat, 3600);
  assert.equal(api.closed(), true);
  assert.equal(JSON.stringify(body).includes(hash), false);
});

for (const [name, record, input] of [
  ['correo inexistente', null, password],
  ['contraseña incorrecta', user, 'incorrecta-ficticia'],
  ['usuario inactivo', { ...user, activo: 'N' }, password],
  ['hash demo no utilizable', { ...user, password_hash: 'marcador-ficticio' }, password],
]) {
  test(`login rechaza ${name} con respuesta genérica`, async t => {
    const api = await setup(t, record);
    const response = await api.login({ correo: 'test@example.com', password: input });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      ok: false, code: 'INVALID_CREDENTIALS', message: 'Credenciales inválidas',
    });
    assert.equal(api.closed(), true);
  });
}

test('login valida formatos y límite bcrypt de 72 bytes', async t => {
  const api = await setup(t, user);
  for (const body of [{}, { correo: 5, password }, { correo: 'x', password },
    { correo: 'test@example.com', password: 'á'.repeat(37) },
    { correo: 'test@example.com', password: [] }]) {
    assert.equal((await api.login(body)).status, 400);
  }
  assert.equal(api.closed(), false);
});

test('login libera conexión ante error SQL y oculta detalles', async t => {
  const api = await setup(t, user, true);
  const response = await api.login({ correo: 'test@example.com', password });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).code, 'INTERNAL_ERROR');
  assert.equal(api.closed(), true);
});

test('login conserva sucursal nula', async t => {
  const api = await setup(t, { ...user, id_sucursal: null });
  const response = await api.login({ correo: 'test@example.com', password });
  const body = await response.json();
  assert.equal(jwt.verify(body.data.token, secret).id_sucursal, null);
});

test('login devuelve 503 cuando Oracle no permite adquirir conexión', async t => {
  const api = await setup(t, user);
  const AppError = require('../src/shared/AppError');
  t.mock.method(require('../src/database/pool'), 'getConnection', async () => {
    throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Oracle no está disponible');
  });
  const response = await api.login({ correo: 'test@example.com', password });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'DATABASE_UNAVAILABLE');
});

test('JWT no firma sin secreto de entorno', t => {
  const previous = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  t.after(() => {
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  });
  assert.throws(() => require('../src/shared/tokens').sign(context), /JWT_SECRET/);
});

test('Bearer y autorización por rol protegen una ruta HTTP', async t => {
  process.env.JWT_SECRET = secret;
  const authenticate = require('../src/middlewares/authenticate');
  const authorizeRoles = require('../src/middlewares/authorizeRoles');
  const app = express();
  app.get('/protected', authenticate, authorizeRoles(2), (req, res) => res.json(req.user));
  app.get('/denied', authenticate, authorizeRoles(1), (req, res) => res.sendStatus(200));
  app.get('/no-auth', authorizeRoles(2), (req, res) => res.sendStatus(200));
  app.use(require('../src/middlewares/errorHandler'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (path, token) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    headers: token ? { Authorization: token } : {},
  });
  for (const token of [undefined, 'Bearer inválido', 'Basic abc',
    `Bearer ${jwt.sign(context, randomBytes(32), { expiresIn: '1h' })}`,
    `Bearer ${jwt.sign(context, secret, { expiresIn: -1 })}`,
    `Bearer ${jwt.sign(context, secret, { algorithm: 'HS384', expiresIn: '1h' })}`,
    `Bearer ${jwt.sign(context, secret)}`,
    `Bearer ${jwt.sign({ id_usuario: 1 }, secret, { expiresIn: '1h' })}`]) {
    assert.equal((await request('/protected', token)).status, 401);
  }
  const token = `Bearer ${jwt.sign(context, secret, { expiresIn: '1h' })}`;
  const valid = await request('/protected', token);
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), context);
  assert.equal((await request('/denied', token)).status, 403);
  assert.equal((await request('/no-auth')).status, 401);
});
