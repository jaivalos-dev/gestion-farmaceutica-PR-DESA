const repository = require('./medicamentos.repository');
const database = require('../../database/connection');
const AppError = require('../../shared/AppError');

const limits = { codigo: 30, nombre: 120, categoria: 60, presentacion: 80 };

function invalid(message) {
  return new AppError(400, 'INVALID_INPUT', message);
}

function validateObject(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !allowed.includes(key))) {
    throw invalid('Datos de medicamento inválidos');
  }
}

function validateState(activo) {
  if (!['S', 'N'].includes(activo)) throw invalid('activo debe ser S o N');
  return activo;
}

function validateData(input, creating = false) {
  validateObject(input, [...Object.keys(limits), 'precio', 'activo']);
  const data = {};
  for (const [field, max] of Object.entries(limits)) {
    if (typeof input[field] !== 'string' || !input[field].trim() ||
        Buffer.byteLength(input[field].trim(), 'utf8') > max) {
      throw invalid(`${field} es obligatorio y admite hasta ${max} bytes`);
    }
    data[field] = input[field].trim();
  }
  // NUMBER(10,2) redondea a dos decimales; no exigir precio estrictamente positivo.
  if (typeof input.precio !== 'number' || !Number.isFinite(input.precio) ||
      input.precio < 0 || input.precio >= 99999999.995) {
    throw invalid('precio debe ser numérico, mayor o igual a cero y caber en NUMBER(10,2)');
  }
  data.precio = input.precio;
  data.activo = validateState(creating && input.activo === undefined ? 'S' : input.activo);
  return data;
}

function requireFound(row) {
  if (!row) throw new AppError(404, 'MEDICAMENTO_NOT_FOUND', 'Medicamento inexistente');
  return row;
}

async function list() {
  return database.withConnection(connection => repository.list(connection));
}

async function getById(id) {
  return database.withConnection(async connection => requireFound(await repository.findById(connection, id)));
}

async function create(input) {
  const data = validateData(input, true);
  return database.withTransaction(async connection => {
    let id;
    try {
      id = await repository.create(connection, data);
    } catch (error) {
      throwWriteError(error);
    }
    return requireFound(await repository.findById(connection, id));
  });
}

async function update(id, input) {
  const data = validateData(input);
  return database.withTransaction(async connection => {
    let rowsAffected;
    try {
      rowsAffected = await repository.update(connection, id, data);
    } catch (error) {
      throwWriteError(error);
    }
    if (rowsAffected === 0) {
      throw new AppError(404, 'MEDICAMENTO_NOT_FOUND', 'Medicamento inexistente');
    }
    return requireFound(await repository.findById(connection, id));
  });
}

async function setState(id, input) {
  validateObject(input, ['activo']);
  const activo = validateState(input.activo);
  return database.withTransaction(async connection => {
    const rowsAffected = await repository.setState(connection, id, activo);
    if (rowsAffected === 0) {
      throw new AppError(404, 'MEDICAMENTO_NOT_FOUND', 'Medicamento inexistente');
    }
    return requireFound(await repository.findById(connection, id));
  });
}

// Los futuros servicios de operaciones deben usar esta validación en su transacción.
async function requireActive(id, connection) {
  const row = connection
    ? requireFound(await repository.findById(connection, id)) : await getById(id);
  if (row.activo !== 'S') throw new AppError(409, 'MEDICAMENTO_INACTIVE', 'Medicamento inactivo');
  return row;
}

function throwWriteError(error) {
  // La constraint resuelve también inserciones/actualizaciones concurrentes.
  if (error.errorNum === 1 && /\bUQ_MED_CODIGO\b/i.test(error.message)) {
    throw new AppError(409, 'MEDICAMENTO_CODE_DUPLICATE', 'El código de medicamento ya existe');
  }
  throw error;
}

module.exports = { list, getById, create, update, setState, requireActive };
