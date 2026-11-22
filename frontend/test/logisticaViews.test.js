import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

test('vistas logísticas: acciones por rol, estados terminales y ETA desconocido', async () => {
  const server = await createServer({ configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
  try {
    const { default: DeliveriesView } = await server.ssrLoadModule('/src/modules/entregas/DeliveriesView.jsx')
    const row = { id_entrega: 1, id_venta: 3, id_sucursal: 1, estado: 'PREPARADA', nombre_cliente: 'Ana', direccion: 'Calle 1', tiempo_estimado: null }
    const props = { result: { loading: false, rows: [row] }, draft: { id_sucursal: '', id_venta: '', estado: '', departamento: '', municipio: '' }, form: null, busy: false }
    const render = (role, patch = {}) => renderToStaticMarkup(createElement(DeliveriesView, { ...props, user: { nombre_rol: role, id_sucursal: 1 }, ...patch }))
    const admin = render('ADMINISTRADOR')
    assert.match(admin, /Ver detalle/)
    assert.doesNotMatch(admin, /Nueva entrega|Pasar a/)
    assert.match(render('ENCARGADO'), /Nueva entrega/)
    assert.match(render('ENCARGADO'), /Pasar a CANCELADA/)
    assert.doesNotMatch(render('ENCARGADO'), /Pasar a EN_RUTA/)
    assert.match(render('DESPACHO'), /Pasar a EN_RUTA/)
    assert.doesNotMatch(render('DESPACHO'), /Nueva entrega|Pasar a CANCELADA/)
    assert.doesNotMatch(render('DESPACHO', { result: { rows: [{ ...row, estado: 'ENTREGADA' }] } }), /Pasar a/)
    assert.match(render('ADMINISTRADOR', { detail: { ...row, observaciones: 'Llamar al llegar' } }), /Llamar al llegar/)
    assert.match(render('ADMINISTRADOR', { result: { rows: [] } }), /No hay entregas/)
    assert.match(render('ADMINISTRADOR', { result: { loading: true } }), /Cargando entregas/)

    const { default: AvailabilityView } = await server.ssrLoadModule('/src/modules/disponibilidad/AvailabilityView.jsx')
    const values = { id_medicamento: '2', cantidad: '3', departamento: 'Guatemala', municipio: 'Mixco' }
    const data = { disponible: true, id_medicamento: 2, cantidad: 3, candidatos: [{ id_sucursal: 1, nombre: 'Centro', tipo_sucursal: 'FARMACIA', existencia: 5, cantidad_solicitada: 3, prioridad: 3, eta_disponible: false, tiempo_estimado: null, formas_pago: ['EFECTIVO'] }] }
    const available = renderToStaticMarkup(createElement(AvailabilityView, { values, result: { data, destination: values }, busy: false }))
    assert.match(available, /Medicamento 2/)
    assert.match(available, /Centro/)
    assert.match(available, /Sin estimación/)
    assert.match(available, /no confirma la viabilidad/)
    assert.match(available, /EFECTIVO/)
    assert.match(available, /Tiempo estimado disponible/)
    assert.match(available, /Tiempo estimado de entrega/)
    assert.doesNotMatch(available, /ETA disponible/)
    assert.doesNotMatch(available, /null min|0 min/)
    const empty = renderToStaticMarkup(createElement(AvailabilityView, { values, result: { data: { ...data, disponible: false, candidatos: [] }, destination: values } }))
    assert.match(empty, /No hay sucursales candidatas/)
  } finally { await server.close() }
})
