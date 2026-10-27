const oracledb = require('oracledb');

const options = { outFormat: oracledb.OUT_FORMAT_OBJECT };
const select = `SELECT t.id_transferencia AS "id_transferencia",
  t.id_sucursal_origen AS "id_sucursal_origen", t.id_sucursal_destino AS "id_sucursal_destino",
  t.id_usuario AS "id_usuario", t.fecha AS "fecha", t.estado AS "estado",
  t.observacion AS "observacion", o.nombre AS "origen", d.nombre AS "destino",
  u.nombre AS "usuario" FROM TRANSFERENCIA t
  JOIN SUCURSAL o ON o.id_sucursal = t.id_sucursal_origen
  JOIN SUCURSAL d ON d.id_sucursal = t.id_sucursal_destino
  JOIN USUARIO u ON u.id_usuario = t.id_usuario`;

async function list(connection, filters) {
  const result = await connection.execute(`${select}
    WHERE (t.id_sucursal_origen = :id_sucursal OR t.id_sucursal_destino = :id_sucursal)
      AND (:estado IS NULL OR t.estado = :estado)
      AND (:id_sucursal_origen IS NULL OR t.id_sucursal_origen = :id_sucursal_origen)
      AND (:id_sucursal_destino IS NULL OR t.id_sucursal_destino = :id_sucursal_destino)
    ORDER BY t.fecha DESC, t.id_transferencia DESC`, filters, options);
  return result.rows;
}

async function findById(connection, id) {
  const result = await connection.execute(`${select} WHERE t.id_transferencia = :id`, { id }, options);
  return result.rows[0] ?? null;
}

async function findForUpdate(connection, id) {
  const result = await connection.execute(`SELECT id_transferencia AS "id_transferencia",
    id_sucursal_origen AS "id_sucursal_origen", id_sucursal_destino AS "id_sucursal_destino",
    id_usuario AS "id_usuario", fecha AS "fecha", estado AS "estado", observacion AS "observacion"
    FROM TRANSFERENCIA WHERE id_transferencia = :id FOR UPDATE`, { id }, options);
  return result.rows[0] ?? null;
}

async function details(connection, id) {
  const result = await connection.execute(`SELECT d.id_detalle AS "id_detalle",
    d.id_medicamento AS "id_medicamento", m.nombre AS "medicamento", m.codigo AS "codigo",
    d.cantidad AS "cantidad" FROM DETALLE_TRANSFERENCIA d
    JOIN MEDICAMENTO m ON m.id_medicamento = d.id_medicamento
    WHERE d.id_transferencia = :id ORDER BY d.id_medicamento, d.id_detalle`, { id }, options);
  return result.rows;
}

async function create(connection, data) {
  const result = await connection.execute(`INSERT INTO TRANSFERENCIA
    (id_sucursal_origen, id_sucursal_destino, id_usuario, estado, observacion)
    VALUES (:id_sucursal_origen, :id_sucursal_destino, :id_usuario, :estado, :observacion)
    RETURNING id_transferencia INTO :id`, {
    ...data, id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
  }, { autoCommit: false });
  return result.outBinds.id[0];
}

async function createDetail(connection, id_transferencia, detail) {
  await connection.execute(`INSERT INTO DETALLE_TRANSFERENCIA
    (id_transferencia, id_medicamento, cantidad) VALUES (:id_transferencia, :id_medicamento, :cantidad)`,
  { id_transferencia, id_medicamento: detail.id_medicamento, cantidad: detail.cantidad }, { autoCommit: false });
}

async function setState(connection, id, estado) {
  const result = await connection.execute(`UPDATE TRANSFERENCIA SET estado = :estado
    WHERE id_transferencia = :id`, { id, estado }, { autoCommit: false });
  return result.rowsAffected;
}

module.exports = { list, findById, findForUpdate, details, create, createDetail, setState };
