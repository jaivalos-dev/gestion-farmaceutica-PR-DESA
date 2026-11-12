const repository = require('./dashboard.repository');
const database = require('../../database/connection');
const AppError = require('../../shared/AppError');

async function summary(input, user) {
  if (!['ADMINISTRADOR', 'AUDITOR'].includes(user.nombre_rol)) {
    throw new AppError(403, 'FORBIDDEN', 'Acceso no autorizado');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'id_sucursal')) {
    throw new AppError(400, 'INVALID_INPUT', 'Filtros de dashboard inválidos');
  }
  const id_sucursal = input.id_sucursal === undefined ? null : input.id_sucursal;
  if (input.id_sucursal !== undefined && (!Number.isInteger(id_sucursal) || id_sucursal <= 0 || id_sucursal > 9999999999)) {
    throw new AppError(400, 'INVALID_ID', 'Identificador inválido');
  }
  return database.withConnection(connection => repository.summary(connection, { id_sucursal }));
}

module.exports = { summary };
