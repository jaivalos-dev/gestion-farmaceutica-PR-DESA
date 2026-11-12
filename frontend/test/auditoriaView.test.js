import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { auditFilters, auditPath } from '../src/modules/auditoria/audit.js'

test('vista auditoría: habilita ID con tipo concreto y lo limpia al volver a Todos', async () => {
  const server = await createServer({ configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
  try {
    const { default: AuditView } = await server.ssrLoadModule('/src/modules/auditoria/AuditView.jsx')
    let draft = Object.fromEntries(auditFilters.map(([field]) => [field, '']))
    const view = () => AuditView({ draft, setDraft: next => { draft = next }, result: { rows: [] } })
    function findControl(node, id) {
      if (!node || typeof node !== 'object') return undefined
      if (node.props?.id === id) return node
      const children = Array.isArray(node) ? node : [node.props?.children]
      for (const child of children) {
        const found = findControl(child, id)
        if (found) return found
      }
    }
    const control = field => findControl(view(), `audit-${field}`)
    const change = (field, value) => control(field).props.onChange({ target: { value } })
    const idMarkup = () => renderToStaticMarkup(view()).match(/<input[^>]*id="audit-id_entidad"[^>]*>/)[0]

    assert.match(idMarkup(), /disabled=""/)
    change('entidad', 'VENTA')
    assert.doesNotMatch(idMarkup(), /disabled/)
    change('id_entidad', '7')
    assert.equal(auditPath(draft), '/api/auditoria?entidad=VENTA&id_entidad=7')
    change('modulo', 'VENTAS')
    assert.equal(draft.id_entidad, '7')
    change('entidad', 'TRANSFERENCIA')
    assert.equal(draft.id_entidad, '7')
    assert.doesNotMatch(idMarkup(), /disabled/)
    change('entidad', '')
    assert.equal(draft.id_entidad, '')
    assert.equal(draft.modulo, 'VENTAS')
    assert.match(idMarkup(), /disabled=""/)
    assert.equal(auditPath(draft), '/api/auditoria?modulo=VENTAS')
    change('entidad', 'VENTA')
    assert.doesNotMatch(idMarkup(), /disabled/)
    assert.equal(draft.id_entidad, '')
  } finally { await server.close() }
})

test('vista auditoría: solo lectura, null, carga, errores y ausencia de secretos', async () => {
  const server = await createServer({ configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
  try {
    const { default: AuditView } = await server.ssrLoadModule('/src/modules/auditoria/AuditView.jsx')
    const draft = Object.fromEntries(auditFilters.map(([field]) => [field, '']))
    const row = { id_auditoria: 2, fecha_hora: '2026-11-04T12:00:00', usuario: null, sucursal: null, modulo: 'VENTAS', accion: 'CONFIRMAR', entidad: 'VENTA', id_entidad: 7, descripcion: 'Venta 7 confirmada', password: 'SECRETO_NO_VISIBLE', token: 'TOKEN_NO_VISIBLE' }
    const render = result => renderToStaticMarkup(createElement(AuditView, { draft, result }))
    const html = render({ rows: [row] })
    assert.match(html, /Venta 7 confirmada/)
    assert.match(html, /<td>—<\/td>/)
    assert.match(html, /2026/)
    assert.match(html, /Consultar/)
    assert.doesNotMatch(html, /SECRETO_NO_VISIBLE|TOKEN_NO_VISIBLE|Editar|Eliminar|Guardar|Crear evento/)
    const protectedHtml = render({ rows: [{ ...row, descripcion: 'password=SECRETO_NO_VISIBLE', usuario: { token: 'TOKEN_NO_VISIBLE' } }] })
    assert.match(protectedHtml, /Contenido sensible oculto/)
    assert.doesNotMatch(protectedHtml, /SECRETO_NO_VISIBLE|TOKEN_NO_VISIBLE|\[object Object\]/)
    assert.match(render({ loading: true }), /Cargando eventos/)
    assert.match(render({ rows: [] }), /No hay eventos/)
    const failure = render({ error: Object.assign(new Error('Servicio no disponible'), { code: 'DATABASE_UNAVAILABLE' }) })
    assert.match(failure, /DATABASE_UNAVAILABLE/)
    assert.match(failure, /Reintentar consulta/)
    for (const [field] of auditFilters) assert.match(failure, new RegExp(`id="audit-${field}"`))
    assert.doesNotMatch(render({ error: new Error('Authorization: Bearer SECRETO_NO_VISIBLE') }), /SECRETO_NO_VISIBLE/)
  } finally { await server.close() }
})
