# Dashboard

Ruta `/dashboard`, protegida con `dashboard.read` de la matriz central:
ADMINISTRADOR y AUDITOR. Menú e inicio usan el mismo permiso; ENCARGADO
y DESPACHO se redirigen a `/403` mediante ProtectedRoute.

Consume exclusivamente GET `/api/dashboard/resumen`, con `id_sucursal`
opcional. El cliente HTTP compartido extrae `data` del sobre `{ ok, data,
message }`. Carga global al montar; filtro vacío vuelve al consolidado.

Campos exactos consumidos:

- inventario: unidades, registros.
- caja: ingresos, egresos, saldo.
- ventas: cantidad_confirmadas, monto_confirmado.
- activos: cantidad, valor_total.
- planilla: cantidad_registros, total.
- entregas: total, pendientes, entregadas, canceladas.

No calcula indicadores: muestra los números remotos con formato es-GT,
moneda GTQ y conteos enteros. Cero es un resultado válido. Una respuesta
incompleta produce error y no se reemplaza por ceros ficticios.

El filtro acepta entero positivo de hasta diez dígitos o vacío. La API
es la autoridad final. Se descartan resultados al iniciar una consulta,
se bloquean envíos simultáneos y se cancelan consultas al desmontar.
Reintentar repite el filtro consultado; Consultar usa el filtro editado.
Los fallos no conservan indicadores de consultas anteriores.

Pruebas: `node --test test/dashboard.test.js test/dashboardView.test.js`.
Cubren permisos, guard de ruta, enlaces, cliente HTTP, estados de consulta,
render, ceros, errores, recuperación, doble envío y formatos.
