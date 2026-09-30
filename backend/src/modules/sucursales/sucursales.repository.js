const oracledb = require('oracledb');

const select = `SELECT id_sucursal AS "id_sucursal", nombre AS "nombre",
  tipo_sucursal AS "tipo_sucursal", departamento AS "departamento",
  municipio AS "municipio", direccion AS "direccion", activa AS "activa"
  FROM SUCURSAL`;
const options = { outFormat: oracledb.OUT_FORMAT_OBJECT };

async function list(connection) {
  const result = await connection.execute(`${select} ORDER BY id_sucursal`, {}, options);
  return result.rows;
}

async function findById(connection, id) {
  const result = await connection.execute(`${select} WHERE id_sucursal = :id`, { id }, options);
  return result.rows[0] ?? null;
}

async function create(connection, data) {
  const result = await connection.execute(`INSERT INTO SUCURSAL
    (nombre, tipo_sucursal, departamento, municipio, direccion, activa)
    VALUES (:nombre, :tipo_sucursal, :departamento, :municipio, :direccion, :activa)
    RETURNING id_sucursal INTO :id`, {
    ...data, id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
  }, { autoCommit: false });
  return result.outBinds.id[0];
}

async function update(connection, id, data) {
  const result = await connection.execute(`UPDATE SUCURSAL
    SET nombre = :nombre, tipo_sucursal = :tipo_sucursal,
        departamento = :departamento, municipio = :municipio,
        direccion = :direccion, activa = :activa
    WHERE id_sucursal = :id`, { ...data, id }, { autoCommit: false });
  return result.rowsAffected;
}

async function setState(connection, id, activa) {
  const result = await connection.execute(`UPDATE SUCURSAL SET activa = :activa
    WHERE id_sucursal = :id`, { id, activa }, { autoCommit: false });
  return result.rowsAffected;
}

module.exports = { list, findById, create, update, setState };
