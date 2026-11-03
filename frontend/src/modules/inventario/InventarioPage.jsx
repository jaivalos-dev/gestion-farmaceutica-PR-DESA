import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { hasPermission, hasRole } from '../../auth/permissions'
import { createInventoryApi, inventoryPath } from './inventory'

const columns = [['id_inventario', 'ID'], ['sucursal', 'Sucursal'], ['medicamento', 'Medicamento'], ['codigo', 'Código'], ['existencia', 'Existencia'], ['fecha_actualizacion', 'Fecha de actualización']]
const initialResult = { loading: true, rows: [], error: null }

export default function InventarioPage() {
  const { session, request } = useAuth()
  const api = useMemo(() => createInventoryApi(request), [request])
  const scoped = hasRole(session.user, ['ENCARGADO'])
  const ownBranch = scoped ? String(session.user.id_sucursal ?? '') : ''
  const canAdjust = hasPermission(session.user, 'inventario.adjust')
  const [draft, setDraft] = useState({ id_sucursal: ownBranch, id_medicamento: '' })
  const [filters, setFilters] = useState(draft)
  const [result, setResult] = useState(initialResult)
  const [retry, setRetry] = useState(0)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState('')
  const activeLoad = useRef(null)
  const submitting = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    activeLoad.current = controller
    api.list(filters, controller.signal).then(rows => {
      if (!controller.signal.aborted) setResult({ loading: false, rows, error: null })
    }).catch(failure => {
      if (!controller.signal.aborted) setResult({ loading: false, rows: [], error: failure })
    })
    return () => controller.abort()
  }, [api, filters, retry])

  function applyFilters(event) {
    event.preventDefault()
    try {
      inventoryPath(draft)
      setError(null)
      setResult(initialResult)
      setFilters({ ...draft })
    } catch (failure) { setError(failure) }
  }

  async function submit(event) {
    event.preventDefault()
    if (!canAdjust || submitting.current) return
    submitting.current = true
    setSaving(true)
    setError(null)
    setNotice('')
    activeLoad.current?.abort()
    try {
      const updated = await api.adjust(form, filters)
      if (!updated) return
      setNotice(`Movimiento registrado. Nueva existencia: ${updated.movement.saldo_nuevo}.`)
      setForm(null)
      setResult({ loading: false, rows: updated.rows, error: updated.refreshError })
    } catch (failure) {
      setError(failure)
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  function idInput(field, label, values, update, required = false) {
    const id = `${required ? 'ajuste' : 'filtro'}-${field}`
    return <div className="col-12 col-md-4">
      <label className="form-label" htmlFor={id}>{label}</label>
      <input id={id} className="form-control" type="number" min="1" max="9999999999" step="1" required={required}
        readOnly={field === 'id_sucursal' && scoped} value={values[field]}
        onChange={event => update(current => ({ ...current, [field]: event.target.value }))} />
    </div>
  }

  return <>
    <div className="d-flex justify-content-between align-items-center gap-3 mb-3">
      <h1 className="h4 mb-0">Inventario</h1>
      {canAdjust && <button className="btn btn-primary" type="button" disabled={saving || form !== null || (scoped && !ownBranch) || result.loading}
        onClick={() => { setError(null); setNotice(''); setForm({ id_sucursal: draft.id_sucursal, id_medicamento: draft.id_medicamento, tipo_movimiento: 'ENTRADA', cantidad: '', referencia: '' }) }}>Ajustar inventario</button>}
    </div>
    {scoped && <p className="text-body-secondary">{ownBranch ? `Consulta y ajustes limitados a su sucursal (${ownBranch}).` : 'Su usuario no tiene sucursal asignada. La API requiere una sucursal para consultar y ajustar.'}</p>}
    {notice && <p className="alert alert-success" role="status">{notice}</p>}
    {error && <p className="alert alert-danger" role="alert">{error.message}{error.code && ` (${error.code})`}</p>}
    <form onSubmit={applyFilters} className="mb-4">
      <fieldset disabled={saving || form !== null}>
        <legend className="h6">Filtros (vacío: todos los registros permitidos)</legend>
        <div className="row g-3">
          {idInput('id_sucursal', 'ID de sucursal', draft, setDraft)}
          {idInput('id_medicamento', 'ID de medicamento', draft, setDraft)}
          <div className="col-12 col-md-4 d-flex align-items-end"><button className="btn btn-outline-primary" type="submit">Consultar</button></div>
        </div>
      </fieldset>
    </form>
    {canAdjust && form && <form onSubmit={submit} className="card card-body mb-4" aria-busy={saving}>
      <h2 className="h5">Ajustar inventario</h2>
      <p className="small text-body-secondary">Entrada y Ajuste suman unidades; Salida descuenta. Solo Entrada permite registrar inventario nuevo. La cantidad no es el saldo final.</p>
      <fieldset disabled={saving}>
        <div className="row g-3">
          {idInput('id_sucursal', 'ID de sucursal', form, setForm, true)}
          {idInput('id_medicamento', 'ID de medicamento', form, setForm, true)}
          <div className="col-12 col-md-4"><label htmlFor="tipo-movimiento" className="form-label">Tipo de movimiento</label>
            <select id="tipo-movimiento" className="form-select" value={form.tipo_movimiento} onChange={event => setForm({ ...form, tipo_movimiento: event.target.value })}>
              <option value="ENTRADA">Entrada</option><option value="SALIDA">Salida</option><option value="AJUSTE">Ajuste (incremento)</option>
            </select></div>
          {idInput('cantidad', 'Cantidad', form, setForm, true)}
          <div className="col-12 col-md-8"><label htmlFor="referencia" className="form-label">Referencia (obligatoria)</label>
            <input id="referencia" className="form-control" required maxLength={100} value={form.referencia} onChange={event => setForm({ ...form, referencia: event.target.value })} /></div>
        </div>
        <div className="d-flex gap-2 mt-3"><button className="btn btn-primary" type="submit">{saving ? 'Guardando…' : 'Guardar ajuste'}</button>
          <button className="btn btn-outline-secondary" type="button" onClick={() => { setForm(null); setError(null) }}>Cancelar</button></div>
      </fieldset>
    </form>}
    {result.loading ? <p role="status">Cargando inventario…</p> : result.error ? <>
      <p className="alert alert-danger" role="alert">{result.error.message}{result.error.code && ` (${result.error.code})`}</p>
      <button className="btn btn-outline-primary" disabled={saving || form !== null} onClick={() => { setResult(initialResult); setRetry(value => value + 1) }}>Reintentar consulta</button>
    </> : result.rows.length === 0 ? <p className="alert alert-secondary" role="status">No hay inventario para los filtros seleccionados.</p> :
      <div className="table-responsive" tabIndex={0} role="region" aria-label="Listado de inventario">
        <table className="table table-bordered table-hover align-middle caption-top">
          <caption>Inventario por sucursal y medicamento</caption>
          <thead className="table-light"><tr>{columns.map(([field, label]) => <th key={field} scope="col">{label}</th>)}</tr></thead>
          <tbody>{result.rows.map(row => <tr key={row.id_inventario}>{columns.map(([field]) => <td key={field}>{row[field] == null ? '—' : field === 'fecha_actualizacion' ? new Date(row[field]).toLocaleString('es-GT') : row[field]}</td>)}</tr>)}</tbody>
        </table>
      </div>}
  </>
}
