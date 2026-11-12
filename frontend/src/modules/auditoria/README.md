# Auditoría

Ruta `/auditoria`, protegida por `auditoria.read` de la matriz central:
ADMINISTRADOR y AUDITOR consultan globalmente. ENCARGADO y DESPACHO no ven
enlaces; el acceso directo redirige a /403. La página no contiene reglas
de roles duplicadas.

Única operación: GET `/api/auditoria`. Sin endpoints de escritura, detalle
individual o paginación en el backend actual.

Filtros opcionales exactos: `fecha_desde`, `fecha_hasta`, `id_usuario`,
`id_sucursal`, `modulo`, `accion`, `entidad`, `id_entidad`. Los vacíos se
omiten. Fechas reales YYYY-MM-DD, rango ordenado e inclusivo de ambos días.
IDs positivos de hasta diez dígitos. Módulo/acción/entidad se seleccionan
de los catálogos admitidos en `auditoria.service.js`; GET permite combinar
valores válidos aunque no existan eventos que coincidan.

El cliente común desenvuelve `{ ok: true, data: [...], message }`.
Cada evento devuelve `id_auditoria`, `id_usuario`, `usuario`, `id_sucursal`,
`sucursal`, `modulo`, `accion`, `entidad`, `id_entidad`, `descripcion`,
`fecha_hora`. Orden: fecha/hora e ID descendentes, conservado en la UI.
Usuario y sucursal pueden ser null por las relaciones opcionales.

Solo se conservan campos del contrato y se renderizan columnas explícitas.
No se serializan objetos inesperados ni se renderiza HTML recibido.
Textos con indicadores reconocibles de credenciales (password, contraseña,
token, Authorization/Bearer, secret, API key, JWT o hash bcrypt) se ocultan,
incluidos mensajes de error. Esto es una defensa visual adicional: un
secreto arbitrario sin indicador no es identificable como tal por el
frontend; el backend sigue siendo responsable de no enviarlo.

Discrepancia documental: backend/README.md conserva notas antiguas sobre
auditoría transversal pendiente. Rutas, servicio y pruebas actuales ya
implementan consulta y registro interno; este frontend sigue esos contratos.
No se modificó la documentación ni el código backend.

## Comprobaciones manuales pendientes contra Oracle

1. Entrar como ADMINISTRADOR y AUDITOR, abrir Auditoría desde menú e inicio.
2. Consultar sin filtros; comprobar columnas, fecha legible y relaciones
   nulas representadas por —.
3. Combinar fechas (incluido mismo día), usuario, sucursal, módulo, acción,
   entidad e ID de entidad; verificar coincidencias y lista vacía.
4. Probar fecha desde posterior a hasta: mostrar error sin perder filtros.
5. ENCARGADO y DESPACHO: sin enlaces; /auditoria debe redirigir a /403.
6. Simular fallo de red, verificar filtros visibles y reintento GET.
7. Revisar Network: únicamente GET de auditoría; ningún POST/PUT/DELETE.

Las pruebas automatizadas usan respuestas simuladas y renderizado React;
no ejecutan consultas contra Oracle.
