const service = require('./inventario.service');
const AppError = require('../../shared/AppError');

function parseId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) {
    throw new AppError(400, 'INVALID_ID', 'Identificador inválido');
  }
  return service.validateId(Number(value));
}

async function list(req, res) {
  const filters = {};
  for (const field of ['id_sucursal', 'id_medicamento']) {
    filters[field] = req.query[field] === undefined ? null : parseId(req.query[field]);
  }
  res.json({ ok: true, data: await service.list(filters, req.user), message: 'Inventario consultado' });
}

async function getById(req, res) {
  res.json({ ok: true, data: await service.read(parseId(req.params.id), req.user), message: 'Inventario consultado' });
}

async function movements(req, res) {
  res.json({ ok: true, data: await service.read(parseId(req.params.id), req.user, true), message: 'Movimientos consultados' });
}

async function adjust(req, res) {
  const data = await service.adjust(req.body, req.user);
  res.status(201).json({ ok: true, data, message: 'Movimiento registrado' });
}

module.exports = { list, getById, movements, adjust };
