const bcrypt = require('bcrypt');
const { randomBytes } = require('node:crypto');
const repository = require('./auth.repository');
const auditoria = require('../auditoria/auditoria.service');
const database = require('../../database/connection');
const tokens = require('../../shared/tokens');
const AppError = require('../../shared/AppError');

// También comparar cuando no existe la cuenta para reducir diferencias de tiempo.
let fallbackHash;
function getFallbackHash() {
  fallbackHash ??= bcrypt.hash(randomBytes(32).toString('hex'), 12);
  return fallbackHash;
}

async function login(correo, password) {
  const user = await repository.findByCorreo(correo);
  const hash = user?.password_hash || await getFallbackHash();
  const matches = await bcrypt.compare(password, hash);
  if (!user || user.activo !== 'S' || !matches) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Credenciales inválidas');
  }
  const context = {
    id_usuario: user.id_usuario,
    id_rol: user.id_rol,
    nombre_rol: user.nombre_rol,
    id_sucursal: user.id_sucursal,
  };
  const token = tokens.sign(context);
  // findByCorreo ya liberó su conexión antes de bcrypt; solo la escritura abre esta transacción.
  await database.withTransaction(connection => auditoria.registrarEvento(connection, {
    id_usuario: context.id_usuario, id_sucursal: context.id_sucursal,
    modulo: 'AUTH', accion: 'LOGIN_OK', entidad: 'USUARIO', id_entidad: context.id_usuario,
    descripcion: `Usuario ${context.id_usuario} autenticado correctamente`,
  }));
  console.info('[AUTH] LOGIN_SUCCESS', { id_usuario: context.id_usuario });
  return { token, user: context };
}

module.exports = { login };
