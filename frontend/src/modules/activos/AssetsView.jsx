import { hasPermission } from '../../auth/permissions'
import { assetStates, assetTextFields } from './assets'

const columns = [['id_activo', 'ID'], ['sucursal', 'Sucursal'], ['categoria', 'Categoría'], ['descripcion', 'Descripción'], ['valor', 'Valor'], ['estado', 'Estado'], ['responsable', 'Responsable'], ['fecha_registro', 'Fecha de registro']]

export default function AssetsView({ user, result, draft, setDraft, form, setForm, busy, error, notice, onConsult, onNew, onEdit, onSave, onCancel, onRetry }) {
  const canWrite = hasPermission(user, 'activos.write')
  return <>
    <div className="d-flex justify-content-between align-items-center gap-3 mb-3"><h1 className="h4 mb-0">Activos fijos</h1>
      {canWrite && <button className="btn btn-primary" type="button" disabled={busy || form !== null || result.loading} onClick={onNew}>Nuevo activo</button>}
    </div>
    {notice && <p className="alert alert-success" role="status">{notice}</p>}
    {error && <p className="alert alert-danger" role="alert">{error.message}{error.code && ` (${error.code})`}</p>}
    {busy && <p role="status">Procesando solicitud…</p>}
    <form className="mb-4" onSubmit={onConsult}><fieldset disabled={busy || form !== null}>
      <legend className="h6">Filtrar por sucursal</legend>
      <div className="row g-3"><div className="col-md-6"><label className="form-label" htmlFor="asset-filter-branch">ID de sucursal (opcional)</label><input id="asset-filter-branch" className="form-control" type="number" min="1" max="9999999999" step="1" value={draft.id_sucursal} onChange={event => setDraft({ id_sucursal: event.target.value })} /></div>
        <div className="col-md-6 d-flex align-items-end"><button className="btn btn-outline-primary" type="submit">Consultar</button></div></div>
    </fieldset></form>
    {canWrite && form && <form className="card card-body mb-4" aria-label="Formulario de activo" aria-busy={busy} onSubmit={onSave}>
      <h2 className="h5">{form.id === null ? 'Nuevo activo' : `Editar activo ${form.id}`}</h2>
      <p className="small text-body-secondary">Para dar de baja, seleccione BAJA. El registro se conserva. Al crear o cambiar de sucursal, el destino debe estar activo.</p>
      <fieldset disabled={busy}><div className="row g-3">
        <div className="col-md-6"><label className="form-label" htmlFor="asset-branch">ID de sucursal</label><input id="asset-branch" className="form-control" type="number" required min="1" max="9999999999" step="1" value={form.values.id_sucursal} onChange={event => setForm({ ...form, values: { ...form.values, id_sucursal: event.target.value } })} /></div>
        <div className="col-md-6"><label className="form-label" htmlFor="asset-value">Valor</label><input id="asset-value" className="form-control" type="number" required min="0" max="9999999999.99" step="0.01" value={form.values.valor} onChange={event => setForm({ ...form, values: { ...form.values, valor: event.target.value } })} /></div>
        {assetTextFields.map(([field, label, limit]) => <div className="col-md-6" key={field}><label className="form-label" htmlFor={`asset-${field}`}>{label}{field === 'responsable' && ' (opcional)'}</label><input id={`asset-${field}`} className="form-control" required={field !== 'responsable'} maxLength={limit} value={form.values[field]} onChange={event => setForm({ ...form, values: { ...form.values, [field]: event.target.value } })} /></div>)}
        <div className="col-md-6"><label className="form-label" htmlFor="asset-state">Estado</label><select id="asset-state" className="form-select" required value={form.values.estado} onChange={event => setForm({ ...form, values: { ...form.values, estado: event.target.value } })}>{assetStates.map(state => <option key={state}>{state}</option>)}</select></div>
      </div><div className="d-flex gap-2 mt-3"><button className="btn btn-primary" type="submit">Guardar activo</button><button className="btn btn-outline-secondary" type="button" onClick={onCancel}>Cancelar</button></div></fieldset>
    </form>}
    {result.loading ? <p role="status">Cargando activos…</p> : result.error ? <>
      <p className="alert alert-danger" role="alert">{result.error.message}{result.error.code && ` (${result.error.code})`}</p><button className="btn btn-outline-primary" type="button" disabled={busy || form !== null} onClick={onRetry}>Reintentar consulta</button>
    </> : result.rows.length === 0 ? <p className="alert alert-secondary" role="status">No hay activos para la consulta.</p> :
      <div className="table-responsive" tabIndex={0} role="region" aria-label="Listado de activos"><table className="table table-bordered table-hover align-middle caption-top"><caption>Activos fijos</caption>
        <thead className="table-light"><tr>{columns.map(([field, label]) => <th scope="col" key={field}>{label}</th>)}{canWrite && <th scope="col">Acciones</th>}</tr></thead>
        <tbody>{result.rows.map(row => <tr key={row.id_activo}>{columns.map(([field]) => <td key={field}>{row[field] == null ? '—' : field === 'fecha_registro' ? new Date(row[field]).toLocaleString('es-GT') : field === 'valor' ? Number(row[field]).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : row[field]}</td>)}
          {canWrite && <td><button className="btn btn-outline-primary btn-sm" type="button" disabled={busy || form !== null} onClick={() => onEdit(row)}>Editar</button></td>}
        </tr>)}</tbody></table></div>}
  </>
}
