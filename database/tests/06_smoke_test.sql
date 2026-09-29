-- 06_smoke_test.sql
-- Consultas de verificacion despues de ejecutar 01..05.

PROMPT === Conteo de tablas principales ===
SELECT 'ROL' tabla, COUNT(*) filas FROM ROL
UNION ALL SELECT 'USUARIO', COUNT(*) FROM USUARIO
UNION ALL SELECT 'SUCURSAL', COUNT(*) FROM SUCURSAL
UNION ALL SELECT 'MEDICAMENTO', COUNT(*) FROM MEDICAMENTO
UNION ALL SELECT 'INVENTARIO', COUNT(*) FROM INVENTARIO
UNION ALL SELECT 'MOVIMIENTO_INVENTARIO', COUNT(*) FROM MOVIMIENTO_INVENTARIO;

PROMPT === Inventario por sucursal y medicamento ===
SELECT s.nombre AS sucursal,
       m.codigo,
       m.nombre AS medicamento,
       i.existencia,
       i.fecha_actualizacion
FROM INVENTARIO i
JOIN SUCURSAL s ON s.id_sucursal = i.id_sucursal
JOIN MEDICAMENTO m ON m.id_medicamento = i.id_medicamento
ORDER BY s.nombre, m.codigo;

PROMPT === Movimientos de inventario ===
SELECT s.nombre AS sucursal,
       m.codigo,
       mi.tipo_movimiento,
       mi.cantidad,
       mi.saldo_anterior,
       mi.saldo_nuevo,
       mi.referencia,
       mi.fecha
FROM MOVIMIENTO_INVENTARIO mi
JOIN INVENTARIO i ON i.id_inventario = mi.id_inventario
JOIN SUCURSAL s ON s.id_sucursal = i.id_sucursal
JOIN MEDICAMENTO m ON m.id_medicamento = i.id_medicamento
ORDER BY mi.fecha;

PROMPT === Restricciones relevantes registradas ===
SELECT table_name, constraint_name, constraint_type, status
FROM user_constraints
WHERE table_name IN (
    'INVENTARIO','TRANSFERENCIA','VENTA','ENTREGA',
    'MOVIMIENTO_CAJA','ACTIVO_FIJO'
)
ORDER BY table_name, constraint_type, constraint_name;

PROMPT === Indices del esquema ===
SELECT table_name, index_name, uniqueness
FROM user_indexes
WHERE table_name IN (
    'USUARIO','INVENTARIO','TRANSFERENCIA','VENTA',
    'MOVIMIENTO_CAJA','ACTIVO_FIJO','GASTO_PLANILLA',
    'ENTREGA','AUDITORIA'
)
ORDER BY table_name, index_name;

-- Pruebas negativas sugeridas (ejecutar manualmente, una a la vez):
-- 1) Debe fallar por existencia negativa:
-- UPDATE INVENTARIO SET existencia = -1 WHERE ROWNUM = 1;
--
-- 2) Debe fallar por origen=destino:
-- INSERT INTO TRANSFERENCIA
--   (id_sucursal_origen,id_sucursal_destino,id_usuario,estado)
-- SELECT s.id_sucursal,s.id_sucursal,u.id_usuario,'SOLICITADA'
-- FROM SUCURSAL s CROSS JOIN USUARIO u
-- WHERE ROWNUM = 1;
--
-- 3) Debe fallar por correo duplicado:
-- INSERT INTO USUARIO(id_rol,nombre,correo,password_hash,activo)
-- SELECT id_rol,'Duplicado','admin.demo@farmacia.local','X','S'
-- FROM ROL WHERE nombre='ADMINISTRADOR';
