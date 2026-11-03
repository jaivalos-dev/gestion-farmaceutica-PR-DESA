import CatalogManager from '../../components/CatalogManager'
import { medicineFields, toMedicinePayload } from '../catalogForms'

const columns = [
  ['id_medicamento', 'ID'], ['codigo', 'Código'], ['nombre', 'Nombre'],
  ['categoria', 'Categoría'], ['presentacion', 'Presentación'],
  ['precio', 'Precio', value => typeof value === 'number' ? value.toFixed(2) : value],
  ['activo', 'Activo', value => value === 'S' ? <span className="badge bg-success-subtle text-success-emphasis">Activo</span> : value === 'N' ? <span className="badge bg-secondary-subtle text-secondary-emphasis">Inactivo</span> : value],
]
export default function MedicamentosPage() {
  return <CatalogManager endpoint="/api/medicamentos" title="Medicamentos" columns={columns} idField="id_medicamento" writePermission="medicamentos.write" fields={medicineFields} toPayload={toMedicinePayload} />
}
