const repository = require('./planilla.repository');
const branches = require('../sucursales/sucursales.repository');
const database = require('../../database/connection');
const AppError = require('../../shared/AppError');

function requireRole(user, writing = false) {
  const roles = writing ? ['ADMINISTRADOR'] : ['ADMINISTRADOR', 'AUDITOR'];
  if (!roles.includes(user.nombre_rol)) throw new AppError(403, 'FORBIDDEN', 'Acceso no autorizado');
}

function validateId(value) {
  if (!Number.isInteger(value) || value <= 0 || value > 9999999999) {
    throw new AppError(400, 'INVALID_ID', 'Identificador inválido');
  }
  return value;
}

function validateObject(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) {
    throw new AppError(400, 'INVALID_INPUT', 'Datos de gasto de planilla inválidos');
  }
}

function validatePeriod(value) {
  if (typeof value !== 'string' || value.length !== 7 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new AppError(400, 'INVALID_PERIOD', 'periodo debe usar YYYY-MM con mes entre 01 y 12, sin espacios');
  }
  return value;
}

function validateConcept(value) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value.trim(), 'utf8') > 120) {
    throw new AppError(400, 'INVALID_CONCEPT', 'concepto es obligatorio y admite hasta 120 bytes');
  }
  return value.trim();
}

function validateAmount(value) {
  const invalid = () => new AppError(400, 'INVALID_AMOUNT', 'monto debe ser positivo, con hasta dos decimales y compatible con NUMBER(12,2)');
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid();
  // Patrón de Caja/Ventas: validar centavos enteros sin redondear el importe recibido.
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw invalid();
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (cents <= 0n || cents > 999999999999n) throw invalid();
  return Number(cents) / 100;
}

function validateFilters(input, summary = false) {
  validateObject(input, summary ? ['id_sucursal', 'periodo'] : ['id_sucursal', 'periodo', 'concepto']);
  const filters = {
    id_sucursal: input.id_sucursal === undefined ? null : validateId(input.id_sucursal),
    periodo: input.periodo === undefined ? null : validatePeriod(input.periodo),
  };
  if (!summary) filters.concepto = input.concepto === undefined ? null : validateConcept(input.concepto);
  return filters;
}

function requireFound(row) {
  if (!row) throw new AppError(404, 'GASTO_NOT_FOUND', 'Gasto de planilla inexistente');
  return row;
}

async function list(input, user) {
  requireRole(user);
  const filters = validateFilters(input);
  return database.withConnection(connection => repository.list(connection, filters));
}

async function read(id, user) {
  requireRole(user);
  validateId(id);
  return database.withConnection(async connection => requireFound(await repository.findById(connection, id)));
}

async function summary(input, user) {
  requireRole(user);
  const filters = validateFilters(input, true);
  // La suma y el conteo se ejecutan en Oracle, sin acumular montos en Node.
  return database.withConnection(connection => repository.summary(connection, filters));
}

async function create(input, user) {
  requireRole(user, true);
  validateObject(input, ['id_sucursal', 'periodo', 'concepto', 'monto']);
  const data = {
    id_sucursal: validateId(input.id_sucursal), id_usuario: user.id_usuario,
    periodo: validatePeriod(input.periodo), concepto: validateConcept(input.concepto), monto: validateAmount(input.monto),
  };
  return database.withTransaction(async connection => {
    const branch = await branches.findById(connection, data.id_sucursal);
    if (!branch) throw new AppError(404, 'SUCURSAL_NOT_FOUND', 'Sucursal inexistente');
    if (branch.activa !== 'S') throw new AppError(409, 'SUCURSAL_INACTIVE', 'Sucursal inactiva');
    const id = await repository.create(connection, data);
    // AUDITORIA queda pendiente del servicio transversal; usuario y fecha no la reemplazan.
    return requireFound(await repository.findById(connection, id));
  });
}

module.exports = { list, read, summary, create, validateId };
