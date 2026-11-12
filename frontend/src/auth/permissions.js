// Permisos visuales: la API sigue validando autorización y contexto de sucursal.
// null significa cualquier usuario autenticado; no concede escritura.
export const permissions = {
  'sucursales.read': null,
  'sucursales.write': ['ADMINISTRADOR'],
  'medicamentos.read': null,
  'medicamentos.write': ['ADMINISTRADOR', 'ENCARGADO'],
  'inventario.read': ['ADMINISTRADOR', 'ENCARGADO', 'AUDITOR'],
  'inventario.adjust': ['ADMINISTRADOR', 'ENCARGADO'],
  'transferencias.read': ['ENCARGADO'],
  'transferencias.act': ['ENCARGADO'],
  'ventas.read': ['ENCARGADO'],
  'ventas.act': ['ENCARGADO'],
  'caja.read': ['ENCARGADO', 'AUDITOR'],
  'caja.create': ['ENCARGADO'],
  'activos.read': ['ADMINISTRADOR', 'AUDITOR'],
  'activos.write': ['ADMINISTRADOR'],
  'planilla.read': ['ADMINISTRADOR', 'AUDITOR'],
  'planilla.write': ['ADMINISTRADOR'],
  'entregas.read': ['ADMINISTRADOR', 'ENCARGADO', 'DESPACHO'],
  'entregas.create': ['ENCARGADO'],
  'entregas.changeState': ['ENCARGADO', 'DESPACHO'],
  'disponibilidad.read': ['ADMINISTRADOR', 'ENCARGADO', 'DESPACHO'],
  'auditoria.read': ['ADMINISTRADOR', 'AUDITOR'],
  'dashboard.read': ['ADMINISTRADOR', 'AUDITOR'],
}

export function hasRole(user, roles) {
  return Boolean(user && roles.includes(user.nombre_rol))
}

export function hasPermission(user, permission) {
  if (!user || !Object.hasOwn(permissions, permission)) return false
  const roles = permissions[permission]
  return roles === null || hasRole(user, roles)
}
