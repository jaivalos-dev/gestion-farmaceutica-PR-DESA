import { dashboardGroups, formatAmount, formatCount } from './dashboard'

export default function DashboardView({ draft, setDraft, result, onConsult, onRetry }) {
  return <>
    <h1 className="h4 mb-3">Resumen ejecutivo</h1>
    <p className="text-body-secondary">{result.id === '' ? 'Consolidado de todas las sucursales.' : `Resumen de la sucursal ${result.id}.`}</p>
    <form className="mb-4" onSubmit={onConsult}>
      <fieldset disabled={result.loading} className="row g-3 align-items-end">
        <div className="col-sm-6 col-lg-4">
          <label className="form-label" htmlFor="dashboard-branch">ID de sucursal (opcional)</label>
          <input className="form-control" id="dashboard-branch" inputMode="numeric" pattern="[1-9][0-9]{0,9}" maxLength={10}
            value={draft} onChange={event => setDraft(event.target.value)} aria-describedby="dashboard-filter-help" />
        </div>
        <div className="col-sm-auto"><button className="btn btn-outline-primary" type="submit" disabled={result.loading}>Consultar</button></div>
        <div id="dashboard-filter-help" className="form-text">Deje el ID vacío y consulte para volver al consolidado global.</div>
      </fieldset>
    </form>
    {result.loading ? <p role="status">Cargando resumen ejecutivo…</p> : result.error ? <>
      <p className="alert alert-danger" role="alert">{result.error.message}{result.error.code && ` (${result.error.code})`}</p>
      <button className="btn btn-outline-primary" type="button" onClick={onRetry}>Reintentar consulta</button>
    </> : result.data && <div className="row g-3">
      {dashboardGroups.map(([group, title, fields]) => <section className="col-md-6 col-xl-4" key={group} aria-labelledby={`dashboard-${group}`}>
        <div className="card h-100"><div className="card-body">
          <h2 className="h5 mb-3" id={`dashboard-${group}`}>{title}</h2>
          <dl className="mb-0">{fields.map(([field, label, amount]) => <div className="d-flex flex-wrap justify-content-between gap-2 border-top py-2" key={field}>
            <dt className="fw-normal text-body-secondary">{label}</dt>
            <dd className="fw-semibold mb-0">{amount ? formatAmount(result.data[group][field]) : formatCount(result.data[group][field])}</dd>
          </div>)}</dl>
        </div></div>
      </section>)}
    </div>}
  </>
}
