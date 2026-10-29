const auditoria = require('../auditoria/auditoria.service');
const repository = require('./activos.repository');
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
    throw new AppError(400, 'INVALID_INPUT', 'Datos de activo inválidos');
  }
}

function validateText(value, field, limit, code) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value.trim(), 'utf8') > limit) {
    throw new AppError(400, code, `${field} debe ser texto no vacío de hasta ${limit} bytes`);
  }
  return value.trim();
}

function validateState(value) {
  if (!['ACTIVO', 'MANTENIMIENTO', 'BAJA'].includes(value)) {
    throw new AppError(400, 'INVALID_ASSET_STATE', 'estado debe ser ACTIVO, MANTENIMIENTO o BAJA');
  }
  return value;
}

function validateValue(value) {
  const invalid = () => new AppError(400, 'INVALID_VALUE', 'valor debe ser no negativo, con hasta dos decimales y compatible con NUMBER(12,2)');
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid();
  // Patrón monetario de Ventas/Caja: centavos enteros, sin redondeo binario.
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw invalid();
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (cents > 999999999999n) throw invalid();
  return Number(cents) / 100;
}

function validateInput(input) {
  validateObject(input, ['id_sucursal', 'categoria', 'descripcion', 'valor', 'estado', 'responsable']);
  return {
    id_sucursal: validateId(input.id_sucursal),
    categoria: validateText(input.categoria, 'categoria', 60, 'INVALID_CATEGORY'),
    descripcion: validateText(input.descripcion, 'descripcion', 150, 'INVALID_DESCRIPTION'),
    valor: validateValue(input.valor),
    estado: validateState(input.estado),
    responsable: input.responsable == null ? null : validateText(input.responsable, 'responsable', 100, 'INVALID_RESPONSIBLE'),
  };
}

function validateFilters(input) {
  validateObject(input, ['id_sucursal', 'categoria', 'estado', 'responsable', 'descripcion']);
  return {
    id_sucursal: input.id_sucursal === undefined ? null : validateId(input.id_sucursal),
    categoria: input.categoria === undefined ? null : validateText(input.categoria, 'categoria', 60, 'INVALID_CATEGORY'),
    estado: input.estado === undefined ? null : validateState(input.estado),
    responsable: input.responsable === undefined ? null : validateText(input.responsable, 'responsable', 100, 'INVALID_RESPONSIBLE'),
    descripcion: input.descripcion === undefined ? null : validateText(input.descripcion, 'descripcion', 150, 'INVALID_DESCRIPTION'),
  };
}

function requireFound(row) {
  if (!row) throw new AppError(404, 'ACTIVO_NOT_FOUND', 'Activo inexistente');
  return row;
}

async function requireActiveBranch(connection, id) {
  const branch = await branches.findById(connection, id);
  if (!branch) throw new AppError(404, 'SUCURSAL_NOT_FOUND', 'Sucursal inexistente');
  if (branch.activa !== 'S') throw new AppError(409, 'SUCURSAL_INACTIVE', 'Sucursal inactiva');
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

async function create(input, user) {
  requireRole(user, true);
  const data = validateInput(input);
  return database.withTransaction(async connection => {
    await requireActiveBranch(connection, data.id_sucursal);
    const id = await repository.create(connection, data);
    await auditoria.registrarEvento(connection, {
      id_usuario: user.id_usuario, id_sucursal: data.id_sucursal,
      modulo: 'ACTIVOS', accion: 'CREAR', entidad: 'ACTIVO_FIJO', id_entidad: id,
      descripcion: `Activo ${id} creado; estado ${data.estado}`,
    });
    return requireFound(await repository.findById(connection, id));
  });
}

async function update(id, input, user) {
  requireRole(user, true);
  validateId(id);
  const data = validateInput(input);
  return database.withTransaction(async connection => {
    // Bloquear antes de comparar sucursal evita validar contra una asignación desactualizada.
    const current = requireFound(await repository.findById(connection, id, true));
    if (current.id_sucursal !== data.id_sucursal) await requireActiveBranch(connection, data.id_sucursal);
    if (await repository.update(connection, id, data) !== 1) {
      throw new AppError(409, 'ACTIVO_CONFLICT', 'El activo cambió; vuelva a consultar');
    }
    await auditoria.registrarEvento(connection, {
      id_usuario: user.id_usuario, id_sucursal: data.id_sucursal,
      modulo: 'ACTIVOS', accion: 'MODIFICAR', entidad: 'ACTIVO_FIJO', id_entidad: id,
      descripcion: `Activo ${id} actualizado; sucursal ${current.id_sucursal} -> ${data.id_sucursal}; estado ${current.estado} -> ${data.estado}`,
    });
    return requireFound(await repository.findById(connection, id));
  });
}

module.exports = { list, read, create, update, validateId };
