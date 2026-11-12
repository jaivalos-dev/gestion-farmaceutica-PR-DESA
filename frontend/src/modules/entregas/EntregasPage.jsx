import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { hasRole } from '../../auth/permissions'
import { createDeliveriesApi, deliveryPath } from './deliveries'
import DeliveriesView from './DeliveriesView'

const loadingResult = { loading: true, rows: [], error: null }

export default function EntregasPage() {
  const { session, request } = useAuth()
  const user = session.user
  const api = useMemo(() => createDeliveriesApi(request), [request])
  const [draft, setDraft] = useState({ id_sucursal: hasRole(user, ['ENCARGADO']) ? String(user.id_sucursal ?? '') : '', id_venta: '', estado: '', departamento: '', municipio: '' })
  const [filters, setFilters] = useState(draft)
  const [result, setResult] = useState(loadingResult)
  const [retry, setRetry] = useState(0)
  const [form, setForm] = useState(null)
  const [detail, setDetail] = useState(null)
  const [pending, setPending] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState('')
  const locked = useRef(false)
  const activeLoad = useRef(null)

  useEffect(() => {
    const controller = new AbortController()
    activeLoad.current = controller
    api.list(filters, user, controller.signal).then(rows => {
      if (!controller.signal.aborted) setResult({ loading: false, rows, error: null })
    }).catch(failure => { if (!controller.signal.aborted) setResult({ loading: false, rows: [], error: failure }) })
    return () => controller.abort()
  }, [api, filters, user, retry])

  function consult(event) {
    event.preventDefault()
    try {
      deliveryPath(draft, user)
      setError(null)
      setDetail(null)
      setResult(loadingResult)
      setFilters({ ...draft })
    } catch (failure) { setError(failure) }
  }

  async function save(operation) {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setError(null)
    setNotice('')
    activeLoad.current?.abort()
    try {
      const updated = await operation()
      if (!updated) return
      setForm(null)
      setPending(null)
      setDetail(updated.record)
      setNotice(`Entrega ${updated.record.id_entrega}: ${updated.record.estado}. Operación realizada correctamente.`)
      setResult({ loading: false, rows: updated.rows, error: updated.refreshError })
    } catch (failure) { setError(failure); setPending(null) } finally { locked.current = false; setBusy(false) }
  }

  async function showDetail(row) {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setError(null)
    setDetail(null)
    try { setDetail(await api.read(row.id_entrega)) } catch (failure) { setError(failure) } finally { locked.current = false; setBusy(false) }
  }

  return <DeliveriesView user={user} result={result} draft={draft} setDraft={setDraft} form={form} setForm={setForm} detail={detail} pending={pending} busy={busy} error={error} notice={notice}
    onConsult={consult} onDetail={showDetail} onCloseDetail={() => setDetail(null)}
    onNew={() => { setError(null); setNotice(''); setDetail(null); setForm({ id_venta: '', nombre_cliente: '', telefono: '', direccion: '', departamento: '', municipio: '', observaciones: '' }) }}
    onSave={event => { event.preventDefault(); save(() => api.create(form, user, filters)) }} onCancel={() => { setForm(null); setError(null) }}
    onTransition={(row, state) => { setPending({ row, state }); setError(null); setNotice('') }} onDismiss={() => setPending(null)}
    onConfirm={() => save(() => api.transition(pending.row, pending.state, user, filters))}
    onRetry={() => { setResult(loadingResult); setRetry(value => value + 1) }} />
}
