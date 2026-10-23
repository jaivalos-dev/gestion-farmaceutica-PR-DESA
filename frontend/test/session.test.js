import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readSession, saveSession, clearSession, SESSION_KEY } from '../src/auth/session.js'

const tokenFor = payload => `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`
const storage = () => {
  const entries = new Map()
  return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) }
}

test('persiste solo JWT y restaura contexto visual con Unicode', () => {
  const store = storage()
  const token = tokenFor({ id_usuario: 1, nombre_rol: 'Administración', exp: Math.floor(Date.now() / 1000) + 3600 })
  saveSession(token, store)
  assert.equal(store.getItem(SESSION_KEY), token)
  assert.equal(readSession(store).user.nombre_rol, 'Administración')
  clearSession(store)
  assert.equal(readSession(store), null)
})

test('descarta JWT vencido o malformado al restaurar', () => {
  for (const token of ['inválido', tokenFor({ exp: 1 }), tokenFor({})]) {
    const store = storage()
    store.setItem(SESSION_KEY, token)
    assert.equal(readSession(store), null)
    assert.equal(store.getItem(SESSION_KEY), null)
  }
})
