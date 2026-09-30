const jwt = require('jsonwebtoken');

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret?.trim()) throw new Error('Faltan variables de entorno: JWT_SECRET');
  return secret;
}

function sign(context) {
  return jwt.sign(context, getSecret(), { algorithm: 'HS256', expiresIn: '1h' });
}

function verify(token) {
  const payload = jwt.verify(token, getSecret(), { algorithms: ['HS256'] });
  const validId = value => Number.isSafeInteger(value) && value > 0;
  if (!payload || !validId(payload.id_usuario) || !validId(payload.id_rol) ||
      typeof payload.nombre_rol !== 'string' || !payload.nombre_rol.trim() ||
      !(payload.id_sucursal === null || validId(payload.id_sucursal)) ||
      !Number.isInteger(payload.exp)) {
    throw new Error('Contexto JWT inválido');
  }
  return {
    id_usuario: payload.id_usuario, id_rol: payload.id_rol,
    nombre_rol: payload.nombre_rol, id_sucursal: payload.id_sucursal,
  };
}

module.exports = { sign, verify };
