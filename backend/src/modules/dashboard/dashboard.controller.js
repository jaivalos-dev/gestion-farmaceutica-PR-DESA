const service = require('./dashboard.service');
const AppError = require('../../shared/AppError');

async function summary(req, res) {
  const filters = { ...req.query };
  if (filters.id_sucursal !== undefined) {
    if (typeof filters.id_sucursal !== 'string' || !/^[1-9]\d{0,9}$/.test(filters.id_sucursal)) {
      throw new AppError(400, 'INVALID_ID', 'Identificador inválido');
    }
    filters.id_sucursal = Number(filters.id_sucursal);
  }
  const data = await service.summary(filters, req.user);
  res.json({ ok: true, data, message: 'Resumen de dashboard consultado' });
}

module.exports = { summary };
