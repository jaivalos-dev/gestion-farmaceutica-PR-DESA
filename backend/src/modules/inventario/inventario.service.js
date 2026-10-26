const repository = require('./inventario.repository');
const sucursales = require('../sucursales/sucursales.repository');
const medicamentos = require('../medicamentos/medicamentos.repository');
const database = require('../../database/connection');
const AppError = require('../../shared/AppError');

const maxNumber = 9999999999;

function validateId(value) {
  if (!Number.isInteger(value) || value <= 0 || value > maxNumber) {
    throw new AppError(400, 'INVALID_ID', 'Identificador inválido');
  }
  return value;
}

function branchScope(user, branch) {
  if (user.nombre_rol !== 'ENCARGADO') return branch;
  if (!user.id_sucursal || (branch != null && branch !== user.id_sucursal)) {
    throw new AppError(403, 'FORBIDDEN', 'Acceso no autorizado a la sucursal');
  }
  return user.id_sucursal;
}

function requireFound(row) {
  if (!row) throw new AppError(404, 'INVENTARIO_NOT_FOUND', 'Inventario inexistente');
  return row;
}

async function list(filters, user) {
  const id_sucursal = branchScope(user, filters.id_sucursal);
  return database.withConnection(connection => repository.list(connection, { ...filters, id_sucursal }));
}

async function read(id, user, history = false) {
  branchScope(user, null);
  return database.withConnection(async connection => {
    const row = requireFound(await repository.findById(connection, id));
    branchScope(user, row.id_sucursal);
    return history ? repository.movements(connection, id) : row;
  });
}

function validateInput(input) {
  const allowed = ['id_sucursal', 'id_medicamento', 'tipo_movimiento', 'cantidad', 'referencia'];
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !allowed.includes(key))) {
    throw new AppError(400, 'INVALID_INPUT', 'Datos de movimiento inválidos');
  }
  validateId(input.id_sucursal);
  validateId(input.id_medicamento);
  if (!Number.isInteger(input.cantidad) || input.cantidad <= 0 || input.cantidad > maxNumber) {
    throw new AppError(400, 'INVALID_QUANTITY', 'cantidad debe ser un entero positivo de hasta 10 dígitos');
  }
  if (!['ENTRADA', 'SALIDA', 'AJUSTE'].includes(input.tipo_movimiento)) {
    throw new AppError(400, 'INVALID_MOVEMENT_TYPE', 'Tipo de movimiento no permitido en CU-05');
  }
  if (typeof input.referencia !== 'string' || !input.referencia.trim() ||
      Buffer.byteLength(input.referencia.trim(), 'utf8') > 100) {
    throw new AppError(400, 'INVALID_REFERENCE', 'referencia es obligatoria y admite hasta 100 bytes');
  }
  return { ...input, referencia: input.referencia.trim() };
}

async function requireActiveCatalogs(connection, data) {
  const branch = await sucursales.findById(connection, data.id_sucursal);
  if (!branch) throw new AppError(404, 'SUCURSAL_NOT_FOUND', 'Sucursal inexistente');
  if (branch.activa !== 'S') throw new AppError(409, 'SUCURSAL_INACTIVE', 'Sucursal inactiva');
  const medicine = await medicamentos.findById(connection, data.id_medicamento);
  if (!medicine) throw new AppError(404, 'MEDICAMENTO_NOT_FOUND', 'Medicamento inexistente');
  if (medicine.activo !== 'S') throw new AppError(409, 'MEDICAMENTO_INACTIVE', 'Medicamento inactivo');
}

async function adjust(input, user) {
  const data = validateInput(input);
  branchScope(user, data.id_sucursal);
  return database.withTransaction(async connection => {
    await requireActiveCatalogs(connection, data);
    const inventory = await repository.findForUpdate(connection, data.id_sucursal, data.id_medicamento);
    if (!inventory && data.tipo_movimiento !== 'ENTRADA') requireFound(inventory);
    const saldo_anterior = inventory?.existencia ?? 0;
    const saldo_nuevo = saldo_anterior + (data.tipo_movimiento === 'SALIDA' ? -data.cantidad : data.cantidad);
    if (saldo_nuevo < 0) throw new AppError(409, 'INSUFFICIENT_STOCK', 'Existencia insuficiente');
    if (saldo_nuevo > maxNumber) throw new AppError(400, 'INVALID_QUANTITY', 'El saldo excede la capacidad de NUMBER(10)');
    let id_inventario = inventory?.id_inventario;
    if (inventory) {
      if (await repository.update(connection, id_inventario, saldo_nuevo) !== 1) {
        throw new AppError(409, 'INVENTARIO_CONFLICT', 'El inventario cambió; vuelva a consultar');
      }
    } else {
      try {
        id_inventario = await repository.create(connection, data.id_sucursal, data.id_medicamento, saldo_nuevo);
      } catch (error) {
        // Otra entrada inicial puede ganar la carrera sobre la combinación UNIQUE.
        if (error.errorNum === 1 && /\bUQ_INV_SUC_MED\b/i.test(error.message)) {
          throw new AppError(409, 'INVENTARIO_CONFLICT', 'El inventario ya fue creado; vuelva a consultar y reintente');
        }
        throw error;
      }
    }
    const movement = {
      id_inventario, id_usuario: user.id_usuario, tipo_movimiento: data.tipo_movimiento,
      cantidad: data.cantidad, saldo_anterior, saldo_nuevo, referencia: data.referencia,
    };
    const id_movimiento = await repository.createMovement(connection, movement);
    // AUDITORIA queda pendiente del servicio transversal; MOVIMIENTO_INVENTARIO es obligatorio.
    return { id_movimiento, ...movement };
  });
}

module.exports = { list, read, adjust, validateId };
