const repository = require('./disponibilidad.repository');
const medicines = require('../medicamentos/medicamentos.repository');
const database = require('../../database/connection');
const AppError = require('../../shared/AppError');

function validatePositiveInteger(value, code = 'INVALID_ID') {
  if (!Number.isInteger(value) || value <= 0 || value > 9999999999) {
    throw new AppError(400, code, 'Se requiere un entero positivo de hasta 10 dígitos');
  }
  return value;
}

function validateLocation(value) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value.trim(), 'utf8') > 50) {
    throw new AppError(400, 'INVALID_LOCATION', 'Departamento y municipio requieren texto no vacío de hasta 50 bytes');
  }
  return value.trim();
}

// Regla técnica del MVP: coincidencia textual, sin distancia ni tráfico real.
// Normalizar solo para comparar; los valores originales se conservan.
function locationEstimate(branch, destination) {
  const normalize = value => value.trim().normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
  const sameDepartment = normalize(branch.departamento) === normalize(destination.departamento);
  const sameMunicipality = normalize(branch.municipio) === normalize(destination.municipio);
  const prioridad = sameDepartment ? (sameMunicipality ? 1 : 2) : 3;
  const tiempo_estimado = prioridad === 1 ? 30 : prioridad === 2 ? 60 : null;
  return { prioridad, tiempo_estimado, eta_disponible: tiempo_estimado !== null };
}

async function consult(input, user) {
  if (!['ENCARGADO', 'DESPACHO', 'ADMINISTRADOR'].includes(user.nombre_rol)) {
    throw new AppError(403, 'FORBIDDEN', 'Acceso no autorizado');
  }
  if (Object.keys(input).some(key => !['id_medicamento', 'cantidad', 'departamento', 'municipio'].includes(key))) {
    throw new AppError(400, 'INVALID_INPUT', 'Parámetros de disponibilidad inválidos');
  }
  const id_medicamento = validatePositiveInteger(input.id_medicamento);
  const cantidad = validatePositiveInteger(input.cantidad, 'INVALID_QUANTITY');
  const destination = { departamento: validateLocation(input.departamento), municipio: validateLocation(input.municipio) };
  return database.withConnection(async connection => {
    const medicine = await medicines.findById(connection, id_medicamento);
    if (!medicine) throw new AppError(404, 'MEDICAMENTO_NOT_FOUND', 'Medicamento inexistente');
    if (medicine.activo !== 'S') throw new AppError(409, 'MEDICAMENTO_INACTIVE', 'Medicamento inactivo');
    const rows = await repository.candidates(connection, id_medicamento, cantidad);
    const candidatos = rows.map(row => ({
      ...row, cantidad_solicitada: cantidad, ...locationEstimate(row, destination),
      formas_pago: ['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'OTRO'],
    })).sort((a, b) => a.prioridad - b.prioridad || b.existencia - a.existencia || a.id_sucursal - b.id_sucursal);
    // Consulta informativa: confirmar VENTA vuelve a validar y descontar stock.
    return { disponible: candidatos.length > 0, id_medicamento, cantidad, candidatos };
  });
}

module.exports = { consult, locationEstimate };
