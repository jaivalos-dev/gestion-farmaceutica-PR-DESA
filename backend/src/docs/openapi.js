// Contratos HTTP existentes. Los límites de texto del backend se miden en bytes UTF-8.
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const id = { type: 'integer', minimum: 1, maximum: 9999999999, example: 1 };
const text = (bytes, example) => ({
  type: 'string', minLength: 1, maxLength: bytes,
  description: `Texto no vacío tras trim; máximo ${bytes} bytes UTF-8.`, example,
});
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required });
const input = (properties, required) => ({ ...object(properties, required), additionalProperties: false });
const array = name => ({ type: 'array', items: ref(name) });
const json = schema => ({ 'application/json': { schema } });
const body = name => ({ required: true, content: json(ref(name)) });
const parameter = (name, schema, required = false) => ({ name, in: 'query', required, schema });
const pathId = { name: 'id', in: 'path', required: true, schema: id, description: 'Entero positivo de hasta 10 dígitos, sin ceros iniciales.' };
const protectedAccess = [{ bearerAuth: [] }];
const estado = { type: 'string', enum: ['CREADA', 'ASIGNADA', 'PREPARADA', 'EN_RUTA', 'ENTREGADA', 'CANCELADA'] };
const activo = { type: 'string', enum: ['S', 'N'], example: 'S' };
const medicineFields = {
  codigo: text(30, 'PARA-500'), nombre: text(120, 'Paracetamol'),
  categoria: text(60, 'Analgésico'), presentacion: text(80, 'Tableta 500 mg'),
  precio: { type: 'number', minimum: 0, maximum: 99999999.995, exclusiveMaximum: true,
    description: 'Oracle NUMBER(10,2) redondea a dos decimales.', example: 2.5 }, activo,
};
const deliveryFields = {
  id_venta: id, nombre_cliente: text(100, 'Ana López'), telefono: text(20, '5555-0101'),
  direccion: text(200, '5 avenida 10-20, zona 1'),
  departamento: text(50, 'Guatemala'), municipio: text(50, 'Guatemala'),
  observaciones: { type: 'string', nullable: true, maxLength: 250,
    description: 'Opcional; máximo 250 bytes UTF-8 tras trim. Vacío se guarda como null.', example: 'Llamar al llegar.' },
};
const eta = { type: 'integer', nullable: true, enum: [30, 60, null],
  description: 'Minutos estimados: 30 en el mismo departamento y municipio, 60 en el mismo departamento; null fuera del departamento. Coincidencia textual normalizada, sin distancia ni tráfico real.', example: 30 };

function success(schema, message, createdPath) {
  const response = { description: message, content: json(object({
    ok: { type: 'boolean', enum: [true] }, data: schema, message: { type: 'string', example: message },
  })) };
  if (createdPath) response.headers = { Location: { description: 'URL del recurso creado.', schema: { type: 'string', example: createdPath } } };
  return response;
}

function error(description, code, message) {
  return { description, content: { 'application/json': {
    schema: ref('Error'), example: { ok: false, code, message },
  } } };
}

const unauthorized = error('Bearer ausente, inválido o expirado.', 'UNAUTHORIZED', 'Autenticación requerida');
const forbidden = error('Rol sin permiso; FORBIDDEN_BRANCH cuando ENCARGADO no tiene sucursal o accede a otra.', 'FORBIDDEN', 'Acceso no autorizado');
const internal = error('Error interno no expuesto al cliente.', 'INTERNAL_ERROR', 'Error interno del servidor');
const invalid = codes => error(`Validación: ${codes}. En cuerpos JSON también INVALID_JSON.`, 'INVALID_INPUT', 'Datos de medicamento inválidos');
const invalidId = error('Identificador inválido.', 'INVALID_ID', 'Identificador de medicamento inválido');
const medicineMissing = error('Medicamento inexistente.', 'MEDICAMENTO_NOT_FOUND', 'Medicamento inexistente');
const deliveryMissing = error('Entrega inexistente.', 'ENTREGA_NOT_FOUND', 'Entrega inexistente');
const duplicateCode = error('Código de medicamento duplicado.', 'MEDICAMENTO_CODE_DUPLICATE', 'El código de medicamento ya existe');
const payload = error('Cuerpo JSON mayor al límite de 100kb.', 'PAYLOAD_TOO_LARGE', 'Solicitud demasiado grande');
const securedErrors = { 401: unauthorized, 500: internal };
const deliveryErrors = { ...securedErrors, 403: forbidden };
const writer = 'Solo ADMINISTRADOR y ENCARGADO.';
const reader = 'ENCARGADO consulta únicamente su sucursal; DESPACHO y ADMINISTRADOR pueden consultar todas las sucursales.';

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'Sistema Integral de Gestión Farmacéutica', version: '1.0.0',
    description: 'Primera versión de documentación: autenticación, medicamentos, disponibilidad y entregas. Las respuestas exitosas usan { ok, data, message }; los errores usan { ok, code, message }. Los ejemplos son ficticios.',
  },
  servers: [{ url: '/', description: 'Servidor actual (local o Render)' }],
  tags: ['Autenticación', 'Medicamentos', 'Disponibilidad', 'Entregas'].map(name => ({ name })),
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT',
        description: 'Token obtenido en POST /api/auth/login. Expira en una hora. Introducir solo el token en Authorize.' },
    },
    schemas: {
      Error: object({ ok: { type: 'boolean', enum: [false] }, code: { type: 'string' }, message: { type: 'string' } }),
      LoginRequest: object({
        correo: { type: 'string', format: 'email', maxLength: 120, description: 'Correo sin espacios internos; se aplica trim.', example: 'encargado@example.com' },
        password: { type: 'string', format: 'password', minLength: 1, maxLength: 72, writeOnly: true,
          description: 'Máximo 72 bytes UTF-8. Ejemplo ficticio; sustituir por credenciales propias.', example: 'Ejemplo-no-real-2026!' },
      }),
      LoginData: object({ token: { type: 'string', description: 'JWT firmado por el servidor.' }, user: ref('UsuarioAutenticado') }),
      UsuarioAutenticado: object({ id_usuario: id, id_rol: id, nombre_rol: { type: 'string', example: 'ENCARGADO' }, id_sucursal: { ...id, nullable: true } }),
      Medicamento: object({ id_medicamento: id, ...medicineFields }),
      CrearMedicamento: input({ ...medicineFields, activo: { ...activo, default: 'S' } }, ['codigo', 'nombre', 'categoria', 'presentacion', 'precio']),
      ActualizarMedicamento: input(medicineFields),
      EstadoMedicamento: input({ activo }),
      Disponibilidad: object({ disponible: { type: 'boolean', example: true }, id_medicamento: id, cantidad: id, candidatos: array('CandidatoDisponibilidad') }),
      CandidatoDisponibilidad: object({
        id_sucursal: id, nombre: { type: 'string', example: 'Farmacia Central' }, tipo_sucursal: { type: 'string', enum: ['FARMACIA', 'STAND'] },
        departamento: { type: 'string', example: 'Guatemala' }, municipio: { type: 'string', example: 'Guatemala' },
        existencia: { type: 'integer', minimum: 0, example: 50 }, cantidad_solicitada: { ...id, example: 2 },
        prioridad: { type: 'integer', enum: [1, 2, 3], description: '1: mismo departamento y municipio; 2: mismo departamento; 3: otro departamento.' },
        tiempo_estimado: eta, eta_disponible: { type: 'boolean', example: true },
        formas_pago: { type: 'array', items: { type: 'string', enum: ['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'OTRO'] }, example: ['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'OTRO'] },
      }),
      CrearEntrega: input(deliveryFields, ['id_venta', 'nombre_cliente', 'telefono', 'direccion', 'departamento', 'municipio']),
      Entrega: object({
        id_entrega: id, ...deliveryFields, id_sucursal: id, tiempo_estimado: eta, estado,
        fecha_solicitud: { type: 'string', format: 'date-time', example: '2026-11-22T15:00:00.000Z' },
        fecha_entrega: { type: 'string', format: 'date-time', nullable: true, example: null },
      }),
      EstadoEntrega: input({ estado }),
    },
  },
  paths: {
    '/api/auth/login': {
      post: {
        tags: ['Autenticación'], summary: 'Iniciar sesión', security: [], requestBody: body('LoginRequest'),
        description: 'Devuelve token JWT y contexto user. La cuenta debe estar activa. Respuesta con Cache-Control: no-store.',
        responses: {
          200: { ...success(ref('LoginData'), 'Autenticación exitosa'), headers: { 'Cache-Control': { schema: { type: 'string', example: 'no-store' } } } },
          400: error('INVALID_INPUT por correo o contraseña inválidos; INVALID_JSON por JSON mal formado.', 'INVALID_INPUT', 'Correo o contraseña con formato inválido'),
          401: error('Cuenta inexistente, inactiva o contraseña incorrecta.', 'INVALID_CREDENTIALS', 'Credenciales inválidas'),
          413: payload, 500: internal,
        },
      },
    },
    '/api/medicamentos': {
      get: {
        tags: ['Medicamentos'], summary: 'Listar medicamentos', security: protectedAccess,
        description: 'Cualquier usuario autenticado. Incluye activos e inactivos, ordenados por id_medicamento. Sin filtros ni paginación.',
        responses: { 200: success(array('Medicamento'), 'Medicamentos consultados'), ...securedErrors },
      },
      post: {
        tags: ['Medicamentos'], summary: 'Crear medicamento', description: writer, security: protectedAccess, requestBody: body('CrearMedicamento'),
        responses: { 201: success(ref('Medicamento'), 'Medicamento creado', '/api/medicamentos/1'),
          400: invalid('INVALID_INPUT'), ...securedErrors, 403: forbidden, 409: duplicateCode, 413: payload },
      },
    },
    '/api/medicamentos/{id}': {
      parameters: [pathId],
      get: {
        tags: ['Medicamentos'], summary: 'Consultar medicamento', description: 'Cualquier usuario autenticado; permite consultar medicamentos inactivos.', security: protectedAccess,
        responses: { 200: success(ref('Medicamento'), 'Medicamento consultado'), 400: invalidId, ...securedErrors, 404: medicineMissing },
      },
      put: {
        tags: ['Medicamentos'], summary: 'Actualizar medicamento', description: `${writer} Requiere todos los campos, incluido activo.`, security: protectedAccess, requestBody: body('ActualizarMedicamento'),
        responses: { 200: success(ref('Medicamento'), 'Medicamento actualizado'), 400: invalid('INVALID_ID, INVALID_INPUT'),
          ...securedErrors, 403: forbidden, 404: medicineMissing, 409: duplicateCode, 413: payload },
      },
    },
    '/api/medicamentos/{id}/estado': {
      parameters: [pathId],
      patch: {
        tags: ['Medicamentos'], summary: 'Activar o desactivar medicamento', description: writer, security: protectedAccess, requestBody: body('EstadoMedicamento'),
        responses: { 200: success(ref('Medicamento'), 'Estado actualizado'), 400: invalid('INVALID_ID, INVALID_INPUT'),
          ...securedErrors, 403: forbidden, 404: medicineMissing, 413: payload },
      },
    },
    '/api/disponibilidad': {
      get: {
        tags: ['Disponibilidad'], summary: 'Consultar disponibilidad informativa', security: protectedAccess,
        description: 'Solo ENCARGADO, DESPACHO y ADMINISTRADOR. Requiere los cuatro parámetros y rechaza parámetros adicionales. No reserva ni descuenta stock. Solo propone sucursales activas con existencia suficiente para un medicamento activo. Orden: prioridad ascendente, existencia descendente, id_sucursal ascendente. Sin candidatos devuelve 200, disponible=false y candidatos=[]. La venta debe revalidar stock al confirmarse. Cache-Control: no-store.',
        parameters: [parameter('id_medicamento', id, true), parameter('cantidad', id, true),
          parameter('departamento', text(50, 'Guatemala'), true), parameter('municipio', text(50, 'Guatemala'), true)],
        responses: {
          200: success(ref('Disponibilidad'), 'Disponibilidad informativa; no reserva stock. ETA básico del MVP'),
          400: error('INVALID_ID, INVALID_QUANTITY, INVALID_LOCATION o INVALID_INPUT.', 'INVALID_LOCATION', 'Departamento y municipio requieren texto no vacío de hasta 50 bytes'),
          ...deliveryErrors, 404: medicineMissing,
          409: error('Medicamento inactivo.', 'MEDICAMENTO_INACTIVE', 'Medicamento inactivo'),
        },
      },
    },
    '/api/entregas': {
      get: {
        tags: ['Entregas'], summary: 'Listar entregas', security: protectedAccess,
        description: `${reader} Filtros opcionales; se rechazan filtros adicionales. Ubicación compara texto sin distinguir mayúsculas y tras trim. Orden: fecha_solicitud e id_entrega descendentes. Sin paginación.`,
        parameters: [parameter('id_sucursal', id), parameter('id_venta', id), parameter('estado', estado),
          parameter('departamento', text(50, 'Guatemala')), parameter('municipio', text(50, 'Guatemala'))],
        responses: { 200: success(array('Entrega'), 'Entregas consultadas'), ...deliveryErrors,
          400: error('INVALID_ID, INVALID_INPUT, INVALID_DELIVERY_STATE, INVALID_DEPARTMENT o INVALID_MUNICIPALITY.', 'INVALID_ID', 'Identificador inválido') },
      },
      post: {
        tags: ['Entregas'], summary: 'Crear entrega para una venta confirmada', security: protectedAccess, requestBody: body('CrearEntrega'),
        description: 'Solo ENCARGADO con sucursal asignada. La venta debe estar CONFIRMADA y pertenecer a su sucursal activa. Máximo una entrega por venta, incluso si fue cancelada. id_sucursal se obtiene de la venta; estado inicial CREADA y ETA calculado por el servidor. No enviar estado, id_sucursal ni tiempo_estimado. Registra auditoría; no descuenta inventario.',
        responses: {
          201: success(ref('Entrega'), 'Entrega creada', '/api/entregas/1'), ...deliveryErrors,
          400: error('INVALID_INPUT, INVALID_ID, INVALID_CLIENT_NAME, INVALID_PHONE, INVALID_ADDRESS, INVALID_DEPARTMENT, INVALID_MUNICIPALITY, INVALID_OBSERVATIONS o INVALID_JSON.', 'INVALID_ID', 'Identificador inválido'),
          404: error('VENTA_NOT_FOUND, SUCURSAL_NOT_FOUND o ENTREGA_NOT_FOUND.', 'VENTA_NOT_FOUND', 'Venta inexistente'),
          409: error('INVALID_SALE_STATE, DELIVERY_ALREADY_EXISTS o SUCURSAL_INACTIVE.', 'INVALID_SALE_STATE', 'La entrega requiere una venta CONFIRMADA'), 413: payload,
        },
      },
    },
    '/api/entregas/{id}': {
      parameters: [pathId],
      get: {
        tags: ['Entregas'], summary: 'Consultar entrega', description: reader, security: protectedAccess,
        responses: { 200: success(ref('Entrega'), 'Entrega consultada'), ...deliveryErrors,
          400: error('Identificador inválido.', 'INVALID_ID', 'Identificador inválido'), 404: deliveryMissing },
      },
    },
    '/api/entregas/{id}/estado': {
      parameters: [pathId],
      put: {
        tags: ['Entregas'], summary: 'Cambiar estado de entrega', security: protectedAccess, requestBody: body('EstadoEntrega'),
        description: 'ENCARGADO (solo su sucursal): CREADA → ASIGNADA, ASIGNADA → PREPARADA y cancelación desde CREADA, ASIGNADA o PREPARADA. DESPACHO: PREPARADA → EN_RUTA y EN_RUTA → ENTREGADA. ADMINISTRADOR no puede cambiar estados. ENTREGADA y CANCELADA son finales; repetir el estado devuelve 409. ENTREGADA registra fecha_entrega. Registra auditoría; cancelar la logística no anula la venta ni revierte inventario.',
        responses: {
          200: success(ref('Entrega'), 'Estado de entrega actualizado'), ...deliveryErrors,
          400: error('INVALID_ID, INVALID_INPUT, INVALID_DELIVERY_STATE o INVALID_JSON.', 'INVALID_DELIVERY_STATE', 'Estado de entrega inválido'),
          404: deliveryMissing, 409: error('INVALID_DELIVERY_TRANSITION o ENTREGA_CONFLICT.', 'INVALID_DELIVERY_TRANSITION', 'Transición de entrega no permitida'), 413: payload,
        },
      },
    },
  },
};
