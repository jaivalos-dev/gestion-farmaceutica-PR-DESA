const oracledb = require('oracledb');
const database = require('../../database/pool');

async function findByCorreo(correo) {
  const connection = await database.getConnection();
  try {
    connection.callTimeout = 5000;
    const result = await connection.execute(`
      SELECT u.id_usuario AS "id_usuario", u.id_rol AS "id_rol",
             r.nombre AS "nombre_rol", u.id_sucursal AS "id_sucursal",
             u.password_hash AS "password_hash", u.activo AS "activo"
      FROM USUARIO u
      JOIN ROL r ON r.id_rol = u.id_rol
      WHERE u.correo = :correo`,
    { correo }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return result.rows[0] ?? null;
  } finally {
    await connection.close();
  }
}

module.exports = { findByCorreo };
