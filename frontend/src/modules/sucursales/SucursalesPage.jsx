import CatalogTable from '../../components/CatalogTable'

const columns = [
  ['id_sucursal', 'ID'], ['nombre', 'Nombre'], ['tipo_sucursal', 'Tipo'],
  ['departamento', 'Departamento'], ['municipio', 'Municipio'], ['direccion', 'Dirección'],
  ['activa', 'Activa', value => value === 'S' ? <span className="badge bg-success-subtle text-success-emphasis">Activa</span> : value === 'N' ? <span className="badge bg-secondary-subtle text-secondary-emphasis">Inactiva</span> : value],
]
export default function SucursalesPage() {
  return <><h1 className="h4 mb-3">Sucursales</h1><CatalogTable endpoint="/api/sucursales" title="Sucursales" columns={columns} idField="id_sucursal" /></>
}
