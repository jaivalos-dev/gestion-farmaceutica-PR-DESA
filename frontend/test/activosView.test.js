import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

test('vista de activos: AUDITOR sin controles de escritura; ADMINISTRADOR con alta, edición y formulario', async () => {
  const server = await createServer({ configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { default: AssetsView } = await server.ssrLoadModule('/src/modules/activos/AssetsView.jsx')
    const props = {
      result: { loading: false, error: null, rows: [{ id_activo: 1, sucursal: 'Centro', categoria: 'Equipo', descripcion: 'Computadora', valor: 0, estado: 'BAJA', responsable: null }] },
      draft: { id_sucursal: '' }, form: null, busy: false,
    }
    const render = (role, patch = {}) => renderToStaticMarkup(createElement(AssetsView, { ...props, user: { nombre_rol: role }, ...patch }))
    const auditor = render('AUDITOR')
    assert.match(auditor, /Computadora/)
    assert.match(auditor, /BAJA/)
    assert.doesNotMatch(auditor, /Nuevo activo|Editar|Guardar activo|Acciones/)
    const admin = render('ADMINISTRADOR')
    assert.match(admin, /Nuevo activo/)
    assert.match(admin, /Editar/)
    const form = { id: 1, values: { id_sucursal: '2', categoria: 'Equipo', descripcion: 'Computadora', valor: '0', estado: 'BAJA', responsable: '' } }
    assert.match(render('ADMINISTRADOR', { form }), /Guardar activo/)
    assert.match(render('ADMINISTRADOR', { form }), /Cancelar/)
    assert.doesNotMatch(render('AUDITOR', { form }), /Formulario de activo|Guardar activo|Editar activo/)
    assert.match(render('AUDITOR', { result: { loading: true } }), /Cargando activos/)
    assert.match(render('AUDITOR', { result: { rows: [] } }), /No hay activos/)
    assert.match(render('AUDITOR', { result: { error: new Error('Sin conexión') } }), /Sin conexión/)
  } finally { await server.close() }
})
