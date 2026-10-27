const oracledb = require('oracledb');

const options = { outFormat: oracledb.OUT_FORMAT_OBJECT };
const select = `SELECT g.id_gasto AS "id_gasto", g.id_sucursal AS "id_sucursal",
  s.nombre AS "sucursal", g.id_usuario AS "id_usuario", u.nombre AS "usuario",
  g.periodo AS "periodo", g.concepto AS "concepto", g.monto AS "monto",
  g.fecha_registro AS "fecha_registro" FROM GASTO_PLANILLA g
  JOIN SUCURSAL s ON s.id_sucursal = g.id_sucursal
  JOIN USUARIO u ON u.id_usuario = g.id_usuario`;
const scope = `WHERE (:id_sucursal IS NULL OR g.id_sucursal = :id_sucursal)
  AND (:periodo IS NULL OR g.periodo = :periodo)`;

async function list(connection, filters) {
  const result = await connection.execute(`${select} ${scope}
    AND (:concepto IS NULL OR INSTR(UPPER(g.concepto), UPPER(:concepto)) > 0)
    ORDER BY g.periodo DESC, g.fecha_registro DESC, g.id_gasto DESC`, filters, options);
  return result.rows;
}

async function findById(connection, id) {
  const result = await connection.execute(`${select} WHERE g.id_gasto = :id`, { id }, options);
  return result.rows[0] ?? null;
}

async function summary(connection, filters) {
  const result = await connection.execute(`SELECT NVL(SUM(g.monto), 0) AS "total",
    COUNT(*) AS "cantidad_registros" FROM GASTO_PLANILLA g ${scope}`, filters, options);
  return result.rows[0];
}

async function create(connection, data) {
  const result = await connection.execute(`INSERT INTO GASTO_PLANILLA
    (id_sucursal, id_usuario, periodo, concepto, monto)
    VALUES (:id_sucursal, :id_usuario, :periodo, :concepto, :monto)
    RETURNING id_gasto INTO :id`, {
    ...data, id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
  }, { autoCommit: false });
  return result.outBinds.id[0];
}

module.exports = { list, findById, summary, create };
