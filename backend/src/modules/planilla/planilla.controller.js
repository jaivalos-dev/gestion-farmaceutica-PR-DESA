const service = require('./planilla.service');
const AppError = require('../../shared/AppError');

function parseId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) {
    throw new AppError(400, 'INVALID_ID', 'Identificador inválido');
  }
  return service.validateId(Number(value));
}

function parseFilters(query) {
  const filters = { ...query };
  if (filters.id_sucursal !== undefined) filters.id_sucursal = parseId(filters.id_sucursal);
  return filters;
}

async function list(req, res) {
  const data = await service.list(parseFilters(req.query), req.user);
  res.json({ ok: true, data, message: 'Gastos de planilla consultados' });
}

async function getById(req, res) {
  const data = await service.read(parseId(req.params.id), req.user);
  res.json({ ok: true, data, message: 'Gasto de planilla consultado' });
}

async function summary(req, res) {
  const data = await service.summary(parseFilters(req.query), req.user);
  res.json({ ok: true, data, message: 'Resumen de planilla consultado' });
}

async function create(req, res) {
  const data = await service.create(req.body, req.user);
  res.location(`/api/planilla/gastos/${data.id_gasto}`).status(201)
    .json({ ok: true, data, message: 'Gasto de planilla registrado' });
}

module.exports = { list, getById, summary, create };
