import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { auditFilters, auditPath, createAuditApi } from './audit'
import AuditView from './AuditView'

const loadingResult = { loading: true, rows: [], error: null }

export default function AuditoriaPage() {
  const { session, request } = useAuth()
  const api = useMemo(() => createAuditApi(request), [request])
  const [draft, setDraft] = useState(() => Object.fromEntries(auditFilters.map(([field]) => [field, ''])))
  const [filters, setFilters] = useState(draft)
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState(loadingResult)
  const [error, setError] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    api.list(filters, session.user, controller.signal).then(rows => {
      if (!controller.signal.aborted) setResult({ loading: false, rows, error: null })
    }).catch(failure => {
      if (!controller.signal.aborted) setResult({ loading: false, rows: [], error: failure })
    })
    return () => controller.abort()
  }, [api, filters, session.user, retry])

  function consult(event) {
    event.preventDefault()
    try {
      auditPath(draft)
      setError(null)
      setResult(loadingResult)
      setFilters({ ...draft })
    } catch (failure) { setError(failure) }
  }

  return <AuditView draft={draft} setDraft={setDraft} result={result} error={error} onConsult={consult}
    onRetry={() => { setError(null); setResult(loadingResult); setRetry(value => value + 1) }} />
}
