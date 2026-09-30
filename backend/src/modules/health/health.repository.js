const database = require('../../database/pool');

async function checkOracle() {
  const connection = await database.getConnection();
  try {
    connection.callTimeout = 5000;
    const result = await connection.execute('SELECT 1 FROM dual');
    return result.rows?.[0]?.[0] === 1;
  } finally {
    await connection.close();
  }
}

module.exports = { checkOracle };
