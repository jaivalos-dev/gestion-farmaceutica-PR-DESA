import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'

export default function CatalogTable({ endpoint, title, columns, idField }) {
  const { request } = useAuth()
  const [result, setResult] = useState({ loading: true, data: [], error: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const data = await request(endpoint, { signal: controller.signal })
        if (!Array.isArray(data)) throw new Error('El servidor devolvió un listado no válido.')
        if (!controller.signal.aborted) setResult({ loading: false, data, error: null })
      } catch (error) {
        if (!controller.signal.aborted) setResult({ loading: false, data: [], error })
      }
    }
    load()
    return () => controller.abort()
  }, [endpoint, request, attempt])

  function retry() {
    setResult({ loading: true, data: [], error: null })
    setAttempt(value => value + 1)
  }

  if (result.loading) return <p className="text-body-secondary mb-0" role="status">Cargando {title.toLowerCase()}…</p>
  if (result.error) return <>
    <p className="alert alert-danger" role="alert">{result.error.message}{result.error.code && ` (${result.error.code})`}</p>
    <button className="btn btn-outline-primary" type="button" onClick={retry}>Reintentar</button>
  </>
  if (result.data.length === 0) return <p className="alert alert-secondary mb-0" role="status">No hay datos de {title.toLowerCase()}.</p>

  return <div className="table-responsive" tabIndex={0} role="region" aria-label={`Listado de ${title.toLowerCase()}`}>
    <table className="table table-bordered table-hover align-middle caption-top mb-0">
      <caption>Listado de {title.toLowerCase()}</caption>
      <thead className="table-light"><tr>{columns.map(([field, label]) => <th key={field} scope="col">{label}</th>)}</tr></thead>
      <tbody>{result.data.map(row => <tr key={row[idField]}>
        {columns.map(([field, , format]) => <td key={field}>{row[field] == null ? '—' : format ? format(row[field]) : row[field]}</td>)}
      </tr>)}</tbody>
    </table>
  </div>
}
