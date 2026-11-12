import { useEffect, useState } from 'react'
import { paymentMethods } from './sales'

export default function SaleForm({ request, saving, onSave, onCancel }) {
  const [catalog, setCatalog] = useState({ loading: true, medicines: [], error: null })
  const [retry, setRetry] = useState(0)
  const [values, setValues] = useState({ forma_pago: '', detalles: [{ id_medicamento: '', cantidad: '' }] })
  useEffect(() => {
    const controller = new AbortController()
    request('/api/medicamentos', { signal: controller.signal }).then(medicines => {
      if (!Array.isArray(medicines)) throw new Error('Catálogo de medicamentos no válido.')
      if (!controller.signal.aborted) setCatalog({ loading: false, medicines, error: null })
    }).catch(error => { if (!controller.signal.aborted) setCatalog({ loading: false, medicines: [], error }) })
    return () => controller.abort()
  }, [request, retry])

  function update(index, field, value) {
    setValues(current => ({ ...current, detalles: current.detalles.map((row, i) => i === index ? { ...row, [field]: value } : row) }))
  }
  const active = catalog.medicines.filter(medicine => medicine.activo === 'S')
  return <form className="card card-body mb-4" aria-label="Nueva venta" aria-busy={saving || catalog.loading} onSubmit={event => { event.preventDefault(); if (!saving && !catalog.loading && !catalog.error) onSave(values, catalog.medicines) }}>
    <h2 className="h5">Nueva venta</h2>
    <p>Los precios y el total serán determinados por el servidor al crear la venta.</p>
    {catalog.loading && <p role="status">Cargando medicamentos…</p>}
    {catalog.error && <div className="alert alert-danger" role="alert">{catalog.error.message} {catalog.error.code}
      <button className="btn btn-outline-danger ms-2" type="button" onClick={() => { setCatalog({ loading: true, medicines: [], error: null }); setRetry(value => value + 1) }}>Reintentar catálogo</button></div>}
    {!catalog.loading && !catalog.error && active.length === 0 && <p role="status">No hay medicamentos activos disponibles.</p>}
    <fieldset disabled={saving || catalog.loading || Boolean(catalog.error) || active.length === 0}>
      <label className="form-label" htmlFor="sale-payment">Forma de pago</label>
      <select id="sale-payment" className="form-select mb-3" required value={values.forma_pago} onChange={event => setValues({ ...values, forma_pago: event.target.value })}>
        <option value="">Seleccione una forma de pago</option>{paymentMethods.map(method => <option key={method}>{method}</option>)}
      </select>
      {values.detalles.map((row, index) => <div className="row g-3 mb-3" key={index}>
        <div className="col-md-7"><label className="form-label" htmlFor={`sale-medicine-${index}`}>Medicamento {index + 1}</label>
          <select id={`sale-medicine-${index}`} className="form-select" required value={row.id_medicamento} onChange={event => update(index, 'id_medicamento', event.target.value)}>
            <option value="">Seleccione un medicamento</option>{active.filter(medicine => !values.detalles.some((other, i) => i !== index && Number(other.id_medicamento) === medicine.id_medicamento)).map(medicine => <option key={medicine.id_medicamento} value={medicine.id_medicamento}>{medicine.codigo} — {medicine.nombre}</option>)}
          </select></div>
        <div className="col-md-3"><label className="form-label" htmlFor={`sale-quantity-${index}`}>Cantidad {index + 1}</label><input id={`sale-quantity-${index}`} className="form-control" type="number" required min="1" max="9999999999" step="1" value={row.cantidad} onChange={event => update(index, 'cantidad', event.target.value)} /></div>
        <div className="col-md-2 d-flex align-items-end"><button className="btn btn-outline-danger" type="button" aria-label={`Quitar medicamento ${index + 1}`} disabled={values.detalles.length === 1} onClick={() => setValues({ ...values, detalles: values.detalles.filter((_, i) => i !== index) })}>Quitar</button></div>
      </div>)}
      <div className="d-flex gap-2"><button className="btn btn-outline-primary" type="button" disabled={values.detalles.length >= active.length} onClick={() => setValues({ ...values, detalles: [...values.detalles, { id_medicamento: '', cantidad: '' }] })}>Agregar medicamento</button><button className="btn btn-primary" type="submit">Crear venta</button></div>
    </fieldset>
    <div className="mt-3"><button className="btn btn-outline-secondary" type="button" disabled={saving} onClick={onCancel}>Cancelar</button></div>
  </form>
}
