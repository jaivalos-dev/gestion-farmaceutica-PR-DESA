export class ApiError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export function createApiClient({ baseUrl = '', fetchImpl = fetch } = {}) {
  return async function request(path, { method = 'GET', body, token, signal, onUnauthorized } = {}) {
    const headers = { Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (token) headers.Authorization = `Bearer ${token}`
    let response
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${path}`, {
        method, headers, signal, body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (error) {
      if (error.name === 'AbortError') throw error
      throw new ApiError(0, 'NETWORK_ERROR', 'No se pudo conectar con el servidor. Intente nuevamente.')
    }
    if (response.status === 401 && token) onUnauthorized?.()
    let payload
    try {
      payload = await response.json()
    } catch {
      throw new ApiError(response.status, response.ok ? 'INVALID_RESPONSE' : 'HTTP_ERROR',
        response.ok ? 'El servidor devolvió una respuesta no válida.' : `No se pudo completar la solicitud (HTTP ${response.status}).`)
    }
    if (!response.ok || payload?.ok === false) {
      throw new ApiError(response.status, payload?.code ?? 'HTTP_ERROR', payload?.message ?? 'No se pudo completar la solicitud.')
    }
    if (!payload || payload.ok !== true || !Object.hasOwn(payload, 'data')) {
      throw new ApiError(response.status, 'INVALID_RESPONSE', 'El servidor devolvió una respuesta no válida.')
    }
    return payload.data
  }
}
