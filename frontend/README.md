# Frontend administrativo

Base académica React + Vite + JavaScript. Alcance: login, sesión JWT, inicio, consulta, alta y edición de sucursales y medicamentos con permisos visuales. No contiene dashboard ni reglas de negocio transaccionales.

## Ejecutar frontend y backend

Requiere Node.js compatible con la instalación existente (verificado con Node.js 24).

1. Iniciar Oracle XE y el backend según ../backend/README.md. En una terminal dentro de backend: npm.cmd start. Usar su configuración local existente; no modificar los scripts SQL.
2. En otra terminal dentro de frontend ejecutar:

```powershell
npm.cmd ci
npm.cmd run dev
```

Abrir la dirección que muestra Vite (normalmente http://localhost:5173).
No hay credenciales predeterminadas del frontend: se necesita un usuario activo existente con contraseña válida para el backend.

### Configuración y proxy

.env.example contiene VITE_API_URL=http://localhost:3000. No se creó un .env real. Para cambiar el destino puede copiarse esa plantilla a .env.local (ignorado por Git) o establecer VITE_API_URL en el proceso antes de iniciar Vite. Reiniciar Vite después de cambiar la variable. No colocar secretos en variables VITE_: son públicas.

El backend actual no permite CORS entre orígenes. En desarrollo, fetch solicita /api al mismo origen de Vite, que reenvía al destino VITE_API_URL. Sin variable, vite.config.js utiliza el destino local predeterminado. Esto permite integrar la API sin cambiar backend.

El cliente usa rutas relativas /api tanto en desarrollo como en el build. VITE_API_URL se consume en vite.config.js como destino del proxy para dev y preview; no se solicita directamente desde el navegador porque el backend actual no permite CORS. Para probar la compilación local ejecutar npm.cmd run build y npm.cmd run preview, usando la misma configuración.

Un despliegue estático requiere servir index.html como fallback de las rutas React y dirigir /api al backend mediante el servidor del despliegue. El proxy de Vite solo aplica a dev/preview; VITE_API_URL no configura por sí sola un servidor de producción.

## Contratos utilizados

Todas las respuestas exitosas contienen ok: true, data y message. Los errores de API contienen ok: false, code y message, que el cliente conserva junto al estado HTTP.

| Endpoint | Contrato |
| --- | --- |
| GET /api/health | Público. data: { api: 'up', oracle: 'up' }; 503 DATABASE_UNAVAILABLE si Oracle falla. Se usa para comprobación manual, no como dashboard. |
| POST /api/auth/login | JSON { correo, password }; data: { token, user }. user contiene id_usuario, id_rol, nombre_rol e id_sucursal (puede ser null). |
| GET /api/sucursales | Requiere Bearer; data es arreglo con id_sucursal, nombre, tipo_sucursal, departamento, municipio, direccion, activa. |
| GET /api/medicamentos | Requiere Bearer; data es arreglo con id_medicamento, codigo, nombre, categoria, presentacion, precio, activo. |

Las consultas admiten cualquier usuario autenticado según las rutas actuales del backend. Se muestran también registros inactivos. S/N se presenta mediante badges Activo/Activa e Inactivo/Inactiva y precio con dos decimales, sin asumir moneda.

## Presentación

Bootstrap 5.3 aporta navbar, cards, formularios, tablas, botones, alertas y badges mediante clases CSS. Solo se importa bootstrap/dist/css/bootstrap.min.css en main.jsx; no se utiliza JavaScript de Bootstrap ni React-Bootstrap. index.css conserva ajustes mínimos de fondo, encabezado, ruta activa y ancho del login.

El frontend utiliza UTF-8. El encabezado Dirección es un literal local del catálogo, mientras que los valores de la columna direccion proceden de la API. Si reaparece un carácter de sustitución, comparar el encabezado con Response de /api/sucursales en DevTools antes de atribuirlo a Oracle o modificar datos.

## Sesión y organización

- src/api/: cliente fetch reutilizable y configuración; errores de HTTP, JSON y conectividad.
- src/auth/: contexto de React, persistencia del JWT y contexto visual decodificado.
- src/routes/: protección de rutas administrativas.
- src/layouts/: encabezado, navegación y cierre de sesión.
- src/pages/: login e inicio.
- src/modules/: consultas de sucursales y medicamentos.
- src/components/: tabla HTML compartida con carga, error, reintento y ausencia de datos.
- test/: pruebas con node:test, sin dependencias adicionales.

Solo se persiste el JWT en localStorage bajo farmacia.session; nunca la contraseña. La recarga restaura tokens no vencidos. Cerrar sesión, vencer el token o recibir un 401 protegido elimina la sesión. Un 401 de login muestra las credenciales inválidas. Un 403 se muestra como error sin cerrar sesión. El cierre se sincroniza entre pestañas.

La decodificación del JWT únicamente sirve a presentación y navegación. No verifica firmas ni autoriza operaciones; Express conserva esa responsabilidad. El uso de localStorage corresponde al alcance MVP indicado.

## Verificaciones

### Permisos visuales y navegación

`src/auth/permissions.js` centraliza los permisos por operación. `hasPermission(user, permission)` se utiliza en rutas, menú e inicio; las acciones futuras deben consultar la misma fuente. ADMINISTRADOR no tiene privilegios implícitos. Los permisos desconocidos se deniegan. Las consultas de sucursales y medicamentos permiten cualquier usuario autenticado.

Las rutas funcionales son `/login`, `/`, `/sucursales`, `/medicamentos`, `/inventario` y `/403`. El menú muestra Inicio, Sucursales, Medicamentos e Inventario según permisos. No hay enlaces a módulos pendientes.

`ProtectedRoute` admite `permission` o `roles`; si se especifican ambos, exige ambos. Sin sesión redirige a `/login`; sin autorización redirige a `/403` sin cerrar sesión. Sin restricciones adicionales conserva el acceso autenticado. `/403` solo requiere sesión y permite regresar a Inicio.

Para incorporar una operación se reutiliza su clave central, por ejemplo `ventas.read`, `inventario.adjust` o `entregas.changeState`. Los permisos solo controlan presentación: el backend sigue validando autorización, sucursal y reglas de negocio.

Las pruebas de permisos cubren lectura y escritura para los cuatro roles. `test/routeAccess.test.js` prueba la decisión de acceso que utiliza `ProtectedRoute`, sin incorporar herramientas de renderizado JSX ni dependencias nuevas; no sustituye una prueba de navegación en navegador.

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
git diff --check
```

Las pruebas automáticas verifican JSON/Bearer, preservación de errores, expiración por 401 protegido, errores de red/respuestas no JSON, restauración Unicode y descarte de tokens vencidos o malformados. No sustituyen una prueba en navegador contra Oracle.

## Guion manual (RF-01/02, consulta RF-03/04, CU-01/03/04)

1. Consultar /api/health por el puerto de Vite: debe devolver HTTP 200 y api/oracle up.
2. Sin sesión, abrir /sucursales y /medicamentos: debe redirigir a /login.
3. Ingresar credenciales incorrectas: mostrar el mensaje/code de la API sin guardar contraseña ni sesión.
4. Iniciar sesión con una cuenta activa existente: mostrar Inicio, usuario/rol y navegación. Abrir /login con sesión debe redirigir a /.
5. Abrir Sucursales y Medicamentos: verificar filas reales contra la API y los siete campos de cada catálogo. ADMINISTRADOR puede crear/editar ambos; ENCARGADO solo medicamentos; AUDITOR y DESPACHO solo consultan. Comprobar que Nuevo/Editar no aparezcan sin permiso.
6. Recargar una ruta administrativa: conservar sesión y volver a consultar la API. Verificar cierre de sesión y posterior bloqueo de rutas, también en otra pestaña.
7. Para comprobar 401, alterar solamente la firma del JWT guardado en DevTools, manteniendo su payload y exp; recargar y consultar un catálogo. La API debe rechazarlo y la aplicación debe borrar la sesión y volver a login.
8. Detener temporalmente el backend en el entorno de prueba: mostrar error al consultar; reiniciarlo y usar Reintentar. La carga puede observarse con throttling de red de DevTools.
9. Si una consulta devuelve un arreglo vacío, mostrar el mensaje sin datos. Si no hay una base vacía de prueba, simular esa respuesta exclusivamente en el navegador; no borrar registros Oracle para probarla.

### Alta y edición de catálogos

`CatalogManager` comparte el formulario embebido, mensajes y guardado mediante `useAuth().request`. `CatalogTable` conserva carga/error/lista vacía/reintento y añade acciones de edición opcionales. Después de guardar se vuelve a consultar el listado; un fallo de esa consulta muestra su propio error y permite reintentar sin repetir la escritura.

Se utilizan `GET /api/sucursales`, `POST /api/sucursales`, `PUT /api/sucursales/:id` y sus equivalentes en `/api/medicamentos`. La edición parte de los campos completos recibidos en el listado. El estado se envía en el PUT (`activa` para sucursales, `activo` para medicamentos, valores S/N). No se utiliza DELETE ni se necesita una petición PATCH separada.

Los campos de texto se recortan y validan como obligatorios, con los límites UTF-8 del contrato. El tipo de sucursal admite FARMACIA/STAND. El precio se envía como número finito, mayor o igual a cero y menor que 99999999.995; se admiten decimales adicionales y Oracle aplica el redondeo. Los mensajes/códigos de la API se muestran sin cerrar sesión ante 403; 401 conserva el manejo central existente.

Para verificar manualmente: crear y editar un registro con un rol autorizado, cancelar sin guardar, cambiar estado, comprobar el listado actualizado y probar código de medicamento duplicado. Probar también precio cero, negativo y fuera de rango, y ausencia de controles con roles de consulta. Durante el guardado se bloquean los controles para evitar envíos repetidos. Estas operaciones deben hacerse con datos de demostración autorizados.

`test/catalogForms.test.js` cubre transformación, texto obligatorio, límites UTF-8, enums, precio y decisiones de permisos. Las pruebas unitarias y el build no sustituyen la verificación de los formularios en navegador contra la API y Oracle.

### Inventario

`/inventario` permite consultar ID, sucursal, medicamento, código, existencia y fecha de actualización. Los filtros reciben IDs de sucursal y medicamento (consultables en los catálogos) y se envían como `id_sucursal` e `id_medicamento` a `GET /api/inventario`. Los filtros vacíos se omiten. ENCARGADO tiene su sucursal fijada; la API sigue aplicando el alcance. ADMINISTRADOR y ENCARGADO pueden ajustar, AUDITOR solo consulta y DESPACHO no tiene acceso ni enlaces.

El formulario envía `POST /api/inventario/ajustes` con IDs numéricos, `tipo_movimiento`, `cantidad` entera positiva de hasta 10 dígitos y `referencia` obligatoria de hasta 100 bytes UTF-8. ENTRADA y AJUSTE incrementan existencia; SALIDA descuenta. AJUSTE no representa un saldo absoluto ni admite cantidad negativa. Solo ENTRADA puede crear un inventario inexistente. No se realizan modificaciones directas de existencia desde React.

Durante el guardado se bloquea el envío repetido. Tras éxito se informa el nuevo saldo y se consulta nuevamente el listado con los filtros aplicados. Si falla esta consulta se conserva la confirmación y se ofrece reintentar solo la lectura. Cancelar cierra el formulario sin enviar. Los errores de stock, catálogos inactivos y alcance se muestran desde la API; 403 conserva sesión y 401 utiliza el manejo central.

Pruebas manuales contra Oracle: verificar consulta con ambos filtros; acceso y controles de los cuatro roles; sucursal fija de ENCARGADO; entrada, salida y ajuste sobre datos de demostración; rechazo de salida superior a existencia; referencia vacía y cantidad inválida; cancelación; doble clic al guardar; recarga y coincidencia del nuevo saldo. Verificar que cada operación exitosa produzca un único movimiento y su auditoría mediante los mecanismos de consulta existentes. Comprobar caída de API y reintento, y acceso directo de DESPACHO a `/inventario` (debe ir a `/403`).

`test/inventario.test.js` verifica permisos, filtros, transformación/validación, secuencia POST/GET, liberación del bloqueo tras error, doble envío y fallo de recarga tras una escritura confirmada. No sustituye una prueba de interacción en navegador.

No se modificaron backend, database, docs ni AGENTS.md. No se realizó commit.
