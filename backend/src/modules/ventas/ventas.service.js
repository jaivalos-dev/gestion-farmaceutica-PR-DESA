const auditoria = require('../auditoria/auditoria.service');
const repository = require('./ventas.repository');
const inventory = require('../inventario/inventario.repository');
const branches = require('../sucursales/sucursales.repository');
const medicines = require('../medicamentos/medicamentos.repository');
const database = require('../../database/connection');
const AppError = require('../../shared/AppError');

const maxNumber = 9999999999;
const maxPriceCents = 9999999999n; // NUMBER(10,2)
const maxTotalCents = 999999999999n; // NUMBER(12,2)

function validateId(value) {
  if (!Number.isInteger(value) || value <= 0 || value > maxNumber) {
    throw new AppError(400, 'INVALID_ID', 'Identificador inválido');
  }
  return value;
}

function requireBranch(user, branch) {
  if (user.nombre_rol !== 'ENCARGADO') throw new AppError(403, 'FORBIDDEN', 'Acceso no autorizado');
  if (!user.id_sucursal || (branch !== undefined && branch !== user.id_sucursal)) {
    throw new AppError(403, 'FORBIDDEN_BRANCH', 'Acceso no autorizado a la sucursal');
  }
  return user.id_sucursal;
}

function requireFound(row) {
  if (!row) throw new AppError(404, 'VENTA_NOT_FOUND', 'Venta inexistente');
  return row;
}

function validateObject(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) {
    throw new AppError(400, 'INVALID_INPUT', 'Datos de venta inválidos');
  }
}

function validateQuantity(value) {
  if (!Number.isInteger(value) || value <= 0 || value > maxNumber) {
    throw new AppError(400, 'INVALID_QUANTITY', 'cantidad debe ser un entero positivo de hasta 10 dígitos');
  }
}

function validateInput(input) {
  validateObject(input, ['forma_pago', 'detalles']);
  if (!['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'OTRO'].includes(input.forma_pago)) {
    throw new AppError(400, 'INVALID_PAYMENT_METHOD', 'Forma de pago inválida');
  }
  if (!Array.isArray(input.detalles) || !input.detalles.length) {
    throw new AppError(400, 'EMPTY_SALE_DETAILS', 'La venta requiere al menos un detalle');
  }
  const quantities = new Map();
  for (const detail of input.detalles) {
    validateObject(detail, ['id_medicamento', 'cantidad']);
    validateId(detail.id_medicamento);
    validateQuantity(detail.cantidad);
    const quantity = (quantities.get(detail.id_medicamento) ?? 0) + detail.cantidad;
    validateQuantity(quantity);
    quantities.set(detail.id_medicamento, quantity);
  }
  return {
    forma_pago: input.forma_pago,
    detalles: [...quantities].sort(([a], [b]) => a - b).map(([id_medicamento, cantidad]) => ({ id_medicamento, cantidad })),
  };
}

function invalidTotal() {
  return new AppError(400, 'INVALID_TOTAL', 'Importe inválido o fuera de la capacidad del modelo');
}

// Oracle entrega importes de escala 2. Convertir su representación decimal evita
// multiplicaciones binarias de dinero; BigInt también evita overflow intermedio.
function toCents(value, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidTotal();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw invalidTotal();
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (cents > maximum) throw invalidTotal();
  return cents;
}

function toAmount(cents) {
  if (cents < 0n || cents > maxTotalCents) throw invalidTotal();
  // El límite de 12 dígitos es menor que MAX_SAFE_INTEGER.
  return Number(cents) / 100;
}

async function requireActiveBranch(connection, id) {
  const branch = await branches.findById(connection, id);
  if (!branch) throw new AppError(404, 'SUCURSAL_NOT_FOUND', 'Sucursal inexistente');
  if (branch.activa !== 'S') throw new AppError(409, 'SUCURSAL_INACTIVE', 'Sucursal inactiva');
}

async function requireActiveMedicine(connection, id) {
  const medicine = await medicines.findById(connection, id);
  if (!medicine) throw new AppError(404, 'MEDICAMENTO_NOT_FOUND', 'Medicamento inexistente');
  if (medicine.activo !== 'S') throw new AppError(409, 'MEDICAMENTO_INACTIVE', 'Medicamento inactivo');
  return medicine;
}

async function list(user) {
  const branch = requireBranch(user);
  return database.withConnection(connection => repository.list(connection, branch));
}

async function read(id, user) {
  requireBranch(user);
  return database.withConnection(async connection => {
    const row = requireFound(await repository.findById(connection, id));
    requireBranch(user, row.id_sucursal);
    return { ...row, detalles: await repository.details(connection, id) };
  });
}

async function create(input, user) {
  const branch = requireBranch(user);
  const data = validateInput(input);
  return database.withTransaction(async connection => {
    await requireActiveBranch(connection, branch);
    const details = [];
    let totalCents = 0n;
    for (const detail of data.detalles) {
      const medicine = await requireActiveMedicine(connection, detail.id_medicamento);
      const price = toCents(medicine.precio, maxPriceCents);
      const subtotal = price * BigInt(detail.cantidad);
      totalCents += subtotal;
      details.push({ ...detail, precio_unitario: toAmount(price), subtotal: toAmount(subtotal) });
    }
    const id = await repository.create(connection, {
      id_sucursal: branch, id_usuario: user.id_usuario, forma_pago: data.forma_pago,
      total: toAmount(totalCents), estado: 'CREADA',
    });
    for (const detail of details) await repository.createDetail(connection, id, detail);
    await auditoria.registrarEvento(connection, {
      id_usuario: user.id_usuario, id_sucursal: branch,
      modulo: 'VENTAS', accion: 'CREAR', entidad: 'VENTA', id_entidad: id,
      descripcion: `Venta ${id} creada; total ${toAmount(totalCents).toFixed(2)}`,
    });
    return { ...await repository.findById(connection, id), detalles: await repository.details(connection, id) };
  });
}

async function lockAndValidateStock(connection, branch, details) {
  const rows = new Map();
  for (const detail of details) {
    if (!rows.has(detail.id_medicamento)) {
      const row = await inventory.findForUpdate(connection, branch, detail.id_medicamento);
      if (!row) throw new AppError(409, 'INVENTARIO_NOT_FOUND', 'Inventario inexistente para el medicamento');
      rows.set(detail.id_medicamento, row);
    }
  }
  const remaining = new Map();
  for (const detail of details) {
    await requireActiveMedicine(connection, detail.id_medicamento);
    const stock = remaining.get(detail.id_medicamento) ?? rows.get(detail.id_medicamento).existencia;
    if (stock < detail.cantidad) throw new AppError(409, 'INSUFFICIENT_STOCK', 'Existencia insuficiente');
    remaining.set(detail.id_medicamento, stock - detail.cantidad);
  }
  return rows;
}

async function deductStock(connection, sale, details, rows, user) {
  for (const detail of details) {
    const row = rows.get(detail.id_medicamento);
    const saldo_anterior = row.existencia;
    const saldo_nuevo = saldo_anterior - detail.cantidad;
    if (await inventory.update(connection, row.id_inventario, saldo_nuevo) !== 1) {
      throw new AppError(409, 'INVENTARIO_CONFLICT', 'El inventario cambió; vuelva a consultar');
    }
    await inventory.createMovement(connection, {
      id_inventario: row.id_inventario, id_usuario: user.id_usuario, tipo_movimiento: 'VENTA',
      cantidad: detail.cantidad, saldo_anterior, saldo_nuevo, referencia: `VENTA:${sale.id_venta}`,
    });
    row.existencia = saldo_nuevo;
  }
}

async function confirm(id, user) {
  requireBranch(user);
  return database.withTransaction(async connection => {
    const row = requireFound(await repository.findById(connection, id, true));
    requireBranch(user, row.id_sucursal);
    if (row.estado !== 'CREADA') throw new AppError(409, 'INVALID_SALE_STATE', 'Solo se puede confirmar una venta CREADA');
    const details = await repository.details(connection, id);
    if (!details.length) throw new AppError(409, 'EMPTY_SALE_DETAILS', 'La venta requiere al menos un detalle');
    const total = toCents(row.total, maxTotalCents);
    if (total === 0n) throw invalidTotal();
    await requireActiveBranch(connection, row.id_sucursal);
    details.sort((a, b) => a.id_medicamento - b.id_medicamento || a.id_detalle - b.id_detalle);
    const rows = await lockAndValidateStock(connection, row.id_sucursal, details);
    await deductStock(connection, row, details, rows, user);
    await repository.createCashMovement(connection, {
      id_sucursal: row.id_sucursal, id_usuario: user.id_usuario, id_venta: id,
      tipo: 'INGRESO', monto: toAmount(total), concepto: `Venta ${id}`,
    });
    if (await repository.setState(connection, id, 'CONFIRMADA') !== 1) {
      throw new AppError(409, 'VENTA_CONFLICT', 'La venta cambió; vuelva a consultar');
    }
    await auditoria.registrarEvento(connection, {
      id_usuario: user.id_usuario, id_sucursal: row.id_sucursal,
      modulo: 'VENTAS', accion: 'CONFIRMAR', entidad: 'VENTA', id_entidad: id,
      descripcion: `Venta ${id} confirmada; total ${toAmount(total).toFixed(2)}`,
    });
    return { ...row, estado: 'CONFIRMADA' };
  });
}

module.exports = { list, read, create, confirm, validateId };
