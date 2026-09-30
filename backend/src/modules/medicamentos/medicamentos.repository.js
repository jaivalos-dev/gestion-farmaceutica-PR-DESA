const oracledb = require('oracledb');

const select = `SELECT id_medicamento AS "id_medicamento", codigo AS "codigo",
  nombre AS "nombre", categoria AS "categoria", presentacion AS "presentacion",
  precio AS "precio", activo AS "activo" FROM MEDICAMENTO`;
const options = { outFormat: oracledb.OUT_FORMAT_OBJECT };

async function list(connection) {
  const result = await connection.execute(`${select} ORDER BY id_medicamento`, {}, options);
  return result.rows;
}

async function findById(connection, id) {
  const result = await connection.execute(`${select} WHERE id_medicamento = :id`, { id }, options);
  return result.rows[0] ?? null;
}

async function create(connection, data) {
  const result = await connection.execute(`INSERT INTO MEDICAMENTO
    (codigo, nombre, categoria, presentacion, precio, activo)
    VALUES (:codigo, :nombre, :categoria, :presentacion, :precio, :activo)
    RETURNING id_medicamento INTO :id`, {
    ...data, id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
  }, { autoCommit: false });
  return result.outBinds.id[0];
}

async function update(connection, id, data) {
  const result = await connection.execute(`UPDATE MEDICAMENTO
    SET codigo = :codigo, nombre = :nombre, categoria = :categoria,
        presentacion = :presentacion, precio = :precio, activo = :activo
    WHERE id_medicamento = :id`, { ...data, id }, { autoCommit: false });
  return result.rowsAffected;
}

async function setState(connection, id, activo) {
  const result = await connection.execute(`UPDATE MEDICAMENTO SET activo = :activo
    WHERE id_medicamento = :id`, { id, activo }, { autoCommit: false });
  return result.rowsAffected;
}

module.exports = { list, findById, create, update, setState };
