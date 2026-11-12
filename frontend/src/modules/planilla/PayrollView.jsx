import { hasPermission } from '../../auth/permissions'

const columns = [['id_gasto', 'ID'], ['sucursal', 'Sucursal'], ['usuario', 'Usuario'], ['periodo', 'Período'], ['concepto', 'Concepto'], ['monto', 'Monto'], ['fecha_registro', 'Fecha de registro']]
const money = value => value.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function Failure({ error }) {
  return <p className="alert alert-danger" role="alert">{error.message}{error.code && ` (${error.code})`}</p>
}

function Fields({ values, update, filter = false }) {
  const prefix = filter ? 'payroll-filter' : 'payroll-form'
  return <div className="row g-3">
    <div className="col-md-4"><label className="form-label" htmlFor={`${prefix}-branch`}>ID de sucursal{filter && ' (opcional)'}</label><input id={`${prefix}-branch`} className="form-control" type="number" min="1" max="9999999999" step="1" required={!filter} value={values.id_sucursal} onChange={event => update({ ...values, id_sucursal: event.target.value })} /></div>
    <div className="col-md-4"><label className="form-label" htmlFor={`${prefix}-period`}>Período YYYY-MM{filter && ' (opcional)'}</label><input id={`${prefix}-period`} className="form-control" type="text" placeholder="YYYY-MM" maxLength={7} pattern="[0-9]{4}-(0[1-9]|1[0-2])" required={!filter} value={values.periodo} onChange={event => update({ ...values, periodo: event.target.value })} /></div>
    <div className="col-md-4"><label className="form-label" htmlFor={`${prefix}-concept`}>Concepto{filter && ' (solo listado, opcional)'}</label><input id={`${prefix}-concept`} className="form-control" maxLength={120} required={!filter} value={values.concepto} onChange={event => update({ ...values, concepto: event.target.value })} /></div>
    {!filter && <div className="col-md-4"><label className="form-label" htmlFor={`${prefix}-amount`}>Monto</label><input id={`${prefix}-amount`} className="form-control" type="number" min="0.01" max="9999999999.99" step="0.01" required value={values.monto} onChange={event => update({ ...values, monto: event.target.value })} /></div>}
  </div>
}

export default function PayrollView({ user, result, draft, filters, setDraft, form, setForm, busy, error, notice, onConsult, onNew, onSave, onCancel, onRetry }) {
  const canWrite = hasPermission(user, 'planilla.write')
  return <>
    <div className="d-flex justify-content-between align-items-center gap-3 mb-3"><h1 className="h4 mb-0">Planilla</h1>
      {canWrite && <button className="btn btn-primary" type="button" disabled={busy || form !== null || result.loading} onClick={onNew}>Registrar gasto</button>}
    </div>
    {notice && <p className="alert alert-success" role="status">{notice}</p>}
    {error && <Failure error={error} />}
    <form className="mb-4" onSubmit={onConsult}><fieldset disabled={busy || form !== null}>
      <legend className="h6">Filtros</legend><Fields values={draft} update={setDraft} filter />
      <button className="btn btn-outline-primary mt-3" type="submit">Consultar</button>
    </fieldset></form>
    {canWrite && form && <form className="card card-body mb-4" aria-label="Registro de gasto de planilla" aria-busy={busy} onSubmit={onSave}>
      <h2 className="h5">Registrar gasto de planilla</h2><fieldset disabled={busy}>
        <Fields values={form} update={setForm} />
        <div className="d-flex gap-2 mt-3"><button className="btn btn-primary" type="submit">{busy ? 'Guardando…' : 'Guardar gasto'}</button><button className="btn btn-outline-secondary" type="button" onClick={onCancel}>Cancelar</button></div>
      </fieldset>
    </form>}
    <section className="card card-body mb-4" aria-label="Resumen de planilla"><h2 className="h5">Resumen</h2>
      <p className="text-body-secondary">Sucursal: {filters.id_sucursal || 'Todas'}. Período: {filters.periodo || 'Todos'}. El filtro de concepto solo afecta al listado; no cambia este resumen.</p>
      {result.loading ? <p role="status">Cargando resumen…</p> : result.summaryError ? <Failure error={result.summaryError} /> : result.summary && <><p className="mb-1">Total: <strong>{money(result.summary.total)}</strong></p><p className="mb-0">Cantidad de registros: <strong>{result.summary.cantidad_registros}</strong></p></>}
    </section>
    {result.loading ? <p role="status">Cargando gastos de planilla…</p> : result.listError ? <Failure error={result.listError} /> : result.rows.length === 0 ? <p className="alert alert-secondary" role="status">No hay gastos de planilla para la consulta.</p> :
      <div className="table-responsive" tabIndex={0} role="region" aria-label="Listado de gastos de planilla"><table className="table table-bordered table-hover align-middle caption-top"><caption>Gastos de planilla</caption><thead className="table-light"><tr>{columns.map(([field, label]) => <th scope="col" key={field}>{label}</th>)}</tr></thead>
        <tbody>{result.rows.map(row => <tr key={row.id_gasto}>{columns.map(([field]) => <td key={field}>{row[field] == null ? '—' : field === 'fecha_registro' ? new Date(row[field]).toLocaleString('es-GT') : field === 'monto' ? money(row[field]) : row[field]}</td>)}</tr>)}</tbody>
      </table></div>}
    {!result.loading && (result.listError || result.summaryError) && <button className="btn btn-outline-primary mt-3" type="button" disabled={busy || form !== null} onClick={onRetry}>Reintentar consultas</button>}
  </>
}
