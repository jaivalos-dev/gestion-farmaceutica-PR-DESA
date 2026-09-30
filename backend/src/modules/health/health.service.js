const repository = require('./health.repository');
const AppError = require('../../shared/AppError');

async function getHealth() {
  try {
    if (!await repository.checkOracle()) throw new Error('Respuesta inesperada');
    return { api: 'up', oracle: 'up' };
  } catch {
    throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Oracle no está disponible');
  }
}

module.exports = { getHealth };
