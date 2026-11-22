import { departments, municipalitiesFor } from '../data/guatemalaLocations.js'

export default function LocationFields({ values, onChange, prefix, required = true, destination = false }) {
  const municipalities = municipalitiesFor(values.departamento)
  return <>
    {['departamento', 'municipio'].map(field => {
      const department = field === 'departamento'
      const options = department ? departments : municipalities
      const current = values[field] ?? ''
      const invalid = current !== '' && !options.includes(current)
      const id = `${prefix}-${field}`
      return <div className="col-md-6" key={field}>
        <label className="form-label" htmlFor={id}>{department ? 'Departamento' : 'Municipio'}{destination ? ' destino' : ''}</label>
        <select id={id} name={field} className="form-select" required={required}
          disabled={!department && municipalities.length === 0} value={invalid ? '' : current}
          aria-describedby={invalid ? `${id}-warning` : undefined}
          onChange={event => onChange(department
            ? { ...values, departamento: event.target.value, municipio: '' }
            : { ...values, municipio: event.target.value })}>
          <option value="">{required ? 'Seleccione…' : 'Todos'}</option>
          {options.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
        {invalid && <p id={`${id}-warning`} className="text-danger small">Valor actual fuera del catálogo: {current}. Seleccione una opción válida.</p>}
      </div>
    })}
  </>
}
