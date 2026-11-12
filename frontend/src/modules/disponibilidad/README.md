# Disponibilidad

Ruta `/disponibilidad`, permiso `disponibilidad.read`: ADMINISTRADOR,
ENCARGADO y DESPACHO. No exige sucursal JWT ni limita candidatos por ella.
AUDITOR no ve enlaces; acceso directo redirige a /403.

Único endpoint utilizado: GET `/api/disponibilidad`, con los cuatro
parámetros obligatorios id_medicamento, cantidad, departamento y municipio.
IDs/cantidad: enteros positivos de hasta diez dígitos. Ubicación: texto
recortado no vacío de hasta 50 bytes UTF-8. No se envía id_sucursal.

Respuesta: disponible, id_medicamento, cantidad, candidatos. Cada candidato
incluye id_sucursal, nombre, tipo_sucursal, departamento, municipio,
existencia, cantidad_solicitada, prioridad, tiempo_estimado, eta_disponible
y formas_pago. Se conserva el orden del servidor. No se calcula ETA.

Limitaciones del contrato: medicamento identificado por ID, sin nombre;
no existe campo de viabilidad logística garantizada. disponible indica
candidatos con stock suficiente; eta_disponible indica si hay estimación,
no una garantía de entrega. ETA null se muestra como Sin estimación.
La consulta no reserva stock ni realiza escrituras, GPS o ruteo.

Pendiente de prueba manual contra Oracle: medicamento activo con stock,
cantidad superior a existencias, medicamento inexistente/inactivo;
destinos con ETA y sin ETA; comprobar formas de pago y orden de candidatos;
errores y reintento sin perder formulario; control de roles y /403 AUDITOR.
Cambiar los campos tras consultar no cambia el destino del resultado ya
mostrado: se conserva la referencia a la consulta realizada.
