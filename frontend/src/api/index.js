import { createApiClient } from './client'

// VITE_API_URL configura el destino en vite.config.js (dev y preview).
// Mantener el mismo origen permite utilizar el backend actual sin cambiar CORS.
export const api = createApiClient()
