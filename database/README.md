# Scripts Oracle XE - Gestion Farmaceutica

Orden recomendado:

1. 01_schema.sql
2. 02_constraints.sql
3. 03_indexes.sql
4. 04_seed.sql
5. 05_demo_data.sql
6. 06_smoke_test.sql

## Estado de validación

Los scripts Oracle fueron ejecutados y validados sobre Oracle XE / XEPDB1
con el esquema FARMACIA.

Validaciones completadas:

- 15 tablas creadas.
- PK, FK, UNIQUE y CHECK aplicados.
- Índices creados.
- Datos seed cargados.
- Datos demo cargados.
- Smoke test ejecutado.
- Inventario negativo rechazado por CK_INV_EXISTENCIA.
- Transferencia con origen igual a destino rechazada por CK_TRANS_SUCURSALES.
- Correo duplicado rechazado por UQ_USUARIO_CORREO.

Durante la instalación fue necesario conceder:

GRANT CREATE SEQUENCE TO FARMACIA;

## Conexion esperada para desarrollo local
- Host: localhost
- Puerto: 1521
- Service Name: XEPDB1
- Esquema recomendado: FARMACIA

No almacenar contrasenas reales dentro de estos archivos.
El valor de password_hash del usuario demo es un marcador y debe ser reemplazado por el backend con bcrypt.
