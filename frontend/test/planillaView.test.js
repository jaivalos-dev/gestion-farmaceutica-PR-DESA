import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

test('vista planilla: permisos, resumen remoto, errores, vacío y carga', async () => {
  const server = await createServer({ configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
  try {
    const { default: PayrollView } = await server.ssrLoadModule('/src/modules/planilla/PayrollView.jsx')
    const filters = { id_sucursal: '', periodo: '2026-11', concepto: 'mensual' }
    const result = { loading: false, rows: [{ id_gasto: 1, sucursal: 'Centro', usuario: 'Ana', periodo: '2026-11', concepto: 'Mensual', monto: 10 }], summary: { total: 100, cantidad_registros: 4 } }
    const props = { result, draft: filters, filters, form: null, busy: false }
    const render = (role, patch = {}) => renderToStaticMarkup(createElement(PayrollView, { ...props, user: { nombre_rol: role }, ...patch }))
    const auditor = render('AUDITOR')
    assert.match(auditor, /Ana/)
    assert.match(auditor, /100\.00/)
    assert.match(auditor, /Cantidad de registros/)
    assert.match(auditor, /no cambia este resumen/)
    assert.doesNotMatch(auditor, /Registrar gasto|Guardar gasto|Editar|Eliminar/)
    assert.match(render('ADMINISTRADOR'), /Registrar gasto/)
    const form = { id_sucursal: '1', periodo: '2026-11', concepto: '', monto: '' }
    assert.match(render('ADMINISTRADOR', { form }), /Guardar gasto/)
    assert.match(render('ADMINISTRADOR', { form }), /Cancelar/)
    assert.doesNotMatch(render('AUDITOR', { form }), /Registro de gasto de planilla|Guardar gasto/)
    assert.match(render('AUDITOR', { result: { loading: true } }), /Cargando resumen/)
    assert.match(render('AUDITOR', { result: { rows: [], summary: { total: 0, cantidad_registros: 0 } } }), /No hay gastos/)
    const error = Object.assign(new Error('Fallo de resumen'), { code: 'INTERNAL_ERROR' })
    const partial = render('AUDITOR', { result: { ...result, summary: null, summaryError: error } })
    assert.match(partial, /INTERNAL_ERROR/)
    assert.match(partial, /Ana/)
    assert.match(partial, /Reintentar consultas/)
  } finally { await server.close() }
})
