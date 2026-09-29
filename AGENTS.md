# Proyecto: Sistema Integral de Gestión Farmacéutica

## 1. Contexto del proyecto

Este repositorio contiene el MVP académico de un Sistema Integral de Gestión Farmacéutica multisucursal.

El sistema debe permitir controlar:

- usuarios, roles y acceso;
- sucursales;
- medicamentos;
- inventario por sucursal;
- movimientos de inventario;
- transferencias entre sucursales;
- ventas;
- movimientos de caja;
- activos fijos;
- gastos de planilla;
- entregas;
- auditoría;
- consultas consolidadas;
- disponibilidad para integración futura.

El proyecto debe mantenerse dentro del alcance definido en la documentación ubicada en `/docs`.

---

## 2. Stack obligatorio

Frontend:
- React

Backend:
- Node.js
- Express

Base de datos:
- Oracle XE

Driver de base de datos:
- node-oracledb

Integración:
- REST
- JSON

Autenticación propuesta:
- JWT

Hash de contraseñas:
- bcrypt

No sustituir estas tecnologías sin autorización explícita.

---

## 3. Arquitectura obligatoria del backend

La estructura lógica debe respetar:

Routes
-> Controllers
-> Services
-> Repositories
-> Oracle XE

Responsabilidades:

### Routes
Definen:
- método HTTP;
- URL;
- middlewares aplicables.

### Controllers
Deben:
- recibir request;
- obtener parámetros;
- realizar validaciones básicas de formato;
- llamar a Services;
- devolver respuesta HTTP.

No deben contener reglas de negocio complejas ni SQL.

### Services
Deben contener:
- reglas de negocio;
- validaciones funcionales;
- transacciones;
- cambios de estado;
- coordinación entre repositories;
- auditoría cuando aplique.

### Repositories
Deben:
- ejecutar SQL parametrizado;
- acceder a Oracle;
- devolver información a Services.

No deben contener reglas de negocio.

### Database
Debe encargarse de:
- pool de conexiones Oracle;
- adquisición/liberación de conexiones;
- commit;
- rollback.

---

## 4. Regla de dependencia

La dependencia permitida es:

Routes -> Controllers -> Services -> Repositories -> Oracle

No invertir estas dependencias.

React nunca debe conectarse directamente a Oracle.

---

## 5. Base de datos

El modelo físico está congelado en 15 tablas:

1. ROL
2. USUARIO
3. SUCURSAL
4. MEDICAMENTO
5. INVENTARIO
6. MOVIMIENTO_INVENTARIO
7. TRANSFERENCIA
8. DETALLE_TRANSFERENCIA
9. VENTA
10. DETALLE_VENTA
11. MOVIMIENTO_CAJA
12. ACTIVO_FIJO
13. GASTO_PLANILLA
14. ENTREGA
15. AUDITORIA

No crear tablas adicionales ni modificar atributos, claves o relaciones sin autorización explícita.

Los scripts oficiales están en `/database`.

El Documento 09 ubicado en `/docs` es la autoridad sobre el modelo de datos.

El Documento 10 ubicado en `/docs` es la autoridad sobre arquitectura de software y modelo físico.

---

## 6. Reglas críticas de negocio

### Inventario

- Nunca permitir existencia negativa.
- Todo cambio de existencia debe generar un MOVIMIENTO_INVENTARIO.
- El saldo anterior y saldo nuevo deben ser coherentes.
- Cambiar inventario y registrar el movimiento debe ser una operación atómica.

### Transferencias

- La sucursal origen debe ser distinta de la sucursal destino.
- No se puede despachar más inventario del disponible.
- El despacho debe afectar inventario origen una sola vez.
- La recepción debe afectar inventario destino una sola vez.
- Los estados de transferencia deben respetar el flujo definido.

### Ventas

- Una venta no puede confirmarse sin existencia suficiente.
- Confirmar una venta debe:
  - actualizar inventario;
  - registrar movimientos de inventario;
  - generar el efecto correspondiente en caja;
  - generar auditoría.
- Estas operaciones deben ejecutarse dentro de una misma transacción Oracle.

### Entregas

- ENTREGA no debe descontar inventario de forma independiente.
- El stock se afecta mediante la venta confirmada.
- Los cambios de estado deben validarse.

### Auditoría

Las operaciones críticas deben registrar cuando corresponda:

- usuario;
- sucursal;
- módulo;
- acción;
- entidad;
- identificador de entidad;
- descripción;
- fecha/hora.

---

## 7. Seguridad

- Nunca guardar contraseñas en texto plano.
- Usar bcrypt para passwords.
- Usar JWT para autenticación.
- La autorización debe validarse en el backend.
- React puede ocultar opciones, pero no constituye un control de seguridad.
- Aplicar autorización por rol.
- Aplicar contexto de sucursal cuando corresponda.
- Utilizar SQL parametrizado.
- Nunca concatenar entrada del usuario dentro de SQL.

---

## 8. Secretos y variables de entorno

Nunca escribir secretos directamente en código.

El archivo `.env` real no debe versionarse.

Usar `.env.example` como plantilla.

Variables esperadas inicialmente:

ORACLE_USER
ORACLE_PASSWORD
ORACLE_CONNECT_STRING
JWT_SECRET
PORT

No insertar contraseñas reales dentro de:
- código;
- README;
- AGENTS.md;
- commits;
- logs;
- pruebas versionadas.

---

## 9. Alcance del MVP

Este es un proyecto académico.

No agregar sin autorización explícita:

- microservicios;
- Redis;
- Kafka;
- Docker;
- Kubernetes;
- GraphQL;
- TypeScript;
- ORM;
- MongoDB;
- PostgreSQL;
- autenticación de terceros;
- infraestructura empresarial compleja.

Preferir soluciones simples, claras y defendibles para un seminario.

---

## 10. Estilo de implementación

Priorizar:

- código legible;
- funciones pequeñas;
- nombres claros;
- separación de responsabilidades;
- manejo centralizado de errores;
- async/await;
- SQL parametrizado;
- transacciones explícitas cuando una operación afecte varias tablas;
- comentarios solo cuando expliquen decisiones importantes.

Evitar sobreingeniería.

---

## 11. Política de cambios

Antes de cambiar:

- modelo de datos;
- estados;
- reglas críticas;
- arquitectura;
- dependencias principales;
- alcance;

detenerse y solicitar autorización.

No modificar automáticamente los scripts SQL oficiales.

---

## 12. Orden de construcción

Seguir el avance del Plan Maestro y de los documentos del proyecto.

El inicio de construcción debe priorizar:

1. Base backend Node.js + Express.
2. Configuración.
3. Pool Oracle.
4. Manejo de errores.
5. Health check.
6. Autenticación.
7. Autorización.
8. Sucursales.
9. Medicamentos.
10. Inventario.
11. Transferencias.
12. Ventas y caja.
13. Activos y planilla.
14. Entregas y disponibilidad.
15. Auditoría.
16. Dashboard.
17. Frontend e integración.

No implementar todo de una sola vez.

---

## 13. Forma de trabajar con Codex

Antes de realizar una tarea:

1. Leer este AGENTS.md.
2. Revisar los documentos relevantes en `/docs`.
3. Revisar el código existente.
4. Proponer brevemente el plan.
5. Implementar solamente lo solicitado.
6. Ejecutar verificaciones disponibles.
7. Informar archivos creados o modificados.
8. Informar errores o decisiones pendientes.

No asumir requisitos nuevos.

Si existe contradicción entre una suposición y la documentación, detenerse y señalarla.