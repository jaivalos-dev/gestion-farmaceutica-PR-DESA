import { validateLocation } from '../data/guatemalaLocations.js'

export const branchFields = [
  { name: 'nombre', label: 'Nombre', maxBytes: 100 },
  { name: 'tipo_sucursal', label: 'Tipo de sucursal', options: [['FARMACIA', 'Farmacia'], ['STAND', 'Stand']] },
  { name: 'departamento', location: true, label: 'Departamento', maxBytes: 50 },
  { name: 'municipio', location: true, label: 'Municipio', maxBytes: 50 },
  { name: 'direccion', label: 'Dirección', maxBytes: 200 },
  { name: 'activa', label: 'Estado', options: [['S', 'Activa'], ['N', 'Inactiva']] },
]

export const medicineFields = [
  { name: 'codigo', label: 'Código', maxBytes: 30 },
  { name: 'nombre', label: 'Nombre', maxBytes: 120 },
  { name: 'categoria', label: 'Categoría', maxBytes: 60 },
  { name: 'presentacion', label: 'Presentación', maxBytes: 80 },
  { name: 'precio', label: 'Precio', type: 'number' },
  { name: 'activo', label: 'Estado', options: [['S', 'Activo'], ['N', 'Inactivo']] },
]

function textPayload(values, fields) {
  const payload = {}
  for (const field of fields) {
    if (field.type === 'number') continue
    const value = typeof values[field.name] === 'string' ? values[field.name].trim() : ''
    if (!value) throw new Error(`${field.label} es obligatorio.`)
    if (field.maxBytes && new TextEncoder().encode(value).length > field.maxBytes) {
      throw new Error(`${field.label} admite hasta ${field.maxBytes} bytes; los caracteres acentuados pueden ocupar más de uno.`)
    }
    if (field.options && !field.options.some(([option]) => option === value)) {
      throw new Error(`${field.label}: seleccione una opción válida.`)
    }
    payload[field.name] = value
  }
  return payload
}

export function toBranchPayload(values) {
  const payload = textPayload(values, branchFields)
  validateLocation(payload)
  return payload
}

export function toMedicinePayload(values) {
  const payload = textPayload(values, medicineFields)
  const rawPrice = String(values.precio ?? '').trim()
  const precio = Number(rawPrice)
  if (!rawPrice || !Number.isFinite(precio) || precio < 0 || precio >= 99999999.995) {
    throw new Error('Precio debe ser un número mayor o igual a cero y menor que 99999999.995.')
  }
  // Oracle aplica el redondeo: conservar el valor introducido en la petición.
  return { ...payload, precio }
}
