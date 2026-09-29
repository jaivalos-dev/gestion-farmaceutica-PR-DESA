# Scripts Oracle XE - Gestion Farmaceutica

Orden recomendado:

1. 01_schema.sql
2. 02_constraints.sql
3. 03_indexes.sql
4. 04_seed.sql
5. 05_demo_data.sql
6. 06_smoke_test.sql

## Estado
Los scripts fueron preparados a partir del Documento 09 v1.3 Final y del Documento 10.
Todavia deben ejecutarse y validarse contra la instalacion local de Oracle XE del proyecto.

## Conexion esperada para desarrollo local
- Host: localhost
- Puerto: 1521
- Service Name: XEPDB1
- Esquema recomendado: FARMACIA

No almacenar contrasenas reales dentro de estos archivos.
El valor de password_hash del usuario demo es un marcador y debe ser reemplazado por el backend con bcrypt.
