# Caja

Ruta `/caja`, protegida por `caja.read` de la matriz central. ENCARGADO consulta
su sucursal; AUDITOR consulta globalmente o filtra por `id_sucursal`.
ADMINISTRADOR y DESPACHO no tienen acceso ni enlaces al módulo.
Solo `caja.create` (ENCARGADO) permite el formulario manual.

Contratos usados:

- `GET /api/caja/movimientos`, con `id_sucursal` opcional.
- `POST /api/caja/movimientos`, con `{ tipo, monto, concepto }`.

Tipos: INGRESO y EGRESO. Monto positivo hasta 9999999999.99, con un máximo de
dos decimales sin redondear. Concepto obligatorio, recortado, hasta 200 bytes
UTF-8. Sucursal y usuario provienen del JWT en backend; no se envían desde el
formulario. No se permite introducir `id_venta` ni fecha.

La respuesta lista IDs de sucursal y usuario, no nombres. `id_venta` puede
ser null. Los movimientos manuales y automáticos son inmutables: no hay
edición, eliminación ni generación de ingresos a partir del listado de ventas.
Los movimientos automáticos se consultan exclusivamente mediante GET.

Al guardar se bloquean envíos simultáneos y se recarga el listado. Si falla
la recarga, se conserva el éxito de la escritura y se permite reintentar GET.
Si falla POST, el formulario conserva sus valores y permite corregir o cancelar.

Pruebas unitarias: permisos, restricciones de sucursal, validaciones, contratos
de requests, listado, errores, doble envío y recuperación tras fallos.
Pendiente en navegador con Oracle: comprobar los cuatro roles, filtros del
AUDITOR, aislamiento del ENCARGADO, altas INGRESO/EGRESO, persistencia al
recargar, cancelación, recuperación de red y visualización de un ingreso
automático de una venta confirmada sin duplicarlo.
