const repository = require('./transferencias.repository');
const inventory = require('../inventario/inventario.repository');
const branches = require('../sucursales/sucursales.repository');
const medicines = require('../medicamentos/medicamentos.repository');
const database = require('../../database/connection');
const AppError = require('../../shared/AppError');

const maxNumber = 9999999999;
const states = ['SOLICITADA', 'PREPARADA', 'DESPACHADA', 'RECIBIDA', 'CANCELADA'];
const transitions = {
  preparar: { from: ['SOLICITADA'], to: 'PREPARADA' },
  despachar: { from: ['PREPARADA'], to: 'DESPACHADA' },
  recibir: { from: ['DESPACHADA'], to: 'RECIBIDA' },
  cancelar: { from: ['SOLICITADA', 'PREPARADA'], to: 'CANCELADA' },
};

function validateId(value) {
  if (!Number.isInteger(value) || value <= 0 || value > maxNumber) {
    throw new AppError(400, 'INVALID_ID', 'Identificador inválido');
  }
  return value;
}

function validateState(value) {
  if (!states.includes(value)) throw new AppError(400, 'INVALID_TRANSFER_STATE', 'Estado de transferencia inválido');
  return value;
}

function requireBranch(user, allowed) {
  if (user.nombre_rol !== 'ENCARGADO') throw new AppError(403, 'FORBIDDEN', 'Acceso no autorizado');
  if (!user.id_sucursal || (allowed && !allowed.includes(user.id_sucursal))) {
    throw new AppError(403, 'FORBIDDEN_BRANCH', 'Acceso no autorizado a la sucursal');
  }
  return user.id_sucursal;
}

function requireFound(row) {
  if (!row) throw new AppError(404, 'TRANSFERENCIA_NOT_FOUND', 'Transferencia inexistente');
  return row;
}

function validateObject(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) {
    throw new AppError(400, 'INVALID_INPUT', 'Datos de transferencia inválidos');
  }
}

function validateQuantity(value) {
  if (!Number.isInteger(value) || value <= 0 || value > maxNumber) {
    throw new AppError(400, 'INVALID_QUANTITY', 'cantidad debe ser un entero positivo de hasta 10 dígitos');
  }
}

function validateInput(input) {
  validateObject(input, ['id_sucursal_origen', 'id_sucursal_destino', 'observacion', 'detalles']);
  validateId(input.id_sucursal_origen);
  validateId(input.id_sucursal_destino);
  if (input.id_sucursal_origen === input.id_sucursal_destino) {
    throw new AppError(400, 'SAME_BRANCH_TRANSFER', 'Origen y destino deben ser distintos');
  }
  if (!Array.isArray(input.detalles) || !input.detalles.length) {
    throw new AppError(400, 'EMPTY_TRANSFER_DETAILS', 'La transferencia requiere al menos un detalle');
  }
  for (const detail of input.detalles) {
    validateObject(detail, ['id_medicamento', 'cantidad']);
    validateId(detail.id_medicamento);
    validateQuantity(detail.cantidad);
  }
  if (input.observacion != null && (typeof input.observacion !== 'string' || Buffer.byteLength(input.observacion.trim(), 'utf8') > 250)) {
    throw new AppError(400, 'INVALID_INPUT', 'observacion admite hasta 250 bytes');
  }
  return { ...input, observacion: input.observacion?.trim() || null };
}

async function requireActiveCatalogs(connection, row, details) {
  for (const id of [row.id_sucursal_origen, row.id_sucursal_destino]) {
    const branch = await branches.findById(connection, id);
    if (!branch) throw new AppError(404, 'SUCURSAL_NOT_FOUND', 'Sucursal inexistente');
    if (branch.activa !== 'S') throw new AppError(409, 'SUCURSAL_INACTIVE', 'Sucursal inactiva');
  }
  for (const id of new Set(details.map(detail => detail.id_medicamento))) {
    const medicine = await medicines.findById(connection, id);
    if (!medicine) throw new AppError(404, 'MEDICAMENTO_NOT_FOUND', 'Medicamento inexistente');
    if (medicine.activo !== 'S') throw new AppError(409, 'MEDICAMENTO_INACTIVE', 'Medicamento inactivo');
  }
}

async function list(filters, user) {
  const id_sucursal = requireBranch(user);
  return database.withConnection(connection => repository.list(connection, { ...filters, id_sucursal }));
}

async function read(id, user) {
  requireBranch(user);
  return database.withConnection(async connection => {
    const row = requireFound(await repository.findById(connection, id));
    requireBranch(user, [row.id_sucursal_origen, row.id_sucursal_destino]);
    return { ...row, detalles: await repository.details(connection, id) };
  });
}

async function create(input, user) {
  const data = validateInput(input);
  requireBranch(user, [data.id_sucursal_origen]);
  return database.withTransaction(async connection => {
    await requireActiveCatalogs(connection, data, data.detalles);
    const id = await repository.create(connection, {
      id_sucursal_origen: data.id_sucursal_origen, id_sucursal_destino: data.id_sucursal_destino,
      id_usuario: user.id_usuario, estado: 'SOLICITADA', observacion: data.observacion,
    });
    for (const detail of data.detalles) await repository.createDetail(connection, id, detail);
    return { ...await repository.findById(connection, id), detalles: await repository.details(connection, id) };
  });
}

// La cabecera ya está bloqueada. Cada inventario se bloquea una vez y en orden fijo.
async function lockInventories(connection, branch, details) {
  const rows = new Map();
  for (const detail of details) {
    if (!rows.has(detail.id_medicamento)) {
      rows.set(detail.id_medicamento, await inventory.findForUpdate(connection, branch, detail.id_medicamento));
    }
  }
  return rows;
}

function requireStock(details, rows) {
  const remaining = new Map();
  for (const detail of details) {
    const previous = remaining.get(detail.id_medicamento) ?? rows.get(detail.id_medicamento)?.existencia ?? 0;
    if (previous < detail.cantidad) throw new AppError(409, 'INSUFFICIENT_STOCK', 'Existencia insuficiente');
    remaining.set(detail.id_medicamento, previous - detail.cantidad);
  }
}

async function applyMovement(connection, row, detail, rows, user, receiving) {
  const current = rows.get(detail.id_medicamento);
  const saldo_anterior = current?.existencia ?? 0;
  const saldo_nuevo = saldo_anterior + (receiving ? detail.cantidad : -detail.cantidad);
  if (saldo_nuevo < 0) throw new AppError(409, 'INSUFFICIENT_STOCK', 'Existencia insuficiente');
  if (saldo_nuevo > maxNumber) throw new AppError(400, 'INVALID_QUANTITY', 'El saldo excede la capacidad de NUMBER(10)');
  let id_inventario = current?.id_inventario;
  if (current) {
    if (await inventory.update(connection, id_inventario, saldo_nuevo) !== 1) {
      throw new AppError(409, 'INVENTARIO_CONFLICT', 'El inventario cambió; vuelva a consultar');
    }
  } else {
    try {
      id_inventario = await inventory.create(connection, row.id_sucursal_destino, detail.id_medicamento, saldo_nuevo);
    } catch (error) {
      // La combinación inexistente no se puede bloquear: UNIQUE resuelve la carrera.
      if (error.errorNum === 1 && /\bUQ_INV_SUC_MED\b/i.test(error.message)) {
        throw new AppError(409, 'INVENTARIO_CONFLICT', 'El inventario ya fue creado; vuelva a consultar y reintente');
      }
      throw error;
    }
  }
  await inventory.createMovement(connection, {
    id_inventario, id_usuario: user.id_usuario,
    tipo_movimiento: receiving ? 'TRANSFERENCIA_RECEPCION' : 'TRANSFERENCIA_DESPACHO',
    cantidad: detail.cantidad, saldo_anterior, saldo_nuevo, referencia: `TRANSFERENCIA:${row.id_transferencia}`,
  });
  rows.set(detail.id_medicamento, { id_inventario, existencia: saldo_nuevo });
}

async function transition(id, action, user) {
  requireBranch(user);
  return database.withTransaction(async connection => {
    const row = requireFound(await repository.findForUpdate(connection, id));
    const receiving = action === 'recibir';
    requireBranch(user, [receiving ? row.id_sucursal_destino : row.id_sucursal_origen]);
    validateState(row.estado);
    const rule = transitions[action];
    if (!rule || !rule.from.includes(row.estado)) {
      throw new AppError(409, 'INVALID_STATE_TRANSITION', 'Transición de estado no permitida');
    }
    if (action !== 'cancelar') {
      const details = await repository.details(connection, id);
      if (!details.length) throw new AppError(409, 'EMPTY_TRANSFER_DETAILS', 'La transferencia requiere al menos un detalle');
      details.sort((a, b) => a.id_medicamento - b.id_medicamento || a.id_detalle - b.id_detalle);
      await requireActiveCatalogs(connection, row, details);
      const rows = await lockInventories(connection, receiving ? row.id_sucursal_destino : row.id_sucursal_origen, details);
      if (!receiving) requireStock(details, rows);
      if (action !== 'preparar') {
        for (const detail of details) await applyMovement(connection, row, detail, rows, user, receiving);
      }
    }
    if (await repository.setState(connection, id, rule.to) !== 1) {
      throw new AppError(409, 'TRANSFERENCIA_CONFLICT', 'La transferencia cambió; vuelva a consultar');
    }
    // AUDITORIA queda pendiente de la infraestructura transversal, como en Inventario.
    return { ...row, estado: rule.to };
  });
}

module.exports = { list, read, create, transition, validateId, validateState };
