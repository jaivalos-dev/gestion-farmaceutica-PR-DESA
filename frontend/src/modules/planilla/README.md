# Planilla

Ruta `/planilla`: `planilla.read` para ADMINISTRADOR y AUDITOR.
`planilla.write` permite registro únicamente a ADMINISTRADOR. Menú e inicio
consultan la matriz central; ENCARGADO y DESPACHO no tienen enlaces y el
acceso directo termina en /403.

Endpoints usados:

- GET `/api/planilla/gastos`: filtros opcionales `id_sucursal`, `periodo`,
  `concepto` (búsqueda parcial).
- GET `/api/planilla/resumen`: únicamente `id_sucursal` y `periodo`.
- POST `/api/planilla/gastos`: `id_sucursal`, `periodo`, `concepto`, `monto`.

El endpoint individual GET `/api/planilla/gastos/:id` existe, pero esta
pantalla no necesita consultarlo: todos los campos requeridos vienen en
el listado. No existen controles de edición o eliminación.

El listado muestra `id_gasto`, `sucursal`, `usuario`, `periodo`, `concepto`,
`monto`, `fecha_registro`. El resumen presenta `total` y `cantidad_registros`
tal como los calcula Oracle, sin sumar filas en el frontend. La pantalla
indica que concepto no afecta el resumen.

Período: exactamente YYYY-MM, mes 01–12, sin espacios. El backend no limita
el año más allá de cuatro dígitos. Concepto obligatorio hasta 120 bytes
UTF-8, recortado. Monto positivo (cero no permitido), máximo 9999999999.99,
hasta dos decimales sin redondear. Sucursal: ID positivo de hasta diez
dígitos; backend verifica existencia y actividad al registrar. Usuario
y fecha no se envían: los determina el servidor.

Registro con bloqueo de doble envío, cancelación y conservación de valores
ante errores. Después del POST se recargan listado y resumen. Los fallos
de consulta se muestran independientemente y conservan el éxito del POST;
reintentar consultas no repite la escritura.

## Pruebas manuales pendientes con Oracle

1. ADMINISTRADOR: abrir desde menú e inicio, comprobar listado y resumen.
2. Filtrar por sucursal y período. Agregar concepto: confirmar que filtra
   solo el listado y no cambia el total/cantidad del resumen.
3. Crear con sucursal activa, período YYYY-MM, concepto y monto 125.50.
   Verificar éxito, recarga de ambas consultas y persistencia al recargar.
4. Cancelar un formulario: ningún POST. Probar monto cero/negativo,
   tres decimales, mes 00/13 y concepto vacío o mayor de 120 bytes.
5. Probar sucursal inexistente/inactiva: ver mensaje/código API y poder
   corregir o cancelar sin perder los valores del formulario.
6. AUDITOR: consultar sin botón/formulario de registro. ENCARGADO y
   DESPACHO: sin enlaces; /planilla redirige a /403.
7. Red lenta y doble pulsación de Guardar: una sola petición POST.
   Simular error en listado o resumen y reintentar; comprobar que la
   otra sección conserva su resultado y no se repite un POST exitoso.
8. Consultar una combinación sin gastos: listado vacío y resumen 0/0.

Las pruebas automatizadas verifican helpers con respuestas simuladas y
renderizado React. No sustituyen estas pruebas contra Oracle.
