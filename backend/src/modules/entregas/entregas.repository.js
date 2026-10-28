const oracledb = require('oracledb');

const options = { outFormat: oracledb.OUT_FORMAT_OBJECT };
const select = `SELECT id_entrega AS "id_entrega", id_venta AS "id_venta",
  id_sucursal AS "id_sucursal", nombre_cliente AS "nombre_cliente", telefono AS "telefono",
  direccion AS "direccion", departamento AS "departamento", municipio AS "municipio",
  tiempo_estimado AS "tiempo_estimado", estado AS "estado", fecha_solicitud AS "fecha_solicitud",
  fecha_entrega AS "fecha_entrega", observaciones AS "observaciones" FROM ENTREGA`;

async function list(connection, filters) {
  const result = await connection.execute(`${select}
    WHERE (:id_sucursal IS NULL OR id_sucursal = :id_sucursal)
      AND (:id_venta IS NULL OR id_venta = :id_venta)
      AND (:estado IS NULL OR estado = :estado)
      AND (:departamento IS NULL OR UPPER(TRIM(departamento)) = UPPER(:departamento))
      AND (:municipio IS NULL OR UPPER(TRIM(municipio)) = UPPER(:municipio))
    ORDER BY fecha_solicitud DESC, id_entrega DESC`, filters, options);
  return result.rows;
}

async function findById(connection, id, lock = false) {
  const result = await connection.execute(`${select} WHERE id_entrega = :id${lock ? ' FOR UPDATE' : ''}`, { id }, options);
  return result.rows[0] ?? null;
}

async function findBySale(connection, id_venta) {
  const result = await connection.execute(`${select} WHERE id_venta = :id_venta`, { id_venta }, options);
  return result.rows[0] ?? null;
}

async function create(connection, data) {
  const result = await connection.execute(`INSERT INTO ENTREGA
    (id_venta, id_sucursal, nombre_cliente, telefono, direccion, departamento, municipio,
     tiempo_estimado, estado, fecha_solicitud, fecha_entrega, observaciones)
    VALUES (:id_venta, :id_sucursal, :nombre_cliente, :telefono, :direccion, :departamento, :municipio,
      :tiempo_estimado, :estado, SYSTIMESTAMP, NULL, :observaciones)
    RETURNING id_entrega INTO :id`, {
    ...data, id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
  }, { autoCommit: false });
  return result.outBinds.id[0];
}

async function setState(connection, id, estado) {
  const result = await connection.execute(`UPDATE ENTREGA SET estado = :estado,
    fecha_entrega = CASE WHEN :estado = 'ENTREGADA' THEN SYSTIMESTAMP ELSE fecha_entrega END
    WHERE id_entrega = :id`, { id, estado }, { autoCommit: false });
  return result.rowsAffected;
}

module.exports = { list, findById, findBySale, create, setState };
