import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { hasPermission, hasRole } from '../../auth/permissions'
import { cashPath, cashTypes, createCashApi } from './cash'

const initialResult = { loading: true, rows: [], error: null }
const columns = [['id_mov_caja', 'ID'], ['id_sucursal', 'Sucursal (ID)'], ['id_usuario', 'Usuario (ID)'], ['id_venta', 'Venta asociada (ID)'], ['tipo', 'Tipo'], ['monto', 'Monto'], ['concepto', 'Concepto'], ['fecha', 'Fecha']]

function displayValue(row, field) {
  if (row[field] == null) return '—'
  if (field === 'fecha') return new Date(row[field]).toLocaleString('es-GT')
  if (field === 'monto') return Number(row[field]).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return row[field]
}

export default function CajaPage() {
  const { session, request } = useAuth()
  const user = session.user
  const scoped = hasRole(user, ['ENCARGADO'])
  const canCreate = hasPermission(user, 'caja.create')
  const api = useMemo(() => createCashApi(request), [request])
  const [draft, setDraft] = useState({ id_sucursal: scoped ? String(user.id_sucursal ?? '') : '' })
  const [filters, setFilters] = useState(draft)
  const [result, setResult] = useState(initialResult)
  const [retry, setRetry] = useState(0)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState('')
  const submitting = useRef(false)
  const activeLoad = useRef(null)

  useEffect(() => {
    const controller = new AbortController()
    activeLoad.current = controller
    api.list(filters, user, controller.signal).then(rows => {
      if (!controller.signal.aborted) setResult({ loading: false, rows, error: null })
    }).catch(failure => {
      if (!controller.signal.aborted) setResult({ loading: false, rows: [], error: failure })
    })
    return () => controller.abort()
  }, [api, filters, user, retry])

  function consult(event) {
    event.preventDefault()
    try {
      cashPath(draft, user)
      setError(null)
      setResult(initialResult)
      setFilters({ ...draft })
    } catch (failure) { setError(failure) }
  }

  async function submit(event) {
    event.preventDefault()
    if (!canCreate || submitting.current) return
    submitting.current = true
    setSaving(true)
    setError(null)
    setNotice('')
    activeLoad.current?.abort()
    try {
      const updated = await api.create(form, user, filters)
      if (!updated) return
      setNotice(`Movimiento ${updated.movement.id_mov_caja} registrado correctamente.`)
      setForm(null)
      setResult({ loading: false, rows: updated.rows, error: updated.refreshError })
    } catch (failure) { setError(failure) } finally { submitting.current = false; setSaving(false) }
  }

  return <>
    <div className="d-flex justify-content-between align-items-center gap-3 mb-3">
      <h1 className="h4 mb-0">Caja</h1>
      {canCreate && <button className="btn btn-primary" type="button" disabled={saving || form !== null || result.loading || !user.id_sucursal} onClick={() => { setForm({ tipo: '', monto: '', concepto: '' }); setError(null); setNotice('') }}>Registrar movimiento</button>}
    </div>
    <p className="text-body-secondary">{scoped ? user.id_sucursal ? `Consulta y registro limitados a su sucursal (${user.id_sucursal}).` : 'Su usuario requiere una sucursal asignada.' : 'Puede consultar todas las sucursales o filtrar por una sucursal.'}</p>
    <p className="small text-body-secondary">Los ingresos de ventas confirmadas se muestran automáticamente. Los movimientos registrados son de solo lectura.</p>
    {notice && <p className="alert alert-success" role="status">{notice}</p>}
    {error && <p className="alert alert-danger" role="alert">{error.message}{error.code && ` (${error.code})`}</p>}
    <form className="mb-4" onSubmit={consult}>
      <fieldset disabled={saving || form !== null}>
        <legend className="h6">Filtrar movimientos</legend>
        <div className="row g-3"><div className="col-md-6"><label className="form-label" htmlFor="cash-branch">ID de sucursal{!scoped && ' (opcional)'}</label>
          <input id="cash-branch" className="form-control" type="number" min="1" max="9999999999" step="1" readOnly={scoped} value={draft.id_sucursal} onChange={event => setDraft({ id_sucursal: event.target.value })} />
        </div><div className="col-md-6 d-flex align-items-end"><button className="btn btn-outline-primary" type="submit">Consultar</button></div></div>
      </fieldset>
    </form>
    {canCreate && form && <form className="card card-body mb-4" aria-label="Registro manual de caja" aria-busy={saving} onSubmit={submit}>
      <h2 className="h5">Registrar movimiento manual</h2>
      <p>Use este formulario para ingresos o egresos manuales. Los ingresos de ventas se registran al confirmar la venta.</p>
      <fieldset disabled={saving}>
        <div className="row g-3">
          <div className="col-md-6"><label className="form-label" htmlFor="cash-type">Tipo</label><select id="cash-type" className="form-select" required value={form.tipo} onChange={event => setForm({ ...form, tipo: event.target.value })}><option value="">Seleccione un tipo</option>{cashTypes.map(tipo => <option key={tipo}>{tipo}</option>)}</select></div>
          <div className="col-md-6"><label className="form-label" htmlFor="cash-amount">Monto</label><input id="cash-amount" className="form-control" type="number" min="0.01" max="9999999999.99" step="0.01" required value={form.monto} onChange={event => setForm({ ...form, monto: event.target.value })} /></div>
          <div className="col-12"><label className="form-label" htmlFor="cash-concept">Concepto</label><textarea id="cash-concept" className="form-control" required maxLength={200} aria-describedby="cash-concept-help" value={form.concepto} onChange={event => setForm({ ...form, concepto: event.target.value })} /><div id="cash-concept-help" className="form-text">Hasta 200 bytes UTF-8; los caracteres acentuados pueden ocupar más de un byte.</div></div>
        </div>
        <div className="d-flex gap-2 mt-3"><button className="btn btn-primary" type="submit">{saving ? 'Guardando…' : 'Guardar movimiento'}</button><button className="btn btn-outline-secondary" type="button" onClick={() => { setForm(null); setError(null) }}>Cancelar</button></div>
      </fieldset>
    </form>}
    {result.loading ? <p role="status">Cargando movimientos de caja…</p> : result.error ? <>
      <p className="alert alert-danger" role="alert">{result.error.message}{result.error.code && ` (${result.error.code})`}</p>
      <button className="btn btn-outline-primary" type="button" disabled={saving || form !== null} onClick={() => { setResult(initialResult); setRetry(value => value + 1) }}>Reintentar consulta</button>
    </> : result.rows.length === 0 ? <p className="alert alert-secondary" role="status">No hay movimientos de caja para la consulta.</p> :
      <div className="table-responsive" tabIndex={0} role="region" aria-label="Listado de movimientos de caja">
        <table className="table table-bordered table-hover align-middle caption-top"><caption>Movimientos de caja</caption><thead className="table-light"><tr>{columns.map(([field, label]) => <th scope="col" key={field}>{label}</th>)}</tr></thead>
          <tbody>{result.rows.map(row => <tr key={row.id_mov_caja}>{columns.map(([field]) => <td key={field}>{displayValue(row, field)}</td>)}</tr>)}</tbody>
        </table>
      </div>}
  </>
}
