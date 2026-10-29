const repository = require('./auditoria.repository');
const database = require('../../database/connection');
const AppError = require('../../shared/AppError');

const catalog = {
  SUCURSALES: { entidad: 'SUCURSAL', acciones: ['CREAR', 'MODIFICAR'] },
  MEDICAMENTOS: { entidad: 'MEDICAMENTO', acciones: ['CREAR', 'MODIFICAR'] },
  INVENTARIO: { entidad: 'INVENTARIO', acciones: ['ENTRADA', 'SALIDA', 'AJUSTE'] },
};
const values = {
  modulo: Object.keys(catalog),
  entidad: Object.values(catalog).map(value => value.entidad),
  accion: [...new Set(Object.values(catalog).flatMap(value => value.acciones))],
};
const filterFields = ['fecha_desde', 'fecha_hasta', 'id_usuario', 'id_sucursal', 'modulo', 'accion', 'entidad', 'id_entidad'];

function validateObject(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) {
    throw new AppError(400, 'INVALID_INPUT', 'Datos de auditoría inválidos');
  }
}

function validateId(value) {
  if (!Number.isInteger(value) || value <= 0 || value > 9999999999) {
    throw new AppError(400, 'INVALID_ID', 'Identificador inválido');
  }
  return value;
}

function validateText(value, limit) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value.trim(), 'utf8') > limit) {
    throw new AppError(400, 'INVALID_INPUT', `Texto de auditoría inválido; máximo ${limit} bytes`);
  }
  return value.trim();
}

function validateCatalog(field, value) {
  const text = validateText(value, 50);
  if (!values[field].includes(text)) throw new AppError(400, 'INVALID_INPUT', 'Valor de auditoría no permitido');
  return text;
}

function validateDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) {
    throw new AppError(400, 'INVALID_DATE', 'La fecha debe ser válida y usar YYYY-MM-DD');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new AppError(400, 'INVALID_DATE', 'La fecha debe ser válida y usar YYYY-MM-DD');
  }
  return value;
}

async function registrarEvento(connection, evento) {
  validateObject(evento, ['id_usuario', 'id_sucursal', 'modulo', 'accion', 'entidad', 'id_entidad', 'descripcion']);
  const data = {
    id_usuario: evento.id_usuario == null ? null : validateId(evento.id_usuario),
    id_sucursal: evento.id_sucursal == null ? null : validateId(evento.id_sucursal),
    modulo: validateCatalog('modulo', evento.modulo),
    accion: validateCatalog('accion', evento.accion),
    entidad: validateCatalog('entidad', evento.entidad),
    id_entidad: validateId(evento.id_entidad),
    descripcion: validateText(evento.descripcion, 500),
  };
  const rule = catalog[data.modulo];
  if (rule.entidad !== data.entidad || !rule.acciones.includes(data.accion)) {
    throw new AppError(400, 'INVALID_INPUT', 'Evento incompatible con el módulo');
  }
  // La transacción y la conexión pertenecen exclusivamente al servicio llamante.
  await repository.create(connection, data);
}

async function list(input, user) {
  if (!['ADMINISTRADOR', 'AUDITOR'].includes(user?.nombre_rol)) {
    throw new AppError(403, 'FORBIDDEN', 'Acceso no autorizado');
  }
  validateObject(input, filterFields);
  const filters = {};
  for (const field of filterFields) {
    const value = input[field];
    filters[field] = value === undefined ? null : field.startsWith('id_') ? validateId(value)
      : field.startsWith('fecha_') ? validateDate(value) : validateCatalog(field, value);
  }
  if (filters.fecha_desde && filters.fecha_hasta && filters.fecha_desde > filters.fecha_hasta) {
    throw new AppError(400, 'INVALID_DATE_RANGE', 'fecha_desde no puede ser posterior a fecha_hasta');
  }
  return database.withConnection(connection => repository.list(connection, filters));
}

module.exports = { registrarEvento, list, validateId };
