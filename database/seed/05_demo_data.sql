-- 05_demo_data.sql
-- Datos para verificar el modelo sin construir aun todos los modulos.
-- Requiere haber ejecutado 04_seed.sql.

-- Inventario inicial en Farmacia Central Demo
INSERT INTO INVENTARIO (id_sucursal, id_medicamento, existencia)
SELECT s.id_sucursal, m.id_medicamento, 100
FROM SUCURSAL s
CROSS JOIN MEDICAMENTO m
WHERE s.nombre = 'Farmacia Central Demo'
  AND m.codigo IN ('MED-001','MED-002');

INSERT INTO INVENTARIO (id_sucursal, id_medicamento, existencia)
SELECT s.id_sucursal, m.id_medicamento, 50
FROM SUCURSAL s
CROSS JOIN MEDICAMENTO m
WHERE s.nombre = 'Farmacia Central Demo'
  AND m.codigo = 'MED-003';

-- Inventario inicial en Stand Demo
INSERT INTO INVENTARIO (id_sucursal, id_medicamento, existencia)
SELECT s.id_sucursal, m.id_medicamento, 25
FROM SUCURSAL s
CROSS JOIN MEDICAMENTO m
WHERE s.nombre = 'Stand Demo'
  AND m.codigo = 'MED-001';

-- Movimientos explicativos de la carga inicial
INSERT INTO MOVIMIENTO_INVENTARIO
    (id_inventario, id_usuario, tipo_movimiento, cantidad, saldo_anterior, saldo_nuevo, referencia)
SELECT i.id_inventario, u.id_usuario, 'ENTRADA', i.existencia, 0, i.existencia, 'CARGA_INICIAL'
FROM INVENTARIO i
JOIN USUARIO u ON u.correo = 'admin.demo@farmacia.local'
WHERE i.existencia > 0;

-- Activo de ejemplo
INSERT INTO ACTIVO_FIJO
    (id_sucursal, categoria, descripcion, valor, estado, responsable)
SELECT s.id_sucursal, 'EQUIPO', 'Computadora de caja demo', 4500, 'ACTIVO', 'Administrador Demo'
FROM SUCURSAL s
WHERE s.nombre = 'Farmacia Central Demo';

-- Gasto de planilla de ejemplo
INSERT INTO GASTO_PLANILLA
    (id_sucursal, id_usuario, periodo, concepto, monto)
SELECT s.id_sucursal, u.id_usuario, '2026-09', 'Gasto de planilla demo', 15000
FROM SUCURSAL s
JOIN USUARIO u ON u.correo = 'admin.demo@farmacia.local'
WHERE s.nombre = 'Farmacia Central Demo';

COMMIT;
