const repository = require('./sucursales.repository');
const auditoria = require('../auditoria/auditoria.service');
const database = require('../../database/connection');
const AppError = require('../../shared/AppError');

const limits = { nombre: 100, tipo_sucursal: 30, departamento: 50, municipio: 50, direccion: 200 };

function invalid(message) {
  return new AppError(400, 'INVALID_INPUT', message);
}

function validateObject(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !allowed.includes(key))) {
    throw invalid('Datos de sucursal inválidos');
  }
}

function validateState(activa) {
  if (!['S', 'N'].includes(activa)) throw invalid('activa debe ser S o N');
  return activa;
}

function validateData(input, creating = false) {
  validateObject(input, [...Object.keys(limits), 'activa']);
  const data = {};
  for (const [field, max] of Object.entries(limits)) {
    if (typeof input[field] !== 'string' || !input[field].trim() ||
        Buffer.byteLength(input[field].trim(), 'utf8') > max) {
      throw invalid(`${field} es obligatorio y admite hasta ${max} bytes`);
    }
    data[field] = input[field].trim();
  }
  if (!['FARMACIA', 'STAND'].includes(data.tipo_sucursal)) {
    throw invalid('tipo_sucursal debe ser FARMACIA o STAND');
  }
  data.activa = validateState(creating && input.activa === undefined ? 'S' : input.activa);
  return data;
}

function requireFound(row) {
  if (!row) throw new AppError(404, 'SUCURSAL_NOT_FOUND', 'Sucursal inexistente');
  return row;
}

async function list() {
  return database.withConnection(connection => repository.list(connection));
}

async function getById(id) {
  return database.withConnection(async connection => requireFound(await repository.findById(connection, id)));
}

async function create(input, actor) {
  const data = validateData(input, true);
  return database.withTransaction(async connection => {
    const id = await repository.create(connection, data);
    const result = requireFound(await repository.findById(connection, id));
    await auditoria.registrarEvento(connection, {
      id_usuario: actor.id_usuario, id_sucursal: id,
      modulo: 'SUCURSALES', accion: 'CREAR', entidad: 'SUCURSAL',
      id_entidad: id, descripcion: `Sucursal ${id} creada`,
    });
    return result;
  });
}

async function update(id, input, actor) {
  const data = validateData(input);
  return database.withTransaction(async connection => {
    const rowsAffected = await repository.update(connection, id, data);
    if (rowsAffected === 0) {
      throw new AppError(404, 'SUCURSAL_NOT_FOUND', 'Sucursal inexistente');
    }
    const result = requireFound(await repository.findById(connection, id));
    await auditoria.registrarEvento(connection, {
      id_usuario: actor.id_usuario, id_sucursal: id,
      modulo: 'SUCURSALES', accion: 'MODIFICAR', entidad: 'SUCURSAL',
      id_entidad: id, descripcion: `Sucursal ${id} actualizada; activa=${result.activa}`,
    });
    return result;
  });
}

async function setState(id, input, actor) {
  validateObject(input, ['activa']);
  const activa = validateState(input.activa);
  return database.withTransaction(async connection => {
    const rowsAffected = await repository.setState(connection, id, activa);
    if (rowsAffected === 0) {
      throw new AppError(404, 'SUCURSAL_NOT_FOUND', 'Sucursal inexistente');
    }
    const result = requireFound(await repository.findById(connection, id));
    await auditoria.registrarEvento(connection, {
      id_usuario: actor.id_usuario, id_sucursal: id,
      modulo: 'SUCURSALES', accion: 'MODIFICAR', entidad: 'SUCURSAL',
      id_entidad: id, descripcion: `Sucursal ${id} actualizada; activa=${result.activa}`,
    });
    return result;
  });
}

// Los futuros servicios de operaciones deben usar esta validación en su transacción.
async function requireActive(id, connection) {
  const row = connection
    ? requireFound(await repository.findById(connection, id)) : await getById(id);
  if (row.activa !== 'S') throw new AppError(409, 'SUCURSAL_INACTIVE', 'Sucursal inactiva');
  return row;
}

module.exports = { list, getById, create, update, setState, requireActive };
