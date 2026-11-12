import { useEffect, useState } from 'react'

export default function TransferForm({ user, request, saving, onSave, onCancel }) {
  const [catalogs, setCatalogs] = useState({ loading: true, branches: [], medicines: [], error: null })
  const [retry, setRetry] = useState(0)
  const [values, setValues] = useState({ id_sucursal_origen: String(user.id_sucursal ?? ''), id_sucursal_destino: '', observacion: '', detalles: [{ id_medicamento: '', cantidad: '' }] })
  useEffect(() => {
    const controller = new AbortController()
    Promise.all([request('/api/sucursales', { signal: controller.signal }), request('/api/medicamentos', { signal: controller.signal })])
      .then(([branches, medicines]) => {
        if (!Array.isArray(branches) || !Array.isArray(medicines)) throw new Error('Catálogos no válidos.')
        if (!controller.signal.aborted) setCatalogs({ loading: false, branches, medicines, error: null })
      }).catch(error => { if (!controller.signal.aborted) setCatalogs({ loading: false, branches: [], medicines: [], error }) })
    return () => controller.abort()
  }, [request, retry])

  function updateDetail(index, field, value) {
    setValues(current => ({ ...current, detalles: current.detalles.map((detail, i) => i === index ? { ...detail, [field]: value } : detail) }))
  }
  const origin = catalogs.branches.find(branch => branch.id_sucursal === user.id_sucursal)
  return <form className="card card-body mb-4" aria-busy={saving || catalogs.loading} onSubmit={event => { event.preventDefault(); onSave(values, catalogs) }}>
    <h2 className="h5">Nueva transferencia</h2>
    {catalogs.loading && <p role="status">Cargando sucursales y medicamentos…</p>}
    {catalogs.error && <div className="alert alert-danger" role="alert">{catalogs.error.message} {catalogs.error.code}
      <button type="button" className="btn btn-outline-danger ms-2" onClick={() => { setCatalogs({ ...catalogs, loading: true, error: null }); setRetry(value => value + 1) }}>Reintentar catálogos</button></div>}
    {!catalogs.loading && !catalogs.error && origin?.activa !== 'S' && <p className="alert alert-warning">Su sucursal debe existir y estar activa para crear una transferencia.</p>}
    <fieldset disabled={saving || catalogs.loading || Boolean(catalogs.error) || origin?.activa !== 'S'}>
      <div className="row g-3">
        <div className="col-md-6"><label className="form-label" htmlFor="transfer-origin">Sucursal origen</label><input id="transfer-origin" className="form-control" readOnly value={`${user.id_sucursal ?? ''} — ${origin?.nombre ?? 'Sucursal asignada'}`} /></div>
        <div className="col-md-6"><label className="form-label" htmlFor="transfer-destination">Sucursal destino</label>
          <select id="transfer-destination" className="form-select" required value={values.id_sucursal_destino} onChange={event => setValues({ ...values, id_sucursal_destino: event.target.value })}>
            <option value="">Seleccione una sucursal</option>{catalogs.branches.filter(branch => branch.activa === 'S' && branch.id_sucursal !== user.id_sucursal).map(branch => <option key={branch.id_sucursal} value={branch.id_sucursal}>{branch.nombre} ({branch.id_sucursal})</option>)}
          </select></div>
        <div className="col-12"><label className="form-label" htmlFor="transfer-note">Observación (opcional)</label><textarea id="transfer-note" className="form-control" maxLength={250} value={values.observacion} onChange={event => setValues({ ...values, observacion: event.target.value })} /></div>
      </div>
      <h3 className="h6 mt-3">Medicamentos</h3>
      {values.detalles.map((detail, index) => <div className="row g-2 mb-2" key={index}>
        <div className="col-md-7"><label htmlFor={`transfer-med-${index}`} className="form-label">Medicamento {index + 1}</label>
          <select id={`transfer-med-${index}`} className="form-select" required value={detail.id_medicamento} onChange={event => updateDetail(index, 'id_medicamento', event.target.value)}>
            <option value="">Seleccione un medicamento</option>{catalogs.medicines.filter(medicine => medicine.activo === 'S').map(medicine => <option key={medicine.id_medicamento} value={medicine.id_medicamento} disabled={values.detalles.some((other, i) => i !== index && Number(other.id_medicamento) === medicine.id_medicamento)}>{medicine.codigo} — {medicine.nombre}</option>)}
          </select></div>
        <div className="col-md-3"><label htmlFor={`transfer-qty-${index}`} className="form-label">Cantidad</label><input id={`transfer-qty-${index}`} className="form-control" type="number" min="1" max="9999999999" step="1" required value={detail.cantidad} onChange={event => updateDetail(index, 'cantidad', event.target.value)} /></div>
        <div className="col-md-2 d-flex align-items-end"><button type="button" className="btn btn-outline-secondary" disabled={values.detalles.length === 1} onClick={() => setValues({ ...values, detalles: values.detalles.filter((_, i) => i !== index) })}>Quitar fila</button></div>
      </div>)}
      <button type="button" className="btn btn-outline-primary my-2" onClick={() => setValues({ ...values, detalles: [...values.detalles, { id_medicamento: '', cantidad: '' }] })}>Agregar medicamento</button>
      <div><button type="submit" className="btn btn-primary mt-2">{saving ? 'Guardando…' : 'Crear transferencia'}</button></div>
    </fieldset>
    <div><button type="button" className="btn btn-outline-secondary mt-2" disabled={saving} onClick={onCancel}>Cancelar formulario</button></div>
  </form>
}
