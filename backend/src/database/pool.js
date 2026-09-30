const oracledb = require('oracledb');
const AppError = require('../shared/AppError');

let pool;

function connectionError() {
  return new AppError(503, 'DATABASE_UNAVAILABLE', 'Oracle no está disponible');
}

async function initializePool(config) {
  if (pool) return;
  try {
    pool = await oracledb.createPool({
      ...config,
      // Conexión diferida: la API puede devolver 503 si Oracle está caído.
      poolMin: 0,
      poolMax: 4,
      poolIncrement: 1,
      queueTimeout: 5000,
      connectTimeout: 5,
      retryCount: 0,
    });
  } catch {
    throw connectionError();
  }
}

async function getConnection() {
  if (!pool) throw connectionError();
  try {
    return await pool.getConnection();
  } catch {
    throw connectionError();
  }
}

async function closePool() {
  if (!pool) return;
  await pool.close(5);
  pool = undefined;
}

module.exports = { initializePool, getConnection, closePool };
