import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { hasPermission } from '../../auth/permissions'
import { createPayrollApi, payrollPath } from './payroll'
import PayrollView from './PayrollView'

const initialResult = { loading: true, rows: [], summary: null, listError: null, summaryError: null }

export default function PlanillaPage() {
  const { session, request } = useAuth()
  const user = session.user
  const api = useMemo(() => createPayrollApi(request), [request])
  const [draft, setDraft] = useState({ id_sucursal: '', periodo: '', concepto: '' })
  const [filters, setFilters] = useState(draft)
  const [result, setResult] = useState(initialResult)
  const [retry, setRetry] = useState(0)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState('')
  const locked = useRef(false)
  const activeLoad = useRef(null)

  useEffect(() => {
    const controller = new AbortController()
    activeLoad.current = controller
    api.load(filters, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult(data)
    })
    return () => controller.abort()
  }, [api, filters, retry])

  function consult(event) {
    event.preventDefault()
    try {
      payrollPath(draft)
      setError(null)
      setResult(initialResult)
      setFilters({ ...draft })
    } catch (failure) { setError(failure) }
  }

  async function save(event) {
    event.preventDefault()
    if (locked.current || !hasPermission(user, 'planilla.write')) return
    locked.current = true
    setBusy(true)
    setError(null)
    setNotice('')
    activeLoad.current?.abort()
    try {
      const updated = await api.create(form, user, filters)
      if (!updated) return
      setForm(null)
      setNotice(`Gasto de planilla ${updated.record.id_gasto} registrado correctamente.`)
      setResult(updated)
    } catch (failure) { setError(failure) } finally { locked.current = false; setBusy(false) }
  }

  return <PayrollView user={user} result={result} draft={draft} filters={filters} setDraft={setDraft} form={form} setForm={setForm} busy={busy} error={error} notice={notice}
    onConsult={consult} onSave={save}
    onNew={() => { setError(null); setNotice(''); setForm({ id_sucursal: filters.id_sucursal, periodo: filters.periodo, concepto: '', monto: '' }) }}
    onCancel={() => { setForm(null); setError(null) }}
    onRetry={() => { setResult(initialResult); setRetry(value => value + 1) }} />
}
