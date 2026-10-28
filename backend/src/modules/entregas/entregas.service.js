const repository = require('./entregas.repository');
const sales = require('../ventas/ventas.repository');
const branches = require('../sucursales/sucursales.repository');
const { locationEstimate } = require('../disponibilidad/disponibilidad.service');
const database = require('../../database/connection');
const AppError = require('../../shared/AppError');

const states = ['CREADA', 'ASIGNADA', 'PREPARADA', 'EN_RUTA', 'ENTREGADA', 'CANCELADA'];
const transitions = {
  CREADA: ['ASIGNADA', 'CANCELADA'],
  ASIGNADA: ['PREPARADA', 'CANCELADA'],
  PREPARADA: ['EN_RUTA', 'CANCELADA'],
  EN_RUTA: ['ENTREGADA'],
  ENTREGADA: [],
  CANCELADA: [],
};
const textFields = {
  nombre_cliente: [100, 'INVALID_CLIENT_NAME'], telefono: [20, 'INVALID_PHONE'],
  direccion: [200, 'INVALID_ADDRESS'], departamento: [50, 'INVALID_DEPARTMENT'],
  municipio: [50, 'INVALID_MUNICIPALITY'],
};

function requireRole(user, roles = ['ENCARGADO', 'DESPACHO', 'ADMINISTRADOR']) {
  if (!roles.includes(user.nombre_rol)) throw new AppError(403, 'FORBIDDEN', 'Acceso no autorizado');
}

function branchScope(user, branch = null) {
  if (user.nombre_rol !== 'ENCARGADO') return branch;
  if (!user.id_sucursal || (branch !== null && branch !== user.id_sucursal)) {
    throw new AppError(403, 'FORBIDDEN_BRANCH', 'Acceso no autorizado a la sucursal');
  }
  return user.id_sucursal;
}

function validateId(value) {
  if (!Number.isInteger(value) || value <= 0 || value > 9999999999) {
    throw new AppError(400, 'INVALID_ID', 'Identificador inválido');
  }
  return value;
}

function validateObject(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) {
    throw new AppError(400, 'INVALID_INPUT', 'Datos de entrega inválidos');
  }
}

function validateText(value, field) {
  const [limit, code] = textFields[field];
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value.trim(), 'utf8') > limit) {
    throw new AppError(400, code, `${field} debe ser texto no vacío de hasta ${limit} bytes`);
  }
  return value.trim();
}

function validateState(value) {
  if (!states.includes(value)) throw new AppError(400, 'INVALID_DELIVERY_STATE', 'Estado de entrega inválido');
  return value;
}

function requireFound(row) {
  if (!row) throw new AppError(404, 'ENTREGA_NOT_FOUND', 'Entrega inexistente');
  return row;
}

function duplicateDelivery() {
  return new AppError(409, 'DELIVERY_ALREADY_EXISTS', 'La venta ya tiene una entrega');
}

function validateInput(input) {
  validateObject(input, ['id_venta', ...Object.keys(textFields), 'observaciones']);
  const data = { id_venta: validateId(input.id_venta) };
  for (const field of Object.keys(textFields)) data[field] = validateText(input[field], field);
  if (input.observaciones != null && (typeof input.observaciones !== 'string' || Buffer.byteLength(input.observaciones.trim(), 'utf8') > 250)) {
    throw new AppError(400, 'INVALID_OBSERVATIONS', 'observaciones admite hasta 250 bytes');
  }
  data.observaciones = input.observaciones?.trim() || null;
  return data;
}

async function list(input, user) {
  requireRole(user);
  validateObject(input, ['id_sucursal', 'id_venta', 'estado', 'departamento', 'municipio']);
  const filters = {};
  for (const field of ['id_sucursal', 'id_venta']) filters[field] = input[field] === undefined ? null : validateId(input[field]);
  for (const field of ['departamento', 'municipio']) filters[field] = input[field] === undefined ? null : validateText(input[field], field);
  filters.estado = input.estado === undefined ? null : validateState(input.estado);
  filters.id_sucursal = branchScope(user, filters.id_sucursal);
  return database.withConnection(connection => repository.list(connection, filters));
}

async function read(id, user) {
  requireRole(user);
  branchScope(user);
  validateId(id);
  return database.withConnection(async connection => {
    const row = requireFound(await repository.findById(connection, id));
    branchScope(user, row.id_sucursal);
    return row;
  });
}

async function create(input, user) {
  requireRole(user, ['ENCARGADO']);
  branchScope(user);
  const data = validateInput(input);
  return database.withTransaction(async connection => {
    // Serializar creaciones de la misma venta y leer su estado bajo bloqueo.
    const sale = await sales.findById(connection, data.id_venta, true);
    if (!sale) throw new AppError(404, 'VENTA_NOT_FOUND', 'Venta inexistente');
    branchScope(user, sale.id_sucursal);
    if (sale.estado !== 'CONFIRMADA') throw new AppError(409, 'INVALID_SALE_STATE', 'La entrega requiere una venta CONFIRMADA');
    if (await repository.findBySale(connection, data.id_venta)) throw duplicateDelivery();
    const branch = await branches.findById(connection, sale.id_sucursal);
    if (!branch) throw new AppError(404, 'SUCURSAL_NOT_FOUND', 'Sucursal inexistente');
    if (branch.activa !== 'S') throw new AppError(409, 'SUCURSAL_INACTIVE', 'Sucursal inactiva');
    let id;
    try {
      id = await repository.create(connection, {
        ...data, id_sucursal: sale.id_sucursal, estado: 'CREADA',
        tiempo_estimado: locationEstimate(branch, data).tiempo_estimado,
      });
    } catch (error) {
      if (error.errorNum === 1 && /\bUQ_ENTREGA_VENTA\b/i.test(error.message)) throw duplicateDelivery();
      throw error;
    }
    // AUDITORIA transversal pendiente. ENTREGA nunca modifica stock ni caja.
    return requireFound(await repository.findById(connection, id));
  });
}

async function transition(id, input, user) {
  requireRole(user, ['ENCARGADO', 'DESPACHO']);
  branchScope(user);
  validateId(id);
  validateObject(input, ['estado']);
  const estado = validateState(input.estado);
  return database.withTransaction(async connection => {
    const row = requireFound(await repository.findById(connection, id, true));
    branchScope(user, row.id_sucursal);
    if (!transitions[row.estado]?.includes(estado)) {
      throw new AppError(409, 'INVALID_DELIVERY_TRANSITION', 'Transición de entrega no permitida');
    }
    const role = ['EN_RUTA', 'ENTREGADA'].includes(estado) ? 'DESPACHO' : 'ENCARGADO';
    requireRole(user, [role]);
    if (await repository.setState(connection, id, estado) !== 1) {
      throw new AppError(409, 'ENTREGA_CONFLICT', 'La entrega cambió; vuelva a consultar');
    }
    // Cancelar logística no anula la venta ni revierte inventario. Auditoría transversal pendiente.
    return requireFound(await repository.findById(connection, id));
  });
}

module.exports = { list, read, create, transition, validateId };
