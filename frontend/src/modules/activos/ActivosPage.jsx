import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { hasPermission } from '../../auth/permissions'
import { assetFormValues, assetPath, createAssetsApi } from './assets'
import AssetsView from './AssetsView'

const initialResult = { loading: true, rows: [], error: null }

export default function ActivosPage() {
  const { session, request } = useAuth()
  const user = session.user
  const api = useMemo(() => createAssetsApi(request), [request])
  const [draft, setDraft] = useState({ id_sucursal: '' })
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
    api.list(filters, controller.signal).then(rows => {
      if (!controller.signal.aborted) setResult({ loading: false, rows, error: null })
    }).catch(failure => { if (!controller.signal.aborted) setResult({ loading: false, rows: [], error: failure }) })
    return () => controller.abort()
  }, [api, filters, retry])

  function consult(event) {
    event.preventDefault()
    try {
      assetPath(draft)
      setError(null)
      setResult(initialResult)
      setFilters({ ...draft })
    } catch (failure) { setError(failure) }
  }

  async function edit(row) {
    if (locked.current || !hasPermission(user, 'activos.write')) return
    locked.current = true
    setBusy(true)
    setError(null)
    setNotice('')
    try {
      const record = await api.read(row.id_activo)
      setForm({ id: record.id_activo, values: assetFormValues(record) })
    } catch (failure) { setError(failure) } finally { locked.current = false; setBusy(false) }
  }

  async function save(event) {
    event.preventDefault()
    if (locked.current || !hasPermission(user, 'activos.write')) return
    locked.current = true
    setBusy(true)
    setError(null)
    setNotice('')
    activeLoad.current?.abort()
    try {
      const updated = await api.save(form.id, form.values, user, filters)
      if (!updated) return
      setForm(null)
      setNotice(`Activo ${updated.record.id_activo} guardado correctamente.`)
      setResult({ loading: false, rows: updated.rows, error: updated.refreshError })
    } catch (failure) { setError(failure) } finally { locked.current = false; setBusy(false) }
  }

  return <AssetsView user={user} result={result} draft={draft} setDraft={setDraft} form={form} setForm={setForm} busy={busy} error={error} notice={notice}
    onConsult={consult} onEdit={edit} onSave={save}
    onNew={() => { setError(null); setNotice(''); setForm({ id: null, values: { id_sucursal: filters.id_sucursal, categoria: '', descripcion: '', valor: '', estado: 'ACTIVO', responsable: '' } }) }}
    onCancel={() => { setForm(null); setError(null) }}
    onRetry={() => { setResult(initialResult); setRetry(value => value + 1) }} />
}
