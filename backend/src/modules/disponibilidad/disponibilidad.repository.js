const oracledb = require('oracledb');

async function candidates(connection, id_medicamento, cantidad) {
  const result = await connection.execute(`SELECT s.id_sucursal AS "id_sucursal",
    s.nombre AS "nombre", s.tipo_sucursal AS "tipo_sucursal",
    s.departamento AS "departamento", s.municipio AS "municipio",
    i.existencia AS "existencia"
    FROM INVENTARIO i
    JOIN SUCURSAL s ON s.id_sucursal = i.id_sucursal
    JOIN MEDICAMENTO m ON m.id_medicamento = i.id_medicamento
    WHERE i.id_medicamento = :id_medicamento AND i.existencia >= :cantidad
      AND s.activa = 'S' AND m.activo = 'S'`,
  { id_medicamento, cantidad }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
  return result.rows;
}

module.exports = { candidates };
