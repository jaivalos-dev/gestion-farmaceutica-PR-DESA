const oracledb = require('oracledb');

const options = { outFormat: oracledb.OUT_FORMAT_OBJECT };
const select = `SELECT i.id_inventario AS "id_inventario", i.id_sucursal AS "id_sucursal",
  i.id_medicamento AS "id_medicamento", s.nombre AS "sucursal",
  m.nombre AS "medicamento", m.codigo AS "codigo", i.existencia AS "existencia",
  i.fecha_actualizacion AS "fecha_actualizacion"
  FROM INVENTARIO i
  JOIN SUCURSAL s ON s.id_sucursal = i.id_sucursal
  JOIN MEDICAMENTO m ON m.id_medicamento = i.id_medicamento`;

async function list(connection, filters) {
  const result = await connection.execute(`${select}
    WHERE (:id_sucursal IS NULL OR i.id_sucursal = :id_sucursal)
      AND (:id_medicamento IS NULL OR i.id_medicamento = :id_medicamento)
    ORDER BY i.id_sucursal, i.id_medicamento`, filters, options);
  return result.rows;
}

async function findById(connection, id) {
  const result = await connection.execute(`${select} WHERE i.id_inventario = :id`, { id }, options);
  return result.rows[0] ?? null;
}

async function movements(connection, id_inventario) {
  const result = await connection.execute(`SELECT id_movimiento AS "id_movimiento",
    id_inventario AS "id_inventario", id_usuario AS "id_usuario",
    tipo_movimiento AS "tipo_movimiento", cantidad AS "cantidad",
    saldo_anterior AS "saldo_anterior", saldo_nuevo AS "saldo_nuevo",
    referencia AS "referencia", fecha AS "fecha"
    FROM MOVIMIENTO_INVENTARIO WHERE id_inventario = :id_inventario
    ORDER BY fecha DESC, id_movimiento DESC`, { id_inventario }, options);
  return result.rows;
}

async function findForUpdate(connection, id_sucursal, id_medicamento) {
  const result = await connection.execute(`SELECT id_inventario AS "id_inventario",
    existencia AS "existencia" FROM INVENTARIO
    WHERE id_sucursal = :id_sucursal AND id_medicamento = :id_medicamento
    FOR UPDATE`, { id_sucursal, id_medicamento }, options);
  return result.rows[0] ?? null;
}

async function create(connection, id_sucursal, id_medicamento, existencia) {
  const result = await connection.execute(`INSERT INTO INVENTARIO
    (id_sucursal, id_medicamento, existencia) VALUES (:id_sucursal, :id_medicamento, :existencia)
    RETURNING id_inventario INTO :id`, {
    id_sucursal, id_medicamento, existencia,
    id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
  }, { autoCommit: false });
  return result.outBinds.id[0];
}

async function update(connection, id_inventario, existencia) {
  const result = await connection.execute(`UPDATE INVENTARIO
    SET existencia = :existencia, fecha_actualizacion = SYSTIMESTAMP
    WHERE id_inventario = :id_inventario`, { id_inventario, existencia }, { autoCommit: false });
  return result.rowsAffected;
}

async function createMovement(connection, data) {
  const result = await connection.execute(`INSERT INTO MOVIMIENTO_INVENTARIO
    (id_inventario, id_usuario, tipo_movimiento, cantidad, saldo_anterior, saldo_nuevo, referencia)
    VALUES (:id_inventario, :id_usuario, :tipo_movimiento, :cantidad, :saldo_anterior, :saldo_nuevo, :referencia)
    RETURNING id_movimiento INTO :id`, {
    ...data, id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
  }, { autoCommit: false });
  return result.outBinds.id[0];
}

module.exports = { list, findById, movements, findForUpdate, create, update, createMovement };
