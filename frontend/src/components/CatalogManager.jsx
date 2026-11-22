import LocationFields from './LocationFields'
import { useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { hasPermission } from '../auth/permissions'
import CatalogTable from './CatalogTable'

export default function CatalogManager({ title, endpoint, columns, idField, writePermission, fields, toPayload }) {
  const { session, request } = useAuth()
  const canWrite = hasPermission(session.user, writePermission)
  const [editor, setEditor] = useState(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const saving = useRef(false)
  const formRef = useRef(null)

  function openEditor(row = null) {
    setError(null)
    setNotice('')
    setEditor({
      id: row?.[idField] ?? null,
      values: Object.fromEntries(fields.map(field => [field.name, String(row?.[field.name] ?? field.options?.[0][0] ?? '')])),
    })
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ block: 'nearest' })
      formRef.current?.querySelector('input, select')?.focus()
    })
  }

  async function submit(event) {
    event.preventDefault()
    if (!canWrite || saving.current) return
    setError(null)
    let body
    try { body = toPayload(editor.values) } catch (failure) {
      setError(failure)
      return
    }
    saving.current = true
    setPending(true)
    try {
      await request(editor.id === null ? endpoint : `${endpoint}/${editor.id}`, {
        method: editor.id === null ? 'POST' : 'PUT', body,
      })
      setNotice(editor.id === null ? 'Registro creado correctamente.' : 'Cambios guardados correctamente.')
      setEditor(null)
      setRevision(value => value + 1)
    } catch (failure) {
      setError(failure)
    } finally {
      saving.current = false
      setPending(false)
    }
  }

  return <>
    <div className="d-flex justify-content-between align-items-center gap-3 mb-3">
      <h1 className="h4 mb-0">{title}</h1>
      {canWrite && <button type="button" className="btn btn-primary" disabled={pending || editor !== null} onClick={() => openEditor()}>Nuevo</button>}
    </div>
    {notice && <p className="alert alert-success" role="status">{notice}</p>}
    {canWrite && editor && <form ref={formRef} className="card card-body mb-4" onSubmit={submit} aria-busy={pending}>
      <h2 className="h5">{editor.id === null ? 'Nuevo registro' : 'Editar registro'}</h2>
      {error && <p className="alert alert-danger" role="alert">{error.message}{error.code && ` (${error.code})`}</p>}
      <fieldset disabled={pending}>
        <div className="row g-3">
          <CatalogFields fields={fields} values={editor.values} idField={idField} onChange={values => setEditor(current => ({ ...current, values }))} />
        </div>
        <div className="d-flex gap-2 mt-3">
          <button className="btn btn-primary" type="submit">{pending ? 'Guardando…' : 'Guardar'}</button>
          <button className="btn btn-outline-secondary" type="button" onClick={() => { setEditor(null); setError(null) }}>Cancelar</button>
        </div>
      </fieldset>
    </form>}
    <CatalogTable key={revision} endpoint={endpoint} title={title} columns={columns} idField={idField}
      onEdit={canWrite ? openEditor : undefined} actionsDisabled={pending || editor !== null} />
  </>
}

export function CatalogFields({ fields, values, idField, onChange }) {
  return fields.map(field => {
    if (field.location) return field.name === 'departamento'
      ? <LocationFields key={field.name} values={values} prefix={idField} onChange={onChange} />
      : null
    const id = `${idField}-${field.name}`
    const props = {
      id, name: field.name, required: true, value: values[field.name],
      onChange: event => onChange({ ...values, [field.name]: event.target.value }),
    }
    return <div className="col-12 col-md-6" key={field.name}>
      <label className="form-label" htmlFor={id}>{field.label}</label>
      {field.options
        ? <select {...props} className="form-select">{field.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        : <input {...props} className="form-control" type={field.type ?? 'text'} maxLength={field.maxBytes} min={field.type === 'number' ? 0 : undefined} step={field.type === 'number' ? 'any' : undefined} />}
    </div>
  })
}
