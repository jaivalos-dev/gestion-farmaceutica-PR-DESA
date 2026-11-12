import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { createAvailabilityApi } from './availability'
import AvailabilityView from './AvailabilityView'

export default function DisponibilidadPage() {
  const { session, request } = useAuth()
  const api = useMemo(() => createAvailabilityApi(request), [request])
  const [values, setValues] = useState({ id_medicamento: '', cantidad: '', departamento: '', municipio: '' })
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const locked = useRef(false)
  const activeLoad = useRef(null)
  useEffect(() => () => activeLoad.current?.abort(), [api])

  async function consult(event) {
    event.preventDefault()
    if (locked.current) return
    locked.current = true
    const controller = new AbortController()
    activeLoad.current = controller
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const data = await api.consult(values, session.user, controller.signal)
      if (data && !controller.signal.aborted) setResult({ data, destination: { departamento: values.departamento.trim(), municipio: values.municipio.trim() } })
    } catch (failure) { if (!controller.signal.aborted) setError(failure) } finally { locked.current = false; if (!controller.signal.aborted) setBusy(false) }
  }
  return <AvailabilityView values={values} setValues={setValues} result={result} busy={busy} error={error} onConsult={consult} />
}
