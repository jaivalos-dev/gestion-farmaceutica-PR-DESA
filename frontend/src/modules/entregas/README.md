# Entregas

Ruta `/entregas`. Permisos centrales: `entregas.read` para ADMINISTRADOR,
ENCARGADO y DESPACHO; `entregas.create` solo ENCARGADO;
`entregas.changeState` para ENCARGADO y DESPACHO. AUDITOR no ve enlaces y
el acceso directo redirige a /403. ENCARGADO solo opera en su sucursal;
ADMINISTRADOR y DESPACHO tienen consulta global.

Endpoints utilizados:

- GET `/api/entregas`: filtros opcionales id_sucursal, id_venta, estado,
  departamento y municipio.
- GET `/api/entregas/:id`: detalle.
- POST `/api/entregas`: id_venta, nombre_cliente, telefono, direccion,
  departamento, municipio y observaciones opcionales.
- PUT `/api/entregas/:id/estado`: únicamente `{ estado }`.

Transiciones verificadas en el servicio:

| Origen | Destino | Rol |
|---|---|---|
| CREADA | ASIGNADA o CANCELADA | ENCARGADO |
| ASIGNADA | PREPARADA o CANCELADA | ENCARGADO |
| PREPARADA | CANCELADA | ENCARGADO |
| PREPARADA | EN_RUTA | DESPACHO |
| EN_RUTA | ENTREGADA | DESPACHO |

ENTREGADA y CANCELADA son terminales. No hay edición genérica ni DELETE.
Las reglas por transición complementan los permisos generales de la matriz.

El alta requiere venta CONFIRMADA, de la sucursal del encargado, sin entrega
previa, y sucursal activa. Estas condiciones se validan en backend; los
errores conservan message y code. El servidor asigna CREADA, sucursal, ETA
y fechas; no se envían desde el formulario. Límites UTF-8: cliente 100,
teléfono 20, dirección 200, departamento/municipio 50, observaciones 250.
Cancelar logística no anula venta ni revierte inventario.

La respuesta contiene id_sucursal, no nombre de sucursal. Detalle y listado
muestran los campos disponibles. El detalle se actualiza con la respuesta
completa de POST/PUT y el listado se vuelve a consultar. Fallar la recarga
no oculta que la escritura terminó ni provoca repetirla.

Pendiente de prueba manual contra Oracle: crear sobre venta confirmada;
rechazos por venta no confirmada, ajena y duplicada; ciclo completo entre
ENCARGADO y DESPACHO; cancelación antes de EN_RUTA; estados terminales;
fecha de entrega; consulta global de ADMINISTRADOR sin escritura; /403 de
AUDITOR; doble envío con red lenta y recuperación de errores de escritura
y consulta. Verificar que ninguna operación logística descuenta stock.
