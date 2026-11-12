import { hasPermission, hasRole } from '../../auth/permissions'
import { allowedDeliveryStates, deliveryFields, deliveryStates } from './deliveries'

const columns = [['id_entrega', 'ID'], ['id_sucursal', 'Sucursal (ID)'], ['id_venta', 'Venta (ID)'], ['nombre_cliente', 'Cliente'], ['direccion', 'Dirección'], ['municipio', 'Municipio'], ['estado', 'Estado'], ['tiempo_estimado', 'ETA (min)'], ['fecha_entrega', 'Fecha de entrega']]
const detailFields = [...columns, ['telefono', 'Teléfono'], ['departamento', 'Departamento'], ['fecha_solicitud', 'Fecha de solicitud'], ['observaciones', 'Observaciones']]

function value(row, field) {
  if (row[field] == null) return field === 'tiempo_estimado' ? 'No disponible' : '—'
  return field.startsWith('fecha_') ? new Date(row[field]).toLocaleString('es-GT') : row[field]
}

export default function DeliveriesView({ user, result, draft, setDraft, form, setForm, detail, pending, busy, error, notice, onConsult, onNew, onSave, onCancel, onDetail, onCloseDetail, onTransition, onConfirm, onDismiss, onRetry }) {
  const disabled = busy || form !== null || Boolean(pending)
  function actions(row) {
    return allowedDeliveryStates(row, user).map(state => <button className={`btn btn-sm ${state === 'CANCELADA' ? 'btn-outline-danger' : 'btn-outline-primary'}`} key={state} type="button" disabled={disabled || result.loading} onClick={() => onTransition(row, state)}>Pasar a {state}</button>)
  }
  return <>
    <div className="d-flex justify-content-between align-items-center gap-3 mb-3"><h1 className="h4 mb-0">Entregas</h1>
      {hasPermission(user, 'entregas.create') && <button className="btn btn-primary" type="button" disabled={disabled || result.loading || !user.id_sucursal} onClick={onNew}>Nueva entrega</button>}
    </div>
    <p className="text-body-secondary">{hasRole(user, ['ENCARGADO']) ? `Entregas de su sucursal (${user.id_sucursal ?? 'sin asignar'}).` : 'Consulta de entregas de todas las sucursales.'}</p>
    {notice && <p className="alert alert-success" role="status">{notice}</p>}
    {error && <p className="alert alert-danger" role="alert">{error.message}{error.code && ` (${error.code})`}</p>}
    {busy && <p role="status">Procesando solicitud…</p>}
    <form className="mb-4" onSubmit={onConsult}><fieldset disabled={disabled}><legend className="h6">Filtros</legend><div className="row g-3">
      {['id_sucursal', 'id_venta'].map((field, i) => <div className="col-md-4" key={field}><label className="form-label" htmlFor={`delivery-filter-${field}`}>{i === 0 ? 'Sucursal (ID)' : 'Venta (ID)'}</label><input className="form-control" id={`delivery-filter-${field}`} type="number" min="1" max="9999999999" step="1" readOnly={field === 'id_sucursal' && hasRole(user, ['ENCARGADO'])} value={draft[field]} onChange={event => setDraft({ ...draft, [field]: event.target.value })} /></div>)}
      <div className="col-md-4"><label className="form-label" htmlFor="delivery-filter-state">Estado</label><select className="form-select" id="delivery-filter-state" value={draft.estado} onChange={event => setDraft({ ...draft, estado: event.target.value })}><option value="">Todos</option>{deliveryStates.map(state => <option key={state}>{state}</option>)}</select></div>
      {['departamento', 'municipio'].map(field => <div className="col-md-6" key={field}><label className="form-label" htmlFor={`delivery-filter-${field}`}>{field === 'departamento' ? 'Departamento' : 'Municipio'}</label><input className="form-control" id={`delivery-filter-${field}`} maxLength={50} value={draft[field]} onChange={event => setDraft({ ...draft, [field]: event.target.value })} /></div>)}
    </div><button className="btn btn-outline-primary mt-3" type="submit">Consultar</button></fieldset></form>
    {hasPermission(user, 'entregas.create') && form && <form className="card card-body mb-4" aria-label="Nueva entrega" aria-busy={busy} onSubmit={onSave}>
      <h2 className="h5">Nueva entrega</h2><p>Ingrese una venta CONFIRMADA de su sucursal, sin entrega previa. Crear o cancelar una entrega no modifica el inventario ni anula la venta.</p>
      <fieldset disabled={busy}><div className="row g-3">
        <div className="col-md-6"><label className="form-label" htmlFor="delivery-sale">Venta (ID)</label><input id="delivery-sale" className="form-control" type="number" min="1" max="9999999999" step="1" required value={form.id_venta} onChange={event => setForm({ ...form, id_venta: event.target.value })} /></div>
        {deliveryFields.map(([field, label, limit]) => <div className="col-md-6" key={field}><label className="form-label" htmlFor={`delivery-${field}`}>{label}</label><input id={`delivery-${field}`} className="form-control" type={field === 'telefono' ? 'tel' : 'text'} required maxLength={limit} value={form[field]} onChange={event => setForm({ ...form, [field]: event.target.value })} /></div>)}
        <div className="col-12"><label className="form-label" htmlFor="delivery-notes">Observaciones (opcional)</label><textarea id="delivery-notes" className="form-control" maxLength={250} value={form.observaciones} onChange={event => setForm({ ...form, observaciones: event.target.value })} /></div>
      </div><div className="d-flex gap-2 mt-3"><button className="btn btn-primary" type="submit">Guardar entrega</button><button className="btn btn-outline-secondary" type="button" onClick={onCancel}>Cancelar formulario</button></div></fieldset>
    </form>}
    {pending && <section className="alert alert-warning" aria-label="Confirmar cambio de estado"><h2 className="h5">Entrega {pending.row.id_entrega}: {pending.row.estado} → {pending.state}</h2>
      {pending.state === 'CANCELADA' && <p>Cancelar la entrega no anula la venta ni devuelve inventario.</p>}
      <div className="d-flex gap-2"><button className="btn btn-primary" type="button" disabled={busy} onClick={onConfirm}>Confirmar cambio</button><button className="btn btn-outline-secondary" type="button" disabled={busy} onClick={onDismiss}>Volver</button></div>
    </section>}
    {detail && <section className="card card-body mb-4" aria-label="Detalle de entrega"><h2 className="h5">Entrega {detail.id_entrega}</h2><dl className="row">{detailFields.map(([field, label]) => <div className="col-md-6" key={field}><dt>{label}</dt><dd>{value(detail, field)}</dd></div>)}</dl>
      <div className="d-flex flex-wrap gap-2">{actions(detail)}<button className="btn btn-outline-secondary btn-sm" type="button" disabled={disabled} onClick={onCloseDetail}>Cerrar detalle</button></div>
    </section>}
    {result.loading ? <p role="status">Cargando entregas…</p> : result.error ? <>
      <p className="alert alert-danger" role="alert">{result.error.message}{result.error.code && ` (${result.error.code})`}</p><button className="btn btn-outline-primary" type="button" disabled={disabled} onClick={onRetry}>Reintentar consulta</button>
    </> : result.rows.length === 0 ? <p className="alert alert-secondary" role="status">No hay entregas para la consulta.</p> :
      <div className="table-responsive" tabIndex={0} role="region" aria-label="Listado de entregas"><table className="table table-bordered table-hover align-middle caption-top"><caption>Entregas</caption><thead className="table-light"><tr>{columns.map(([field, label]) => <th scope="col" key={field}>{label}</th>)}<th scope="col">Acciones</th></tr></thead>
        <tbody>{result.rows.map(row => <tr key={row.id_entrega}>{columns.map(([field]) => <td key={field}>{value(row, field)}</td>)}<td><div className="d-flex flex-wrap gap-2"><button className="btn btn-outline-secondary btn-sm" type="button" disabled={disabled} onClick={() => onDetail(row)}>Ver detalle</button>{actions(row)}</div></td></tr>)}</tbody>
      </table></div>}
  </>
}
