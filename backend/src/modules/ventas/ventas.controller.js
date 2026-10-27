const service = require('./ventas.service');
const AppError = require('../../shared/AppError');

function parseId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) {
    throw new AppError(400, 'INVALID_ID', 'Identificador inválido');
  }
  return service.validateId(Number(value));
}

async function list(req, res) {
  res.json({ ok: true, data: await service.list(req.user), message: 'Ventas consultadas' });
}

async function getById(req, res) {
  res.json({ ok: true, data: await service.read(parseId(req.params.id), req.user), message: 'Venta consultada' });
}

async function create(req, res) {
  res.status(201).json({ ok: true, data: await service.create(req.body, req.user), message: 'Venta creada' });
}

async function confirm(req, res) {
  if (req.body !== undefined && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) {
    throw new AppError(400, 'INVALID_INPUT', 'La confirmación no admite campos en el cuerpo');
  }
  res.json({ ok: true, data: await service.confirm(parseId(req.params.id), req.user), message: 'Venta confirmada' });
}

module.exports = { list, getById, create, confirm };
