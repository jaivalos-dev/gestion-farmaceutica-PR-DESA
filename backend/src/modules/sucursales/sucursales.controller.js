const service = require('./sucursales.service');
const AppError = require('../../shared/AppError');

function parseId(value) {
  if (!/^[1-9]\d{0,9}$/.test(value)) {
    throw new AppError(400, 'INVALID_ID', 'Identificador de sucursal inválido');
  }
  return Number(value);
}

async function list(req, res) {
  res.json({ ok: true, data: await service.list(), message: 'Sucursales consultadas' });
}

async function getById(req, res) {
  res.json({ ok: true, data: await service.getById(parseId(req.params.id)), message: 'Sucursal consultada' });
}

async function create(req, res) {
  const data = await service.create(req.body, req.user);
  res.location(`/api/sucursales/${data.id_sucursal}`).status(201)
    .json({ ok: true, data, message: 'Sucursal creada' });
}

async function update(req, res) {
  const data = await service.update(parseId(req.params.id), req.body, req.user);
  res.json({ ok: true, data, message: 'Sucursal actualizada' });
}

async function setState(req, res) {
  const data = await service.setState(parseId(req.params.id), req.body, req.user);
  res.json({ ok: true, data, message: 'Estado actualizado' });
}

module.exports = { list, getById, create, update, setState };
