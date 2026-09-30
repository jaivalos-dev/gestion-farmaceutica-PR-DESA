const pool = require('./pool');

async function withConnection(operation) {
  const connection = await pool.getConnection();
  try {
    connection.callTimeout = 5000;
    return await operation(connection);
  } finally {
    await connection.close();
  }
}

async function withTransaction(operation) {
  return withConnection(async connection => {
    try {
      const result = await operation(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
}

module.exports = { withConnection, withTransaction };
