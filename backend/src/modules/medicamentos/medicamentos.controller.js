const service = require('./medicamentos.service');
const AppError = require('../../shared/AppError');

function parseId(value) {
  if (!/^[1-9]\d{0,9}$/.test(value)) {
    throw new AppError(400, 'INVALID_ID', 'Identificador de medicamento inválido');
  }
  return Number(value);
}

async function list(req, res) {
  res.json({ ok: true, data: await service.list(), message: 'Medicamentos consultados' });
}

async function getById(req, res) {
  res.json({ ok: true, data: await service.getById(parseId(req.params.id)), message: 'Medicamento consultado' });
}

async function create(req, res) {
  const data = await service.create(req.body);
  res.location(`/api/medicamentos/${data.id_medicamento}`).status(201)
    .json({ ok: true, data, message: 'Medicamento creado' });
}

async function update(req, res) {
  const data = await service.update(parseId(req.params.id), req.body);
  res.json({ ok: true, data, message: 'Medicamento actualizado' });
}

async function setState(req, res) {
  const data = await service.setState(parseId(req.params.id), req.body);
  res.json({ ok: true, data, message: 'Estado actualizado' });
}

module.exports = { list, getById, create, update, setState };
