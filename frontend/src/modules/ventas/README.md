# Ventas

`/ventas` usa `ventas.read`; menú e inicio consultan la misma matriz central.
Las operaciones usan `ventas.act`. Ambos permisos corresponden exclusivamente
a ENCARGADO. La API impone el contexto de sucursal del JWT.

Contratos utilizados:

- `GET /api/ventas`: listado de la sucursal; usuario mostrado como `id_usuario`.
- `GET /api/ventas/:id`: cabecera y `detalles`, incluidos precios y subtotales.
- `POST /api/ventas`: `{ forma_pago, detalles: [{ id_medicamento, cantidad }] }`.
- `POST /api/ventas/:id/confirmar`: sin cuerpo, previa confirmación visual.
- `GET /api/medicamentos`: selección de medicamentos con `activo === 'S'`.

El formulario impide duplicados (el backend los agrupa), requiere cantidades
enteras positivas de hasta diez dígitos y permite EFECTIVO, TARJETA,
TRANSFERENCIA y OTRO. No envía sucursal, usuario, estado, precios ni total.
CREADA y CONFIRMADA se muestran según las respuestas del servidor.

Las escrituras bloquean envíos simultáneos y recargan listado y detalle.
Un fallo de recarga se presenta por separado del éxito de la escritura.
Los errores de API conservan mensaje y código, incluido INSUFFICIENT_STOCK.
No se implementan edición, eliminación ni anulación.

Verificación automatizada: `npm test`, `npm run lint`, `npm run build` desde
`frontend`, y `git diff --check` desde la raíz. En PowerShell puede ser
necesario invocar `npm.cmd` si está bloqueado el script `npm.ps1`.
Las pruebas de Ventas usan respuestas simuladas del contrato; no sustituyen
una prueba de navegador con backend y Oracle activos.
