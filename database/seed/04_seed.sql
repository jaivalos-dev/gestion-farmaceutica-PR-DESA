-- 04_seed.sql
-- Datos base. Pensado para una base nueva.
-- El usuario demo usa un marcador de hash; el backend debera reemplazarlo por un hash bcrypt valido.

INSERT INTO ROL (nombre, descripcion, activo)
VALUES ('ADMINISTRADOR', 'Administracion central del sistema', 'S');

INSERT INTO ROL (nombre, descripcion, activo)
VALUES ('ENCARGADO', 'Operacion de una sucursal', 'S');

INSERT INTO ROL (nombre, descripcion, activo)
VALUES ('AUDITOR', 'Consulta de auditoria y consolidados', 'S');

INSERT INTO ROL (nombre, descripcion, activo)
VALUES ('DESPACHO', 'Seguimiento de entregas', 'S');

INSERT INTO SUCURSAL (nombre, tipo_sucursal, departamento, municipio, direccion, activa)
VALUES ('Farmacia Central Demo', 'FARMACIA', 'Guatemala', 'Guatemala', 'Zona 1 - direccion demo', 'S');

INSERT INTO SUCURSAL (nombre, tipo_sucursal, departamento, municipio, direccion, activa)
VALUES ('Stand Demo', 'STAND', 'Sacatepequez', 'Antigua Guatemala', 'Gasolinera demo', 'S');

INSERT INTO MEDICAMENTO (codigo, nombre, categoria, presentacion, precio, activo)
VALUES ('MED-001', 'Paracetamol', 'Analgesico', 'Tabletas 500 mg', 12.50, 'S');

INSERT INTO MEDICAMENTO (codigo, nombre, categoria, presentacion, precio, activo)
VALUES ('MED-002', 'Ibuprofeno', 'Antiinflamatorio', 'Tabletas 400 mg', 18.75, 'S');

INSERT INTO MEDICAMENTO (codigo, nombre, categoria, presentacion, precio, activo)
VALUES ('MED-003', 'Amoxicilina', 'Antibiotico', 'Capsulas 500 mg', 45.00, 'S');

INSERT INTO USUARIO (id_rol, id_sucursal, nombre, correo, password_hash, activo)
SELECT r.id_rol, NULL, 'Administrador Demo', 'admin.demo@farmacia.local',
       'PENDIENTE_REEMPLAZAR_CON_BCRYPT_DESDE_BACKEND', 'S'
FROM ROL r
WHERE r.nombre = 'ADMINISTRADOR';

COMMIT;
