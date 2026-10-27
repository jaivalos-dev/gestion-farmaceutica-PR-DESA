const repository = require('./caja.repository');
const branches = require('../sucursales/sucursales.repository');
const database = require('../../database/connection');
const AppError = require('../../shared/AppError');

function validateId(value) {
  if (!Number.isInteger(value) || value <= 0 || value > 9999999999) {
    throw new AppError(400, 'INVALID_ID', 'Identificador inválido');
  }
  return value;
}

function branchScope(user, branch = null, writing = false) {
  const roles = writing ? ['ENCARGADO'] : ['ENCARGADO', 'AUDITOR'];
  if (!roles.includes(user.nombre_rol)) throw new AppError(403, 'FORBIDDEN', 'Acceso no autorizado');
  if (user.nombre_rol === 'AUDITOR') return branch;
  if (!user.id_sucursal) throw new AppError(403, 'USER_BRANCH_REQUIRED', 'El usuario requiere una sucursal asignada');
  if (branch !== null && branch !== user.id_sucursal) {
    throw new AppError(403, 'FORBIDDEN_BRANCH', 'Acceso no autorizado a la sucursal');
  }
  return user.id_sucursal;
}

function validateObject(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) {
    throw new AppError(400, 'INVALID_INPUT', 'Datos de movimiento de caja inválidos');
  }
}

function validateType(value) {
  if (!['INGRESO', 'EGRESO'].includes(value)) {
    throw new AppError(400, 'INVALID_MOVEMENT_TYPE', 'tipo debe ser INGRESO o EGRESO');
  }
  return value;
}

function validateConcept(value) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value.trim(), 'utf8') > 200) {
    throw new AppError(400, 'INVALID_CONCEPT', 'concepto es obligatorio y admite hasta 200 bytes');
  }
  return value.trim();
}

function validateAmount(value) {
  const invalid = () => new AppError(400, 'INVALID_AMOUNT', 'monto debe ser positivo, con hasta dos decimales y compatible con NUMBER(12,2)');
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid();
  // Mismo patrón de Ventas: interpretar el decimal en centavos enteros, sin redondear.
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw invalid();
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (cents <= 0n || cents > 999999999999n) throw invalid();
  return Number(cents) / 100;
}

function validateDate(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.startsWith('0000')) {
    throw new AppError(400, 'INVALID_DATE', 'La fecha debe ser válida y usar YYYY-MM-DD');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new AppError(400, 'INVALID_DATE', 'La fecha debe ser válida y usar YYYY-MM-DD');
  }
  return value;
}

function validateFilters(input) {
  validateObject(input, ['id_sucursal', 'tipo', 'fecha_desde', 'fecha_hasta', 'id_venta', 'concepto']);
  const filters = {};
  for (const field of ['id_sucursal', 'id_venta']) filters[field] = input[field] === undefined ? null : validateId(input[field]);
  filters.tipo = input.tipo === undefined ? null : validateType(input.tipo);
  filters.concepto = input.concepto === undefined ? null : validateConcept(input.concepto);
  for (const field of ['fecha_desde', 'fecha_hasta']) filters[field] = input[field] === undefined ? null : validateDate(input[field]);
  if (filters.fecha_desde && filters.fecha_hasta && filters.fecha_desde > filters.fecha_hasta) {
    throw new AppError(400, 'INVALID_DATE_RANGE', 'fecha_desde no puede ser posterior a fecha_hasta');
  }
  return filters;
}

function requireFound(row) {
  if (!row) throw new AppError(404, 'MOVEMENT_NOT_FOUND', 'Movimiento de caja inexistente');
  return row;
}

async function list(input, user) {
  branchScope(user);
  const filters = validateFilters(input);
  filters.id_sucursal = branchScope(user, filters.id_sucursal);
  return database.withConnection(connection => repository.list(connection, filters));
}

async function read(id, user) {
  branchScope(user);
  validateId(id);
  return database.withConnection(async connection => {
    const row = requireFound(await repository.findById(connection, id));
    branchScope(user, row.id_sucursal);
    return row;
  });
}

async function create(input, user) {
  const id_sucursal = branchScope(user, null, true);
  validateObject(input, ['tipo', 'monto', 'concepto']);
  const data = {
    tipo: validateType(input.tipo), monto: validateAmount(input.monto), concepto: validateConcept(input.concepto),
    id_sucursal, id_usuario: user.id_usuario, id_venta: null,
  };
  return database.withTransaction(async connection => {
    const branch = await branches.findById(connection, id_sucursal);
    if (!branch) throw new AppError(404, 'SUCURSAL_NOT_FOUND', 'Sucursal inexistente');
    if (branch.activa !== 'S') throw new AppError(409, 'SUCURSAL_INACTIVE', 'Sucursal inactiva');
    const id = await repository.create(connection, data);
    // AUDITORIA queda pendiente del servicio transversal, como en Inventario, Transferencias y Ventas.
    return requireFound(await repository.findById(connection, id));
  });
}

module.exports = { list, read, create, validateId };
