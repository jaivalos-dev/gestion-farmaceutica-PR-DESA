# Backend — Día 9

Base técnica y autenticación en JavaScript con Express, dotenv, cors y node-oracledb.
Requiere Node.js 22 o superior (verificado con Node.js 24). Incluye autenticación y el catálogo de sucursales del Día 10.

## Preparación y ejecución

Desde la raíz del proyecto, copiar manualmente la plantilla:

```powershell
Copy-Item .env.example backend/.env
cd backend
npm.cmd ci
```

Completar `backend/.env` localmente:

| Variable | Uso |
| --- | --- |
| `ORACLE_USER` | Esquema de la aplicación, por ejemplo `FARMACIA` |
| `ORACLE_PASSWORD` | Contraseña local del esquema; la plantilla está vacía |
| `ORACLE_CONNECT_STRING` | Por ejemplo `localhost:1521/XEPDB1` |
| `PORT` | Puerto HTTP, predeterminado `3000` |
| `JWT_SECRET` | Secreto aleatorio largo definido localmente; obligatorio para JWT |

Las variables Oracle y `JWT_SECRET` son obligatorias. `PORT` debe estar entre 1 y 65535.
También pueden proporcionarse como variables del proceso; tienen prioridad sobre
`backend/.env`. La aplicación no carga el `.env` de la raíz.
No versionar `.env` ni compartir su contenido.

```powershell
npm.cmd start
# Desarrollo con reinicio automático:
npm.cmd run dev
```

En shells sin la restricción de scripts de PowerShell puede utilizarse `npm`.

## Comprobar Oracle manualmente

1. Verificar que Oracle XE y su listener estén activos y que el servicio sea
   `XEPDB1` (o ajustar la cadena al servicio local).
2. Completar las variables con el esquema de la aplicación; no usar `SYSTEM`.
3. Iniciar el backend y consultar desde otra terminal:

```powershell
curl.exe -i http://localhost:3000/api/health
```

Con Oracle disponible devuelve HTTP 200:

```json
{
  "ok": true,
  "data": { "api": "up", "oracle": "up" },
  "message": "API y Oracle disponibles"
}
```

Si falla la conexión, la consulta o la liberación de la conexión, devuelve HTTP 503:

```json
{
  "ok": false,
  "code": "DATABASE_UNAVAILABLE",
  "message": "Oracle no está disponible"
}
```

La única sentencia ejecutada por health es `SELECT 1 FROM dual`. No requiere consultar las
tablas del proyecto ni ejecutar DML o DDL. El mensaje de arranque confirma que HTTP
escucha; solo el health check confirma la conexión efectiva con Oracle.

El driver usa su modo Thin, sin inicializar Oracle Client. Este modo requiere
Oracle Database 12.1 o posterior; es adecuado para XE 18c/21c. No se habilita modo
Thick en esta etapa. Ver [documentación del driver](https://node-oracledb.readthedocs.io/en/latest/user_guide/installation.html).

## Organización

```text
src/
  config/env.js                  Variables y validación
  database/pool.js               Inicializar, obtener conexión y cerrar pool
  middlewares/errorHandler.js    Errores HTTP centralizados
  middlewares/authenticate.js    Bearer JWT y contexto req.user
  middlewares/authorizeRoles.js  Autorización por id_rol
  modules/auth/                 Routes, controller, service y repository de login
  modules/health/
    health.routes.js
    health.controller.js
    health.service.js
    health.repository.js
  shared/AppError.js             Error HTTP controlado
  shared/tokens.js               Firma y verificación JWT HS256
  app.js                        Configuración Express
  server.js                     Arranque y cierre del proceso
test/                           Pruebas técnicas sin Oracle
```

El flujo respeta `Routes → Controllers → Services → Repositories → Oracle`.
El repositorio libera la conexión en `finally`, incluso si la consulta falla.

## Pool, errores y cierre

- Pool de 0 a 4 conexiones, con apertura al solicitar una conexión. Oracle caído
  no impide que HTTP responda 503; una configuración ausente o inválida impide arrancar.
- Espera en cola y consulta limitadas a 5 segundos. El tiempo de conexión Oracle Net
  se configura en 5 segundos, sin reintentos; una cadena de conexión con sus propias
  opciones puede prevalecer. Estos límites no equivalen a un plazo HTTP total exacto.
- Los errores HTTP no exponen SQL, trazas ni detalles internos del driver.
- `SIGINT` (Ctrl+C) y `SIGTERM` dejan de aceptar solicitudes, esperan las conexiones
  HTTP pendientes hasta 10 segundos y después cierran el pool con drenaje de 5 segundos.
  Una terminación forzada del sistema operativo no permite garantizar este cierre.
- CORS no habilita orígenes externos todavía. Al integrar React se configurará el
  origen permitido, conforme al Documento 10.

## Verificaciones sin secretos

```powershell
npm.cmd test
npm.cmd ls --depth=0
```

Las pruebas cubren configuración, health, login, JWT y autorización por rol.
Usan bcrypt y JWT reales, credenciales ficticias y secretos aleatorios de prueba.
Sustituyen la conexión Oracle; no prueban conectividad real ni modifican datos.

Dependencias directas: `express`, `oracledb`, `dotenv`, `cors`, `bcrypt`, `jsonwebtoken`.
Se versiona `package-lock.json` para reproducir la instalación. No se utiliza nodemon;
`node --watch` y `node --test` cubren desarrollo y pruebas sin dependencias adicionales.

## Login y seguridad base

`POST /api/auth/login` es público y recibe JSON:

```json
{ "correo": "usuario@example.com", "password": "contraseña-ficticia" }
```

Devuelve `ok`, `message` y `data: { token, user }`. El contexto `user` contiene
`id_usuario`, `id_rol`, `nombre_rol` e `id_sucursal` (puede ser `null`). El JWT
incluye ese contexto y las marcas `iat`/`exp`; usa HS256 y vence en una hora.
No se devuelven el correo, la contraseña ni el hash. La respuesta no se almacena
en caché. El evento de acceso se registra en consola con el identificador del
usuario, sin token ni credenciales; no se escribe en AUDITORIA en esta etapa.

El correo se recorta en sus extremos y se consulta con igualdad exacta mediante
un bind de Oracle, sin convertir mayúsculas/minúsculas. La contraseña se conserva
exactamente y admite hasta 72 bytes UTF-8, límite de bcrypt.

- `400 INVALID_INPUT`: entrada ausente o formato inválido.
- `401 INVALID_CREDENTIALS`: correo inexistente, contraseña incorrecta o usuario
  inactivo; todos reciben el mismo mensaje.
- `503 DATABASE_UNAVAILABLE`: no se puede adquirir conexión Oracle.
- `500 INTERNAL_ERROR`: error interno, sin detalles de SQL ni del driver.

Para futuras rutas protegidas, aplicar en este orden:

```javascript
const authenticate = require('./middlewares/authenticate');
const authorizeRoles = require('./middlewares/authorizeRoles');
// IDs de roles definidos para la ruta según los datos existentes:
router.get('/ruta-protegida', authenticate, authorizeRoles(1, 2), controller);
```

`authenticate` valida `Authorization: Bearer <token>` y asigna el contexto a
`req.user`; tokens ausentes, inválidos o vencidos producen 401. `authorizeRoles`
compara identificadores numéricos de rol y devuelve 403 si no está permitido.
Una lista vacía rechaza todos los roles. El contexto de sucursal queda disponible
para las reglas de futuros módulos. Health permanece público.

Los tokens conservan el contexto emitido hasta vencer; esta etapa no incluye
revocación, refresh tokens ni consulta del estado del usuario en cada petición.

### Prueba manual contra Oracle real

1. Completar las variables Oracle y `JWT_SECRET` en `backend/.env`, sin sobrescribir
   las credenciales locales existentes ni versionar el archivo.
2. Disponer de un USUARIO existente con `activo = 'S'`, ROL relacionado y
   `password_hash` bcrypt válido cuya contraseña se conozca. Un hash de ejemplo
   o marcador de los datos demo no permite iniciar sesión. Si no existe una cuenta
   utilizable, su preparación requiere una tarea autorizada de datos; este cambio
   no crea ni actualiza usuarios.
3. Ejecutar `npm.cmd start` y comprobar `GET http://localhost:3000/api/health`.
4. Desde un cliente REST local enviar el JSON con las credenciales conocidas a
   `POST http://localhost:3000/api/auth/login`. Esperar HTTP 200 y `data.token`.
   Repetir con contraseña incorrecta y esperar el error genérico 401. No compartir
   ni registrar la contraseña o el token obtenido.

Los middlewares también se verifican con rutas temporales creadas exclusivamente
dentro de las pruebas.

## Sucursales — Día 10

Todas las rutas requieren `Authorization: Bearer <token>`. Las consultas admiten
cualquier usuario autenticado; las escrituras exigen `nombre_rol: ADMINISTRADOR`
del JWT validado, sin asumir un ID fijo. `authorizeRoles` admite ahora nombres
exactos de rol o identificadores numéricos, conservando su uso anterior.

| Método y ruta | Resultado |
| --- | --- |
| `GET /api/sucursales` | 200, `data` es un arreglo ordenado por ID, incluidas inactivas |
| `GET /api/sucursales/:id` | 200, `data` es la sucursal |
| `POST /api/sucursales` | 201, sucursal creada y cabecera `Location` |
| `PUT /api/sucursales/:id` | 200, sucursal actualizada |
| `PATCH /api/sucursales/:id/estado` | 200, sucursal con el estado actualizado |

POST recibe los cinco campos de texto obligatorios y, opcionalmente, `activa`
(predeterminado `S`). PUT requiere los seis campos editables completos:

```json
{
  "nombre": "Sucursal de prueba",
  "tipo_sucursal": "FARMACIA",
  "departamento": "Guatemala",
  "municipio": "Guatemala",
  "direccion": "Zona 1",
  "activa": "S"
}
```

PATCH recibe exclusivamente `{ "activa": "N" }` o `{ "activa": "S" }`.
No existe DELETE físico. Los tipos permitidos son `FARMACIA` y `STAND`.
Se recortan espacios externos de los textos y se rechazan campos desconocidos,
vacíos, tipos incorrectos e identificadores fuera de 1 a 9999999999.
Los límites UTF-8 son: nombre 100 bytes, tipo 30, departamento y municipio 50,
dirección 200, compatibles con los VARCHAR2 de la baseline con semántica BYTE.

Errores: 400 para entrada/ID inválido, 401 para autenticación inválida, 403 para
rol no autorizado, 404 `SUCURSAL_NOT_FOUND`, 503 si no se obtiene conexión y 500
para otros errores internos, sin detalles Oracle.

La implementación sigue routes → controller → service → repository → Oracle.
`database/connection.js` administra conexiones, commit y rollback; los servicios
delimitan las transacciones. Las escrituras y la lectura de su resultado usan la
misma conexión y confirman solo al finalizar. Los repositorios usan binds y
`RETURNING` para recuperar el ID generado por Oracle.

`sucursales.service.requireActive(id, connection)` rechaza con 409
`SUCURSAL_INACTIVE` una sucursal inactiva. Los futuros módulos operativos deberán
invocarlo dentro de su transacción y coordinar el bloqueo requerido por esa
operación. En esta entrega no existen operaciones de inventario/venta que puedan
usar sucursales; el catálogo mantiene las inactivas consultables y reactivables.

### Verificación manual pendiente

Las pruebas automatizadas simulan Oracle y no alteran datos reales. Para verificar
SQL y persistencia, usar una base de pruebas separada con el modelo oficial y
cuentas de prueba con hash bcrypt válido:

1. Obtener JWT de administrador y de otro rol mediante login.
2. Consultar listado y detalle con ambos tokens; sin token debe responder 401.
3. Con administrador, crear una sucursal, guardar su ID, actualizar sus campos y
   alternar `activa` entre `N` y `S`. Consultar después de cada escritura desde
   otra petición para confirmar persistencia.
4. Repetir escrituras con el otro rol y comprobar 403; verificar 400 para datos
   incompletos/tipo inválido y 404 para un ID inexistente.

Este procedimiento implica datos de prueba: no ejecutarlo contra los datos
reales existentes dentro del alcance de esta tarea.
