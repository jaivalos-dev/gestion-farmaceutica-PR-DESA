const oracledb = require('oracledb');

const options = { outFormat: oracledb.OUT_FORMAT_OBJECT };
const select = `SELECT id_venta AS "id_venta", id_sucursal AS "id_sucursal",
  id_usuario AS "id_usuario", fecha AS "fecha", forma_pago AS "forma_pago",
  total AS "total", estado AS "estado" FROM VENTA`;

async function list(connection, id_sucursal) {
  const result = await connection.execute(`${select} WHERE id_sucursal = :id_sucursal
    ORDER BY fecha DESC, id_venta DESC`, { id_sucursal }, options);
  return result.rows;
}

async function findById(connection, id, lock = false) {
  const result = await connection.execute(`${select} WHERE id_venta = :id${lock ? ' FOR UPDATE' : ''}`, { id }, options);
  return result.rows[0] ?? null;
}

async function details(connection, id) {
  const result = await connection.execute(`SELECT d.id_detalle AS "id_detalle",
    d.id_medicamento AS "id_medicamento", m.nombre AS "medicamento", m.codigo AS "codigo",
    d.cantidad AS "cantidad", d.precio_unitario AS "precio_unitario", d.subtotal AS "subtotal"
    FROM DETALLE_VENTA d JOIN MEDICAMENTO m ON m.id_medicamento = d.id_medicamento
    WHERE d.id_venta = :id ORDER BY d.id_medicamento, d.id_detalle`, { id }, options);
  return result.rows;
}

async function create(connection, data) {
  const result = await connection.execute(`INSERT INTO VENTA
    (id_sucursal, id_usuario, forma_pago, total, estado)
    VALUES (:id_sucursal, :id_usuario, :forma_pago, :total, :estado)
    RETURNING id_venta INTO :id`, {
    ...data, id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
  }, { autoCommit: false });
  return result.outBinds.id[0];
}

async function createDetail(connection, id_venta, detail) {
  await connection.execute(`INSERT INTO DETALLE_VENTA
    (id_venta, id_medicamento, cantidad, precio_unitario, subtotal)
    VALUES (:id_venta, :id_medicamento, :cantidad, :precio_unitario, :subtotal)`,
  { id_venta, ...detail }, { autoCommit: false });
}

async function createCashMovement(connection, data) {
  await connection.execute(`INSERT INTO MOVIMIENTO_CAJA
    (id_sucursal, id_usuario, id_venta, tipo, monto, concepto)
    VALUES (:id_sucursal, :id_usuario, :id_venta, :tipo, :monto, :concepto)`, data, { autoCommit: false });
}

async function setState(connection, id, estado) {
  const result = await connection.execute(`UPDATE VENTA SET estado = :estado
    WHERE id_venta = :id`, { id, estado }, { autoCommit: false });
  return result.rowsAffected;
}

module.exports = { list, findById, details, create, createDetail, createCashMovement, setState };
