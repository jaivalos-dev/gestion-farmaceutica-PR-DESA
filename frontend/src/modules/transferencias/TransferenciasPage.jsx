import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { hasPermission } from '../../auth/permissions'
import { actionLabels, availableActions, createTransfersApi, transferPath, transferStates } from './transfers'
import TransferForm from './TransferForm'

const emptyFilters = { estado: '', id_sucursal_origen: '', id_sucursal_destino: '' }
const loadingResult = { loading: true, rows: [], error: null }
const columns = [['id_transferencia', 'ID'], ['origen', 'Origen'], ['destino', 'Destino'], ['usuario', 'Usuario'], ['fecha', 'Fecha'], ['estado', 'Estado'], ['observacion', 'Observación']]

export default function TransferenciasPage() {
  const { session, request } = useAuth()
  const user = session.user
  const api = useMemo(() => createTransfersApi(request), [request])
  const [draft, setDraft] = useState(emptyFilters)
  const [filters, setFilters] = useState(emptyFilters)
  const [result, setResult] = useState(loadingResult)
  const [retry, setRetry] = useState(0)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState('')
  const [detail, setDetail] = useState(null)
  const locked = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    api.list(filters, controller.signal).then(rows => {
      if (!controller.signal.aborted) setResult({ loading: false, rows, error: null })
    }).catch(failure => {
      if (!controller.signal.aborted) setResult({ loading: false, rows: [], error: failure })
    })
    return () => controller.abort()
  }, [api, filters, retry])

  function consult(event) {
    event.preventDefault()
    try {
      transferPath(draft)
      setError(null)
      setDetail(null)
      setResult(loadingResult)
      setFilters({ ...draft })
    } catch (failure) { setError(failure) }
  }

  async function save(operation) {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setError(null)
    setNotice('')
    try {
      const updated = await operation()
      if (!updated) return
      setCreating(false)
      setDetail(null)
      setNotice(`Transferencia ${updated.record.id_transferencia}: ${updated.record.estado}. Operación realizada correctamente.`)
      setResult({ loading: false, rows: updated.rows, error: updated.refreshError })
    } catch (failure) { setError(failure) } finally {
      locked.current = false
      setBusy(false)
    }
  }

  async function showDetail(row) {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setError(null)
    setDetail(null)
    try {
      const data = await request(`/api/transferencias/${row.id_transferencia}`)
      if (!Array.isArray(data.detalles)) throw new Error('Detalle de transferencia no válido.')
      setDetail(data)
    } catch (failure) { setError(failure) } finally { locked.current = false; setBusy(false) }
  }

  return <>
    <div className="d-flex justify-content-between align-items-center gap-3 mb-3">
      <h1 className="h4 mb-0">Transferencias</h1>
      {hasPermission(user, 'transferencias.act') && <button className="btn btn-primary" type="button" disabled={busy || creating || result.loading || !user.id_sucursal} onClick={() => { setCreating(true); setDetail(null); setError(null); setNotice('') }}>Nueva transferencia</button>}
    </div>
    <p className="text-body-secondary">{user.id_sucursal ? `Se muestran transferencias con origen o destino en su sucursal (${user.id_sucursal}).` : 'Su usuario requiere una sucursal asignada para operar.'}</p>
    {notice && <p className="alert alert-success" role="status">{notice}</p>}
    {error && <p className="alert alert-danger" role="alert">{error.message}{error.code && ` (${error.code})`}</p>}
    {busy && <p role="status">Procesando solicitud…</p>}
    <form className="mb-4" onSubmit={consult}>
      <fieldset disabled={busy || creating}>
        <legend className="h6">Filtros</legend>
        <div className="row g-3">
          <div className="col-md-4"><label className="form-label" htmlFor="transfer-state">Estado</label><select id="transfer-state" className="form-select" value={draft.estado} onChange={event => setDraft({ ...draft, estado: event.target.value })}><option value="">Todos</option>{transferStates.map(state => <option key={state}>{state}</option>)}</select></div>
          {['id_sucursal_origen', 'id_sucursal_destino'].map((field, index) => <div className="col-md-4" key={field}><label className="form-label" htmlFor={`filter-${field}`}>ID de sucursal {index === 0 ? 'origen' : 'destino'} (opcional)</label><input id={`filter-${field}`} className="form-control" type="number" min="1" max="9999999999" step="1" value={draft[field]} onChange={event => setDraft({ ...draft, [field]: event.target.value })} /></div>)}
        </div>
        <button type="submit" className="btn btn-outline-primary mt-3">Consultar</button>
      </fieldset>
    </form>
    {creating && hasPermission(user, 'transferencias.act') && <TransferForm user={user} request={request} saving={busy}
      onSave={(values, catalogs) => save(() => api.create(values, user, catalogs, filters))}
      onCancel={() => { setCreating(false); setError(null) }} />}
    {detail && <section className="card card-body mb-4" aria-label="Detalle de transferencia">
      <h2 className="h5">Transferencia {detail.id_transferencia} — {detail.estado}</h2>
      <p>{detail.origen} → {detail.destino}</p>
      <ul>{detail.detalles.map(item => <li key={item.id_detalle}>{item.codigo} — {item.medicamento}: {item.cantidad} unidades</li>)}</ul>
      <div><button className="btn btn-outline-secondary" type="button" disabled={busy} onClick={() => setDetail(null)}>Cerrar detalle</button></div>
    </section>}
    {result.loading ? <p role="status">Cargando transferencias…</p> : result.error ? <>
      <p className="alert alert-danger" role="alert">{result.error.message}{result.error.code && ` (${result.error.code})`}</p>
      <button className="btn btn-outline-primary" type="button" disabled={busy || creating} onClick={() => { setResult(loadingResult); setRetry(value => value + 1) }}>Reintentar consulta</button>
    </> : result.rows.length === 0 ? <p className="alert alert-secondary" role="status">No hay transferencias para los filtros seleccionados.</p> :
      <div className="table-responsive" tabIndex={0} role="region" aria-label="Listado de transferencias">
        <table className="table table-bordered table-hover align-middle caption-top"><caption>Transferencias de su sucursal</caption>
          <thead className="table-light"><tr>{columns.map(([field, label]) => <th scope="col" key={field}>{label}</th>)}<th scope="col">Acciones</th></tr></thead>
          <tbody>{result.rows.map(row => <tr key={row.id_transferencia}>
            {columns.map(([field]) => <td key={field}>{row[field] == null ? '—' : field === 'fecha' ? new Date(row[field]).toLocaleString('es-GT') : row[field]}</td>)}
            <td><div className="d-flex flex-wrap gap-2">
              <button className="btn btn-outline-secondary btn-sm" type="button" disabled={busy || creating} onClick={() => showDetail(row)}>Ver detalle</button>
              {availableActions(row, user).map(action => <button key={action} className={`btn btn-sm ${action === 'cancelar' ? 'btn-outline-danger' : 'btn-outline-primary'}`} type="button" disabled={busy || creating}
                onClick={() => save(() => api.transition(row, action, user, filters))}>{actionLabels[action]}</button>)}
            </div></td>
          </tr>)}</tbody>
        </table>
      </div>}
  </>
}
