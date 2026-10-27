const service = require('./activos.service');
const AppError = require('../../shared/AppError');

function parseId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) {
    throw new AppError(400, 'INVALID_ID', 'Identificador inválido');
  }
  return service.validateId(Number(value));
}

async function list(req, res) {
  const filters = { ...req.query };
  if (filters.id_sucursal !== undefined) filters.id_sucursal = parseId(filters.id_sucursal);
  res.json({ ok: true, data: await service.list(filters, req.user), message: 'Activos consultados' });
}

async function getById(req, res) {
  res.json({ ok: true, data: await service.read(parseId(req.params.id), req.user), message: 'Activo consultado' });
}

async function create(req, res) {
  const data = await service.create(req.body, req.user);
  res.location(`/api/activos/${data.id_activo}`).status(201)
    .json({ ok: true, data, message: 'Activo registrado' });
}

async function update(req, res) {
  const data = await service.update(parseId(req.params.id), req.body, req.user);
  res.json({ ok: true, data, message: 'Activo actualizado' });
}

module.exports = { list, getById, create, update };
