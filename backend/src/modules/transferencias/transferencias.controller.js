const service = require('./transferencias.service');
const AppError = require('../../shared/AppError');

function parseId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) {
    throw new AppError(400, 'INVALID_ID', 'Identificador inválido');
  }
  return service.validateId(Number(value));
}

async function list(req, res) {
  const filters = { estado: req.query.estado === undefined ? null : service.validateState(req.query.estado) };
  for (const field of ['id_sucursal_origen', 'id_sucursal_destino']) {
    filters[field] = req.query[field] === undefined ? null : parseId(req.query[field]);
  }
  res.json({ ok: true, data: await service.list(filters, req.user), message: 'Transferencias consultadas' });
}

async function getById(req, res) {
  res.json({ ok: true, data: await service.read(parseId(req.params.id), req.user), message: 'Transferencia consultada' });
}

async function create(req, res) {
  res.status(201).json({ ok: true, data: await service.create(req.body, req.user), message: 'Transferencia creada' });
}

function action(name) {
  return async (req, res) => {
    if (req.body !== undefined && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) {
      throw new AppError(400, 'INVALID_INPUT', 'La acción no admite campos en el cuerpo');
    }
    const data = await service.transition(parseId(req.params.id), name, req.user);
    res.json({ ok: true, data, message: 'Estado de transferencia actualizado' });
  };
}

module.exports = { list, getById, create, preparar: action('preparar'), despachar: action('despachar'), recibir: action('recibir'), cancelar: action('cancelar') };
