import test from 'node:test'
import assert from 'node:assert/strict'
import { createApiClient } from '../src/api/client.js'

test('envía JSON y Bearer; conserva el contrato de respuesta', async () => {
  const api = createApiClient({ baseUrl: 'https://api.example.test/', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.example.test/api/auth/login')
    assert.equal(options.headers.Authorization, 'Bearer prueba')
    assert.equal(options.headers['Content-Type'], 'application/json')
    assert.deepEqual(JSON.parse(options.body), { correo: 'test@example.test' })
    return Response.json({ ok: true, data: { token: 'respuesta' } })
  } })
  assert.deepEqual(await api('/api/auth/login', { method: 'POST', token: 'prueba', body: { correo: 'test@example.test' } }), { token: 'respuesta' })
})

test('conserva code y message y notifica un 401 protegido', async () => {
  let expired = false
  const api = createApiClient({ fetchImpl: async () => Response.json({ code: 'UNAUTHORIZED', message: 'Autenticación requerida' }, { status: 401 }) })
  await assert.rejects(api('/api/sucursales', { token: 'prueba', onUnauthorized: () => { expired = true } }), { status: 401, code: 'UNAUTHORIZED', message: 'Autenticación requerida' })
  assert.equal(expired, true)
})

test('un 401 de login no dispara expiración de sesión', async () => {
  const api = createApiClient({ fetchImpl: async () => Response.json({ code: 'INVALID_CREDENTIALS', message: 'Credenciales inválidas' }, { status: 401 }) })
  await assert.rejects(api('/api/auth/login', { onUnauthorized: () => assert.fail('No es una petición protegida') }), { code: 'INVALID_CREDENTIALS' })
})

test('maneja errores no JSON y fallos de red sin exponer su contenido', async () => {
  const api = createApiClient({ fetchImpl: async () => new Response('<html>error</html>', { status: 502 }) })
  await assert.rejects(api('/api/sucursales'), { status: 502, code: 'HTTP_ERROR' })
  const offline = createApiClient({ fetchImpl: async () => { throw new TypeError('fetch failed') } })
  await assert.rejects(offline('/api/sucursales'), { code: 'NETWORK_ERROR' })
})
