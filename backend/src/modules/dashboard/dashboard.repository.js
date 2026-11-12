const oracledb = require('oracledb');

async function summary(connection, filters) {
  // Cada agregado produce una fila: no se multiplican registros entre módulos.
  // Una sentencia mantiene una misma lectura consistente de Oracle para todo el resumen.
  const result = await connection.execute(`SELECT
    i."unidades", i."registros", c."ingresos", c."egresos", c."ingresos" - c."egresos" AS "saldo",
    v."cantidad_confirmadas", v."monto_confirmado", a."cantidad_activos", a."valor_total",
    p."cantidad_registros", p."total_planilla", e."total_entregas", e."pendientes", e."entregadas", e."canceladas"
    FROM (
      SELECT NVL(SUM(existencia), 0) AS "unidades", COUNT(*) AS "registros"
      FROM INVENTARIO WHERE (:id_sucursal IS NULL OR id_sucursal = :id_sucursal)
    ) i
    CROSS JOIN (
      SELECT NVL(SUM(CASE WHEN tipo = 'INGRESO' THEN monto ELSE 0 END), 0) AS "ingresos",
        NVL(SUM(CASE WHEN tipo = 'EGRESO' THEN monto ELSE 0 END), 0) AS "egresos"
      FROM MOVIMIENTO_CAJA WHERE (:id_sucursal IS NULL OR id_sucursal = :id_sucursal)
    ) c
    CROSS JOIN (
      SELECT COUNT(*) AS "cantidad_confirmadas", NVL(SUM(total), 0) AS "monto_confirmado"
      FROM VENTA WHERE (:id_sucursal IS NULL OR id_sucursal = :id_sucursal) AND estado = 'CONFIRMADA'
    ) v
    CROSS JOIN (
      SELECT COUNT(*) AS "cantidad_activos", NVL(SUM(valor), 0) AS "valor_total"
      FROM ACTIVO_FIJO WHERE (:id_sucursal IS NULL OR id_sucursal = :id_sucursal)
    ) a
    CROSS JOIN (
      SELECT COUNT(*) AS "cantidad_registros", NVL(SUM(monto), 0) AS "total_planilla"
      FROM GASTO_PLANILLA WHERE (:id_sucursal IS NULL OR id_sucursal = :id_sucursal)
    ) p
    CROSS JOIN (
      SELECT COUNT(*) AS "total_entregas",
        NVL(SUM(CASE WHEN estado IN ('CREADA', 'ASIGNADA', 'PREPARADA', 'EN_RUTA') THEN 1 ELSE 0 END), 0) AS "pendientes",
        NVL(SUM(CASE WHEN estado = 'ENTREGADA' THEN 1 ELSE 0 END), 0) AS "entregadas",
        NVL(SUM(CASE WHEN estado = 'CANCELADA' THEN 1 ELSE 0 END), 0) AS "canceladas"
      FROM ENTREGA WHERE (:id_sucursal IS NULL OR id_sucursal = :id_sucursal)
    ) e`, filters, { outFormat: oracledb.OUT_FORMAT_OBJECT });
  const row = result.rows[0];
  return {
    inventario: { unidades: row.unidades, registros: row.registros },
    caja: { ingresos: row.ingresos, egresos: row.egresos, saldo: row.saldo },
    ventas: { cantidad_confirmadas: row.cantidad_confirmadas, monto_confirmado: row.monto_confirmado },
    activos: { cantidad: row.cantidad_activos, valor_total: row.valor_total },
    planilla: { cantidad_registros: row.cantidad_registros, total: row.total_planilla },
    entregas: { total: row.total_entregas, pendientes: row.pendientes, entregadas: row.entregadas, canceladas: row.canceladas },
  };
}

module.exports = { summary };
