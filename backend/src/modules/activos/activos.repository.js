const oracledb = require('oracledb');

const options = { outFormat: oracledb.OUT_FORMAT_OBJECT };
const select = `SELECT a.id_activo AS "id_activo", a.id_sucursal AS "id_sucursal",
  s.nombre AS "sucursal", a.categoria AS "categoria", a.descripcion AS "descripcion",
  a.valor AS "valor", a.estado AS "estado", a.responsable AS "responsable",
  a.fecha_registro AS "fecha_registro" FROM ACTIVO_FIJO a
  JOIN SUCURSAL s ON s.id_sucursal = a.id_sucursal`;

async function list(connection, filters) {
  const result = await connection.execute(`${select}
    WHERE (:id_sucursal IS NULL OR a.id_sucursal = :id_sucursal)
      AND (:categoria IS NULL OR a.categoria = :categoria)
      AND (:estado IS NULL OR a.estado = :estado)
      AND (:responsable IS NULL OR a.responsable = :responsable)
      AND (:descripcion IS NULL OR INSTR(UPPER(a.descripcion), UPPER(:descripcion)) > 0)
    ORDER BY a.id_activo DESC`, filters, options);
  return result.rows;
}

async function findById(connection, id, lock = false) {
  const result = await connection.execute(`${select} WHERE a.id_activo = :id${lock ? ' FOR UPDATE OF a.id_activo' : ''}`, { id }, options);
  return result.rows[0] ?? null;
}

async function create(connection, data) {
  const result = await connection.execute(`INSERT INTO ACTIVO_FIJO
    (id_sucursal, categoria, descripcion, valor, estado, responsable)
    VALUES (:id_sucursal, :categoria, :descripcion, :valor, :estado, :responsable)
    RETURNING id_activo INTO :id`, {
    ...data, id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
  }, { autoCommit: false });
  return result.outBinds.id[0];
}

async function update(connection, id, data) {
  const result = await connection.execute(`UPDATE ACTIVO_FIJO
    SET id_sucursal = :id_sucursal, categoria = :categoria, descripcion = :descripcion,
        valor = :valor, estado = :estado, responsable = :responsable
    WHERE id_activo = :id`, { ...data, id }, { autoCommit: false });
  return result.rowsAffected;
}

module.exports = { list, findById, create, update };
