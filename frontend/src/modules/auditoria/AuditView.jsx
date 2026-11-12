import { auditCatalogs, auditColumns, auditFilters, auditText } from './audit'

function cell(row, field) {
  const safe = auditText(row[field])
  if (field !== 'fecha_hora' || safe === '—' || safe === 'Contenido sensible oculto') return safe
  const date = new Date(safe)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('es-GT') : '—'
}

export default function AuditView({ draft, setDraft, result, error, onConsult, onRetry }) {
  function changeFilter(field, value) {
    const next = { ...draft, [field]: value }
    if (field === 'entidad' && value === '') next.id_entidad = ''
    setDraft(next)
  }

  return <>
    <h1 className="h4 mb-3">Auditoría</h1>
    <p className="text-body-secondary">Consulta de eventos registrados. Las fechas incluyen el día completo; deje filtros vacíos para consultar todos los eventos permitidos.</p>
    <form className="mb-4" onSubmit={onConsult}>
      <fieldset><legend className="h6">Filtros</legend><div className="row g-3">
        {auditFilters.map(([field, label, type]) => <div className="col-md-4" key={field}>
          <label className="form-label" htmlFor={`audit-${field}`}>{label}</label>
          {type === 'select' ? <select className="form-select" id={`audit-${field}`} value={draft[field]} onChange={event => changeFilter(field, event.target.value)}>
            <option value="">Todos</option>{auditCatalogs[field].map(value => <option key={value}>{value}</option>)}
          </select> : <input className="form-control" id={`audit-${field}`} type={type} min={type === 'number' ? '1' : '0001-01-01'} max={type === 'number' ? '9999999999' : '9999-12-31'} step={type === 'number' ? '1' : undefined} disabled={field === 'id_entidad' && draft.entidad === ''} value={draft[field]} onChange={event => setDraft({ ...draft, [field]: event.target.value })} />}
        </div>)}
      </div>
      <p className="form-text mt-3">Use Tipo de registro junto con ID del registro para identificar un registro específico.</p>
      <button className="btn btn-outline-primary mt-3" type="submit">Consultar</button></fieldset>
    </form>
    {error && <p className="alert alert-danger" role="alert">{auditText(error.message)}</p>}
    {result.loading ? <p role="status">Cargando eventos de auditoría…</p> : result.error ? <>
      <p className="alert alert-danger" role="alert">{auditText(result.error.message)}{result.error.code && ` (${auditText(result.error.code)})`}</p>
      <button className="btn btn-outline-primary" type="button" onClick={onRetry}>Reintentar consulta</button>
    </> : result.rows.length === 0 ? <p className="alert alert-secondary" role="status">No hay eventos de auditoría para la consulta.</p> :
      <div className="table-responsive" tabIndex={0} role="region" aria-label="Listado de auditoría"><table className="table table-bordered table-hover align-middle caption-top"><caption>Eventos de auditoría</caption>
        <thead className="table-light"><tr>{auditColumns.map(([field, label]) => <th scope="col" key={field}>{label}</th>)}</tr></thead>
        <tbody>{result.rows.map((row, index) => <tr key={typeof row.id_auditoria === 'number' ? row.id_auditoria : index}>{auditColumns.map(([field]) => <td key={field}>{cell(row, field)}</td>)}</tr>)}</tbody>
      </table></div>}
  </>
}
