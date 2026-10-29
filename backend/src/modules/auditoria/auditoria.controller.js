const service = require('./auditoria.service');
const AppError = require('../../shared/AppError');

async function list(req, res) {
  const filters = { ...req.query };
  for (const field of ['id_usuario', 'id_sucursal', 'id_entidad']) {
    if (filters[field] === undefined) continue;
    if (typeof filters[field] !== 'string' || !/^[1-9]\d{0,9}$/.test(filters[field])) {
      throw new AppError(400, 'INVALID_ID', 'Identificador inválido');
    }
    filters[field] = service.validateId(Number(filters[field]));
  }
  res.json({ ok: true, data: await service.list(filters, req.user), message: 'Auditoría consultada' });
}

module.exports = { list };
