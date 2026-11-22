import LocationFields from '../../components/LocationFields'

export default function AvailabilityView({ values, setValues, result, busy, error, onConsult }) {
  return <>
    <h1 className="h4 mb-3">Disponibilidad</h1>
    <p>Consulta informativa: no reserva inventario. La existencia se revalida al confirmar la venta.</p>
    <form className="mb-4" onSubmit={onConsult} aria-busy={busy}><fieldset disabled={busy}><legend className="h6">Medicamento y destino</legend><div className="row g-3">
      {['id_medicamento', 'cantidad'].map((field, i) => <div className="col-md-6" key={field}><label className="form-label" htmlFor={`availability-${field}`}>{i === 0 ? 'Medicamento (ID)' : 'Cantidad solicitada'}</label><input id={`availability-${field}`} className="form-control" type="number" min="1" max="9999999999" step="1" required value={values[field]} onChange={event => setValues({ ...values, [field]: event.target.value })} /></div>)}
      <LocationFields values={values} onChange={setValues} prefix="availability" destination />
    </div><button className="btn btn-primary mt-3" type="submit">{busy ? 'Consultando…' : error ? 'Reintentar consulta' : 'Consultar disponibilidad'}</button></fieldset></form>
    {busy && <p role="status">Consultando disponibilidad…</p>}
    {error && <p className="alert alert-danger" role="alert">{error.message}{error.code && ` (${error.code})`}</p>}
    {result && <section aria-label="Resultado de disponibilidad">
      <h2 className="h5">Medicamento {result.data.id_medicamento} — {result.data.cantidad} unidades</h2>
      <p>Destino consultado: {result.destination.departamento}, {result.destination.municipio}.</p>
      <p className={`alert ${result.data.disponible ? 'alert-success' : 'alert-secondary'}`} role="status">{result.data.disponible ? 'Hay sucursales con existencia suficiente.' : 'No hay sucursales candidatas con existencia suficiente.'}</p>
      <p className="text-body-secondary">La consulta no confirma la viabilidad logística de entrega. El tiempo estimado es básico; cuando no está disponible, se muestra sin estimación.</p>
      {result.data.candidatos.length > 0 && <div className="table-responsive" tabIndex={0} role="region" aria-label="Sucursales candidatas"><table className="table table-bordered table-hover align-middle caption-top"><caption>Alternativas en el orden devuelto por el servidor</caption><thead className="table-light"><tr>{['Sucursal', 'Tipo', 'Departamento', 'Municipio', 'Existencia', 'Cantidad solicitada', 'Prioridad', 'Tiempo estimado disponible', 'Tiempo estimado de entrega', 'Formas de pago'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{result.data.candidatos.map(row => <tr key={row.id_sucursal}><td>{row.nombre} ({row.id_sucursal})</td><td>{row.tipo_sucursal}</td><td>{row.departamento}</td><td>{row.municipio}</td><td>{row.existencia}</td><td>{row.cantidad_solicitada}</td><td>{row.prioridad}</td><td>{row.eta_disponible ? 'Sí' : 'No'}</td><td>{row.tiempo_estimado == null ? 'Sin estimación' : `${row.tiempo_estimado} min`}</td><td>{row.formas_pago.join(', ')}</td></tr>)}</tbody>
      </table></div>}
    </section>}
  </>
}
