const oracledb = require('oracledb');

async function create(connection, data) {
  await connection.execute(`INSERT INTO AUDITORIA
    (id_usuario, id_sucursal, modulo, accion, entidad, id_entidad, descripcion)
    VALUES (:id_usuario, :id_sucursal, :modulo, :accion, :entidad, :id_entidad, :descripcion)`,
  data, { autoCommit: false });
}

async function list(connection, filters) {
  const result = await connection.execute(`SELECT a.id_auditoria AS "id_auditoria",
    a.id_usuario AS "id_usuario", u.nombre AS "usuario",
    a.id_sucursal AS "id_sucursal", s.nombre AS "sucursal",
    a.modulo AS "modulo", a.accion AS "accion", a.entidad AS "entidad",
    a.id_entidad AS "id_entidad", a.descripcion AS "descripcion", a.fecha_hora AS "fecha_hora"
    FROM AUDITORIA a
    LEFT JOIN USUARIO u ON u.id_usuario = a.id_usuario
    LEFT JOIN SUCURSAL s ON s.id_sucursal = a.id_sucursal
    WHERE (:fecha_desde IS NULL OR a.fecha_hora >= TO_DATE(:fecha_desde, 'FXYYYY-MM-DD'))
      AND (:fecha_hasta IS NULL OR a.fecha_hora < TO_DATE(:fecha_hasta, 'FXYYYY-MM-DD') + 1)
      AND (:id_usuario IS NULL OR a.id_usuario = :id_usuario)
      AND (:id_sucursal IS NULL OR a.id_sucursal = :id_sucursal)
      AND (:modulo IS NULL OR a.modulo = :modulo)
      AND (:accion IS NULL OR a.accion = :accion)
      AND (:entidad IS NULL OR a.entidad = :entidad)
      AND (:id_entidad IS NULL OR a.id_entidad = :id_entidad)
    ORDER BY a.fecha_hora DESC, a.id_auditoria DESC`, filters, { outFormat: oracledb.OUT_FORMAT_OBJECT });
  return result.rows;
}

module.exports = { create, list };
