import CatalogManager from '../../components/CatalogManager'
import { branchFields, toBranchPayload } from '../catalogForms'

const columns = [
  ['id_sucursal', 'ID'], ['nombre', 'Nombre'], ['tipo_sucursal', 'Tipo'],
  ['departamento', 'Departamento'], ['municipio', 'Municipio'], ['direccion', 'Dirección'],
  ['activa', 'Activa', value => value === 'S' ? <span className="badge bg-success-subtle text-success-emphasis">Activa</span> : value === 'N' ? <span className="badge bg-secondary-subtle text-secondary-emphasis">Inactiva</span> : value],
]
export default function SucursalesPage() {
  return <CatalogManager endpoint="/api/sucursales" title="Sucursales" columns={columns} idField="id_sucursal" writePermission="sucursales.write" fields={branchFields} toPayload={toBranchPayload} />
}
