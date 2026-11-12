import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { hasPermission } from '../../auth/permissions'
import { canConfirm, createSalesApi } from './sales'
import SaleForm from './SaleForm'

const loadingResult = { loading: true, rows: [], error: null }
const columns = [['id_venta', 'ID'], ['fecha', 'Fecha'], ['forma_pago', 'Forma de pago'], ['total', 'Total'], ['estado', 'Estado'], ['id_usuario', 'Usuario (ID)']]
const money = value => Number(value).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function VentasPage() {
  const { session, request } = useAuth()
  const user = session.user
  const api = useMemo(() => createSalesApi(request), [request])
  const [result, setResult] = useState(loadingResult)
  const [retry, setRetry] = useState(0)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState('')
  const [detail, setDetail] = useState(null)
  const [pending, setPending] = useState(null)
  const locked = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    api.list(controller.signal).then(rows => {
      if (!controller.signal.aborted) setResult({ loading: false, rows, error: null })
    }).catch(failure => { if (!controller.signal.aborted) setResult({ loading: false, rows: [], error: failure }) })
    return () => controller.abort()
  }, [api, retry])

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
      setPending(null)
      setNotice(`Venta ${updated.record.id_venta}: ${updated.record.estado}. Operación realizada correctamente.`)
      setResult({ loading: false, rows: updated.rows, error: updated.listError })
      setDetail(updated.detail)
      setError(updated.detailError)
    } catch (failure) { setError(failure); setPending(null) } finally { locked.current = false; setBusy(false) }
  }

  async function showDetail(row) {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setError(null)
    setDetail(null)
    try { setDetail(await api.read(row.id_venta)) } catch (failure) { setError(failure) } finally { locked.current = false; setBusy(false) }
  }

  function confirmButton(row) {
    return canConfirm(row, user) && <button className="btn btn-outline-primary btn-sm" type="button" disabled={busy || creating || Boolean(pending) || result.loading} onClick={() => { setPending(row); setError(null); setNotice('') }}>Confirmar venta</button>
  }

  return <>
    <div className="d-flex justify-content-between align-items-center mb-3"><h1 className="h4 mb-0">Ventas</h1>
      {hasPermission(user, 'ventas.act') && <button className="btn btn-primary" type="button" disabled={busy || creating || Boolean(pending) || result.loading || !user.id_sucursal} onClick={() => { setCreating(true); setDetail(null); setError(null); setNotice('') }}>Nueva venta</button>}
    </div>
    <p className="text-body-secondary">{user.id_sucursal ? `Ventas de su sucursal (${user.id_sucursal}).` : 'Su usuario requiere una sucursal asignada para operar.'}</p>
    {notice && <p className="alert alert-success" role="status">{notice}</p>}
    {error && <p className="alert alert-danger" role="alert">{error.message}{error.code && ` (${error.code})`}</p>}
    {busy && <p role="status">Procesando solicitud…</p>}
    {creating && <SaleForm request={request} saving={busy} onSave={(values, medicines) => save(() => api.create(values, user, medicines))} onCancel={() => { setCreating(false); setError(null) }} />}
    {pending && <section className="alert alert-warning" role="region" aria-label="Confirmación de venta">
      <h2 className="h5">Confirmar venta {pending.id_venta}</h2>
      <p>Se confirmará el total registrado de {money(pending.total)}. Esta operación descontará inventario y registrará el ingreso en caja.</p>
      <div className="d-flex gap-2"><button type="button" className="btn btn-primary" disabled={busy} onClick={() => save(() => api.confirm(pending, user))}>Sí, confirmar venta</button><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={() => setPending(null)}>Volver</button></div>
    </section>}
    {detail && <section className="card card-body mb-4" aria-label="Detalle de venta">
      <h2 className="h5">Venta {detail.id_venta} — {detail.estado}</h2>
      <div className="table-responsive"><table className="table"><thead><tr>{['Medicamento', 'Código', 'Cantidad', 'Precio unitario', 'Subtotal'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{detail.detalles.map(item => <tr key={item.id_detalle}><td>{item.medicamento}</td><td>{item.codigo}</td><td>{item.cantidad}</td><td>{money(item.precio_unitario)}</td><td>{money(item.subtotal)}</td></tr>)}</tbody></table></div>
      <p><strong>Total de venta: {money(detail.total)}</strong></p>
      <div className="d-flex gap-2">{confirmButton(detail)}<button className="btn btn-outline-secondary btn-sm" type="button" disabled={busy || Boolean(pending)} onClick={() => setDetail(null)}>Cerrar detalle</button></div>
    </section>}
    {result.loading ? <p role="status">Cargando ventas…</p> : result.error ? <>
      <p className="alert alert-danger" role="alert">{result.error.message}{result.error.code && ` (${result.error.code})`}</p>
      <button type="button" className="btn btn-outline-primary" disabled={busy || creating || Boolean(pending)} onClick={() => { setResult(loadingResult); setRetry(value => value + 1) }}>Reintentar consulta</button>
    </> : result.rows.length === 0 ? <p role="status" className="alert alert-secondary">No hay ventas registradas.</p> : <div className="table-responsive" tabIndex={0} role="region" aria-label="Listado de ventas">
      <table className="table table-bordered table-hover align-middle caption-top"><caption>Ventas de su sucursal</caption><thead className="table-light"><tr>{columns.map(([field, label]) => <th scope="col" key={field}>{label}</th>)}<th scope="col">Acciones</th></tr></thead>
        <tbody>{result.rows.map(row => <tr key={row.id_venta}>{columns.map(([field]) => <td key={field}>{field === 'fecha' ? new Date(row[field]).toLocaleString('es-GT') : field === 'total' ? money(row[field]) : row[field]}</td>)}
          <td><div className="d-flex flex-wrap gap-2"><button className="btn btn-outline-secondary btn-sm" type="button" disabled={busy || creating || Boolean(pending)} onClick={() => showDetail(row)}>Ver detalle</button>{confirmButton(row)}</div></td>
        </tr>)}</tbody></table>
    </div>}
  </>
}
