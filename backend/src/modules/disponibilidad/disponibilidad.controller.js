const service = require('./disponibilidad.service');
const AppError = require('../../shared/AppError');

function parsePositiveInteger(value, code) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) {
    throw new AppError(400, code, 'Se requiere un entero positivo de hasta 10 dígitos');
  }
  return Number(value);
}

async function consult(req, res) {
  const input = {
    ...req.query,
    id_medicamento: parsePositiveInteger(req.query.id_medicamento, 'INVALID_ID'),
    cantidad: parsePositiveInteger(req.query.cantidad, 'INVALID_QUANTITY'),
  };
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, data: await service.consult(input, req.user), message: 'Disponibilidad informativa; no reserva stock. ETA básico del MVP' });
}

module.exports = { consult };
