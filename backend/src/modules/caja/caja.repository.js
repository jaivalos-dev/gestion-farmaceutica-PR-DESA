const oracledb = require('oracledb');

const options = { outFormat: oracledb.OUT_FORMAT_OBJECT };
const select = `SELECT id_mov_caja AS "id_mov_caja", id_sucursal AS "id_sucursal",
  id_usuario AS "id_usuario", id_venta AS "id_venta", tipo AS "tipo",
  monto AS "monto", concepto AS "concepto", fecha AS "fecha"
  FROM MOVIMIENTO_CAJA`;

async function list(connection, filters) {
  // Fechas de calendario Oracle: hasta incluye todo el día, incluso fracciones de segundo.
  const result = await connection.execute(`${select}
    WHERE (:id_sucursal IS NULL OR id_sucursal = :id_sucursal)
      AND (:tipo IS NULL OR tipo = :tipo)
      AND (:fecha_desde IS NULL OR fecha >= TO_DATE(:fecha_desde, 'FXYYYY-MM-DD'))
      AND (:fecha_hasta IS NULL OR TRUNC(fecha) <= TO_DATE(:fecha_hasta, 'FXYYYY-MM-DD'))
      AND (:id_venta IS NULL OR id_venta = :id_venta)
      AND (:concepto IS NULL OR INSTR(UPPER(concepto), UPPER(:concepto)) > 0)
    ORDER BY fecha DESC, id_mov_caja DESC`, filters, options);
  return result.rows;
}

async function findById(connection, id) {
  const result = await connection.execute(`${select} WHERE id_mov_caja = :id`, { id }, options);
  return result.rows[0] ?? null;
}

async function create(connection, data) {
  const result = await connection.execute(`INSERT INTO MOVIMIENTO_CAJA
    (id_sucursal, id_usuario, id_venta, tipo, monto, concepto)
    VALUES (:id_sucursal, :id_usuario, :id_venta, :tipo, :monto, :concepto)
    RETURNING id_mov_caja INTO :id`, {
    ...data, id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
  }, { autoCommit: false });
  return result.outBinds.id[0];
}

module.exports = { list, findById, create };
