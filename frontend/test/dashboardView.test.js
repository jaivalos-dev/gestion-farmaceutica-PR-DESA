import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { dashboardGroups, formatAmount, formatCount } from '../src/modules/dashboard/dashboard.js'

test('dashboard vista: seis bloques, 15 indicadores, ceros, carga, errores y controles', async () => {
  const server = await createServer({ configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
  try {
    const { default: View } = await server.ssrLoadModule('/src/modules/dashboard/DashboardView.jsx')
    let draft = '', consults = 0, retries = 0
    const data = Object.fromEntries(dashboardGroups.map(([group, , fields]) => [group, Object.fromEntries(fields.map(([field, , money], index) => [field, money ? 1234.5 : index]))]))
    const props = { result: { id: '', data }, draft, setDraft: value => { draft = value }, onConsult: () => { consults++ }, onRetry: () => { retries++ } }
    const render = result => renderToStaticMarkup(createElement(View, { ...props, result }))
    const html = render(props.result)
    assert.match(html, /Resumen ejecutivo/)
    assert.match(html, /Consolidado de todas las sucursales/)
    for (const [group, title, fields] of dashboardGroups) {
      assert.ok(html.includes(title))
      for (const [field, label, money] of fields) {
        assert.ok(html.includes(label))
        assert.ok(html.includes(money ? formatAmount(data[group][field]) : formatCount(data[group][field])))
      }
    }
    const zeros = Object.fromEntries(dashboardGroups.map(([group, , fields]) => [group, Object.fromEntries(fields.map(([field]) => [field, 0]))]))
    const zeroHtml = render({ id: '9999999999', data: zeros })
    assert.equal((zeroHtml.match(/<dd /g) ?? []).length, 15)
    assert.doesNotMatch(zeroHtml, /No hay|Sin datos/)
    assert.match(zeroHtml, /Resumen de la sucursal 9999999999/)
    const loading = render({ id: '', loading: true, data })
    assert.match(loading, /fieldset disabled/)
    assert.match(loading, /Cargando resumen/)
    assert.doesNotMatch(loading, /<dd /)
    const failure = render({ id: '1', error: Object.assign(new Error('Identificador inválido'), { code: 'INVALID_ID' }), data })
    assert.match(failure, /role="alert"/)
    assert.match(failure, /INVALID_ID/)
    assert.match(failure, /Reintentar consulta/)
    assert.doesNotMatch(failure, /<dd /)
    function find(node, predicate) {
      if (!node || typeof node !== 'object') return undefined
      if (predicate(node)) return node
      for (const child of Array.isArray(node) ? node : [node.props?.children]) {
        const found = find(child, predicate)
        if (found) return found
      }
    }
    const tree = View(props)
    const input = find(tree, node => node.props?.id === 'dashboard-branch')
    input.props.onChange({ target: { value: '1' } })
    assert.equal(draft, '1')
    input.props.onChange({ target: { value: '' } })
    assert.equal(draft, '')
    find(tree, node => node.type === 'form').props.onSubmit()
    assert.equal(consults, 1)
    find(View({ ...props, result: { id: '', error: new Error('Red') } }), node => node.props?.onClick === props.onRetry).props.onClick()
    assert.equal(retries, 1)
  } finally { await server.close() }
})

test('dashboard enlaces de navegación e inicio y protección real de ruta por los cuatro roles', async () => {
  const server = await createServer({ configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
  try {
    const { AuthContext } = await server.ssrLoadModule('/src/auth/AuthContext.js')
    const { default: Layout } = await server.ssrLoadModule('/src/layouts/AdminLayout.jsx')
    const { default: Home } = await server.ssrLoadModule('/src/pages/HomePage.jsx')
    const { default: App } = await server.ssrLoadModule('/src/App.jsx')
    function findRoute(node) {
      if (!node || typeof node !== 'object') return undefined
      const children = Array.isArray(node) ? node : [node.props?.children]
      if (node.props?.element?.props?.permission === 'dashboard.read') return node
      for (const child of children) { const found = findRoute(child); if (found) return found }
    }
    const route = findRoute(App())
    assert.equal(route.props.children.props.path, 'dashboard')
    for (const role of ['ADMINISTRADOR', 'AUDITOR', 'ENCARGADO', 'DESPACHO']) {
      const allowed = ['ADMINISTRADOR', 'AUDITOR'].includes(role)
      const value = { session: { user: { nombre_rol: role, id_usuario: 1 } }, logout() {} }
      for (const component of [Layout, Home]) {
        const html = renderToStaticMarkup(createElement(AuthContext.Provider, { value }, createElement(MemoryRouter, null, createElement(component))))
        assert.equal(html.includes('href="/dashboard"'), allowed)
      }
      // Render el guard real, capturando el destino Navigate sin depender de efectos SSR.
      function Probe() {
        const result = route.props.element.type(route.props.element.props)
        return createElement('span', null, result.props.to ?? 'permitido')
      }
      const guard = renderToStaticMarkup(createElement(AuthContext.Provider, { value }, createElement(Probe)))
      assert.equal(guard, `<span>${allowed ? 'permitido' : '/403'}</span>`)
    }
  } finally { await server.close() }
})
