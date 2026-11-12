# Activos fijos

`/activos` requiere `activos.read`: ADMINISTRADOR y AUDITOR. Solo
`activos.write` (ADMINISTRADOR) muestra alta, edición y formulario.
ENCARGADO y DESPACHO no tienen enlaces ni acceso directo.

Endpoints utilizados:

- GET `/api/activos`, opcionalmente `?id_sucursal=...`.
- GET `/api/activos/:id` al abrir edición.
- POST `/api/activos` para alta.
- PUT `/api/activos/:id` para modificación completa.

Alta y edición envían únicamente `id_sucursal`, `categoria`, `descripcion`,
`valor`, `estado` y `responsable`. Se muestran además `id_activo`, `sucursal`
y `fecha_registro`, devueltos por backend.

Estados exactos: ACTIVO, MANTENIMIENTO, BAJA. Valor entre 0 y 9999999999.99,
con hasta dos decimales, sin redondeo. Categoría y descripción obligatorias,
con límites UTF-8 de 60 y 150 bytes. Responsable opcional: vacío se envía
como null; de lo contrario admite 100 bytes. ID de sucursal positivo de
hasta diez dígitos; su existencia y actividad se validan en backend.
Crear o cambiar de sucursal requiere destino activo. Editar conservando
la sucursal actual permite que esté inactiva. No hay DELETE ni reglas
adicionales de transición: BAJA es un estado, no una eliminación.

La documentación antigua contiene EN_MANTENIMIENTO; documentos 09/10 y
backend actual usan MANTENIMIENTO. El frontend sigue el contrato actual.

Después de escribir se recarga la consulta con el filtro aplicado; si el
activo cambió a otra sucursal puede desaparecer del listado filtrado.
Una recarga fallida conserva el éxito de la escritura y permite reintentar
solo GET. Un error de escritura conserva el formulario y el código de API.

## Verificación manual contra Oracle

1. ADMINISTRADOR: abrir desde menú e inicio, consultar todas las sucursales
   y filtrar por un ID existente; usar otro sin activos para ver lista vacía.
2. Crear un activo con sucursal activa, categoría y descripción, valor 0,
   estado ACTIVO y responsable vacío. Comprobar ID, nombre de sucursal,
   fecha y persistencia al recargar la página.
3. Editarlo: cambiar descripción, valor a 125.50, responsable y estado a
   MANTENIMIENTO. Guardar y verificar persistencia. Cambiar a BAJA y
   comprobar que sigue listado y conserva el mismo ID.
4. Abrir edición, cambiar campos y cancelar: comprobar que no se guardaron.
5. Intentar valor negativo, más de dos decimales, categoría/descripción
   vacías y textos que excedan límites UTF-8: comprobar rechazo sin pérdida
   de datos. Probar sucursal inexistente e inactiva al crear/cambiarla:
   mostrar error de API y permitir corrección o cancelación.
6. Con un activo ya asignado a sucursal inactiva, editar sin reasignar:
   comprobar que el frontend permite enviar y el backend acepta.
7. AUDITOR: consultar y filtrar sin botones de alta/edición. ENCARGADO y
   DESPACHO: no ver enlaces; navegar a /activos debe llevar a /403.
8. Con red lenta, pulsar Guardar dos veces: una sola escritura en Network.
   Simular fallo de POST/PUT: conservar formulario y permitir reintento.
   Simular fallo de GET posterior a escritura exitosa: conservar éxito,
   reintentar consulta sin repetir POST/PUT.

Las pruebas automatizadas usan contratos simulados y renderizado React
con Vite ya instalado; no ejecutan operaciones contra Oracle.
