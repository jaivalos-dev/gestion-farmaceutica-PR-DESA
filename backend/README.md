# Backend — Día 9

Base técnica en JavaScript con Express, dotenv, cors y node-oracledb.
Requiere Node.js 22 o superior (verificado con Node.js 24). No contiene módulos de negocio.

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

Las variables Oracle son obligatorias. `PORT` debe estar entre 1 y 65535.
También pueden proporcionarse como variables del proceso; tienen prioridad sobre
`backend/.env`. La aplicación no carga el `.env` de la raíz. `JWT_SECRET` está
reservado en la plantilla para otra etapa y no se utiliza ni se valida todavía.
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

La única sentencia ejecutada es `SELECT 1 FROM dual`. No requiere consultar las
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
  modules/health/
    health.routes.js
    health.controller.js
    health.service.js
    health.repository.js
  shared/AppError.js             Error HTTP controlado
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

Las pruebas cubren configuración y HTTP con un sustituto del driver para simular
Oracle disponible, conexión rechazada y consulta fallida. No prueban conectividad
real ni reglas de negocio. La validación contra Oracle requiere el procedimiento
manual anterior.

Dependencias directas: `express`, `oracledb`, `dotenv`, `cors`.
Se versiona `package-lock.json` para reproducir la instalación. No se utiliza nodemon;
`node --watch` y `node --test` cubren desarrollo y pruebas sin dependencias adicionales.
