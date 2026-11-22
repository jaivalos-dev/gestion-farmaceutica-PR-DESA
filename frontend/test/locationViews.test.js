import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { departments, guatemalaLocations, municipalitiesFor } from '../src/data/guatemalaLocations.js'
import { branchFields } from '../src/modules/catalogForms.js'

test('catálogo completo, sin duplicados y compatible con límites UTF-8', () => {
  assert.equal(departments.length, 22)
  assert.equal(Object.values(guatemalaLocations).flat().length, 340)
  for (const [department, municipalities] of Object.entries(guatemalaLocations)) {
    assert.equal(new Set(municipalities).size, municipalities.length)
    for (const name of [department, ...municipalities]) {
      assert.equal(name, name.trim().normalize('NFC'))
      assert.ok(new TextEncoder().encode(name).length <= 50)
    }
  }
  assert.deepEqual(municipalitiesFor('__proto__'), [])
})

// Inspecciona elementos React y ejecuta sus handlers reales, sin dependencias DOM adicionales.
function elements(node, predicate) {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(child => elements(child, predicate))
  return [...(predicate(node) ? [node] : []), ...elements(node.props?.children, predicate)]
}

test('selects en disponibilidad, nueva entrega, filtros y editor de sucursales', async () => {
  const server = await createServer({ configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
  try {
    const { default: LocationFields } = await server.ssrLoadModule('/src/components/LocationFields.jsx')
    const { default: AvailabilityView } = await server.ssrLoadModule('/src/modules/disponibilidad/AvailabilityView.jsx')
    const { default: DeliveriesView } = await server.ssrLoadModule('/src/modules/entregas/DeliveriesView.jsx')
    const { CatalogFields } = await server.ssrLoadModule('/src/components/CatalogManager.jsx')
    const blank = { departamento: '', municipio: '', id_medicamento: '', cantidad: '', id_sucursal: '', id_venta: '', estado: '', nombre_cliente: '', telefono: '', direccion: '', observaciones: '' }
    const availability = AvailabilityView({ values: blank })
    const deliveries = DeliveriesView({ user: { nombre_rol: 'ENCARGADO', id_sucursal: 1 }, result: { rows: [{ id_entrega: 1, estado: 'CREADA' }] }, draft: blank, form: blank })
    const branch = CatalogFields({ fields: branchFields, values: blank, idField: 'id_sucursal' })
    const locations = [availability, deliveries, branch].flatMap(tree => elements(tree, n => n.type === LocationFields))
    assert.equal(locations.length, 4)
    assert.deepEqual(branchFields.filter(f => f.location).map(f => f.name), ['departamento', 'municipio'])
    for (const element of locations) {
      let values = { ...blank }
      const props = { ...element.props, onChange: next => { values = next } }
      const render = () => LocationFields({ ...props, values })
      const selects = () => elements(render(), n => n.type === 'select')
      assert.equal(selects()[1].props.disabled, true)
      assert.equal(selects()[0].props.required, props.required !== false)
      assert.match(renderToStaticMarkup(render()), /Sacatepéquez/)
      selects()[0].props.onChange({ target: { value: 'Guatemala' } })
      assert.equal(selects()[1].props.disabled, false)
      assert.match(renderToStaticMarkup(selects()[1]), /Mixco/)
      assert.doesNotMatch(renderToStaticMarkup(selects()[1]), /Antigua Guatemala/)
      selects()[1].props.onChange({ target: { value: 'Mixco' } })
      assert.equal(values.municipio, 'Mixco')
      selects()[0].props.onChange({ target: { value: 'Sacatepéquez' } })
      assert.equal(values.municipio, '')
      assert.match(renderToStaticMarkup(selects()[1]), /Antigua Guatemala/)
      selects()[1].props.onChange({ target: { value: 'Antigua Guatemala' } })
      selects()[0].props.onChange({ target: { value: '' } })
      assert.equal(values.municipio, '')
      assert.equal(selects()[1].props.disabled, true)
    }
    const legacy = renderToStaticMarkup(createElement(LocationFields, { values: { departamento: 'Sacatepequez', municipio: 'Antigua Guatemala' }, prefix: 'branch' }))
    assert.match(legacy, /Valor actual fuera del catálogo: Sacatepequez/)
    const edited = renderToStaticMarkup(createElement(LocationFields, { values: { departamento: 'Sacatepéquez', municipio: 'Antigua Guatemala' }, prefix: 'branch' }))
    assert.match(edited, /selected="">Antigua Guatemala/)
    assert.match(renderToStaticMarkup(deliveries), /Tiempo estimado de entrega \(min\)/)
  } finally { await server.close() }
})
