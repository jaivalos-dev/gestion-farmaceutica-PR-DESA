import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { createDashboardApi, createDashboardQuery } from './dashboard'
import DashboardView from './DashboardView'

export default function DashboardPage() {
  const { session, request } = useAuth()
  const query = useMemo(() => createDashboardQuery(createDashboardApi(request), session.user), [request, session.user])
  const result = useSyncExternalStore(query.subscribe, query.getSnapshot, query.getSnapshot)
  const [draft, setDraft] = useState('')
  useEffect(() => {
    query.load()
    return () => query.cancel()
  }, [query])

  return <DashboardView draft={draft} setDraft={setDraft} result={result}
    onConsult={event => { event.preventDefault(); query.load(draft) }}
    onRetry={() => query.load(result.id)} />
}
