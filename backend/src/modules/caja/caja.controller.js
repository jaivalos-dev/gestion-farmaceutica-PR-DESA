const service = require('./caja.service');
const AppError = require('../../shared/AppError');

function parseId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) {
    throw new AppError(400, 'INVALID_ID', 'Identificador inválido');
  }
  return service.validateId(Number(value));
}

async function list(req, res) {
  const filters = { ...req.query };
  for (const field of ['id_sucursal', 'id_venta']) {
    if (filters[field] !== undefined) filters[field] = parseId(filters[field]);
  }
  res.json({ ok: true, data: await service.list(filters, req.user), message: 'Movimientos de caja consultados' });
}

async function getById(req, res) {
  res.json({ ok: true, data: await service.read(parseId(req.params.id), req.user), message: 'Movimiento de caja consultado' });
}

async function create(req, res) {
  const data = await service.create(req.body, req.user);
  res.location(`/api/caja/movimientos/${data.id_mov_caja}`).status(201)
    .json({ ok: true, data, message: 'Movimiento de caja registrado' });
}

module.exports = { list, getById, create };
