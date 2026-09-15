import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, type AlertRule, type Camera, type Category } from '../api'

export function EditRulePage() {
  const { ruleId } = useParams()
  const navigate = useNavigate()
  const [rule, setRule] = useState<AlertRule | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [cameras, setCameras] = useState<Camera[]>([])
  const [categoryId, setCategoryId] = useState('')
  const [queryText, setQueryText] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState('medium')
  const [status, setStatus] = useState<'active' | 'paused'>('active')
  const [selectedCameras, setSelectedCameras] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!ruleId) return
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const [loaded, cats, cams] = await Promise.all([
          api.getRule(ruleId),
          api.categories(),
          api.cameras(),
        ])
        setRule(loaded)
        setCategories(cats.alert_categories || [])
        setCameras(cams.cameras || [])
        setCategoryId(loaded.category_id || loaded.category?.alert_category_id || '')
        setQueryText(loaded.query_text || '')
        setDescription(loaded.description || '')
        setSeverity(loaded.severity || 'medium')
        setStatus(loaded.status === 'paused' ? 'paused' : 'active')
        setSelectedCameras(loaded.camera_ids || [])
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    })()
  }, [ruleId])

  function toggleCamera(id: string) {
    setSelectedCameras((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    )
  }

  async function onSave(e: FormEvent) {
    e.preventDefault()
    if (!ruleId) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const result = await api.updateRule(ruleId, {
        category_id: categoryId,
        query_text: queryText.trim() || undefined,
        description: description.trim() || undefined,
        severity,
        status,
        camera_ids: selectedCameras,
      })
      setRule(result.rule)
      setMessage(
        result.rule?.is_preprocessed
          ? 'Rule updated and ready.'
          : 'Rule updated. Preprocessing may still be running.',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="panel empty">Loading rule…</div>
  if (!rule) {
    return (
      <div className="panel error">
        <h2>Rule not found</h2>
        <p>{error || 'Use a Trends rule ID from the rules list.'}</p>
        <Link className="btn" to="/rules">
          Back to rules
        </Link>
      </div>
    )
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h2>Edit rule</h2>
          <span className={`pill ${rule.is_preprocessed ? 'ok' : 'warn'}`}>
            {rule.is_preprocessed ? 'preprocessed' : 'not ready'}
          </span>
        </div>
        <p className="muted">
          <code>{rule.alert_rule_id}</code>
        </p>
        <p className="muted">
          Changing query text restarts preprocessing. Rules cannot be deleted;
          pause them to stop new alerts.
        </p>

        <form className="form" onSubmit={onSave}>
          <label>
            Category
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              required
            >
              {categories.map((c) => (
                <option key={c.alert_category_id} value={c.alert_category_id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Visual condition
            <textarea
              rows={3}
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
            />
          </label>

          <label>
            Description
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <div className="grid two">
            <label>
              Severity
              <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </select>
            </label>
            <label>
              Status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'active' | 'paused')}
              >
                <option value="active">active</option>
                <option value="paused">paused</option>
              </select>
            </label>
          </div>

          <fieldset>
            <legend>Camera scope (empty = all enabled)</legend>
            <div className="chip-list">
              {cameras.map((cam) => (
                <button
                  type="button"
                  key={cam.camera_id}
                  className={`chip ${selectedCameras.includes(cam.camera_id) ? 'active' : ''}`}
                  onClick={() => toggleCamera(cam.camera_id)}
                >
                  {cam.name || cam.camera_id}
                </button>
              ))}
              {cameras.length === 0 && <span className="muted">No cameras loaded</span>}
            </div>
          </fieldset>

          {error && <p className="error-text">{error}</p>}
          {message && <p className="muted">{message}</p>}

          <div className="row wrap">
            <button className="btn primary" type="submit" disabled={saving || !categoryId}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <Link className="btn ghost" to="/rules">
              Back to list
            </Link>
            <button
              type="button"
              className="btn ghost"
              onClick={() => navigate(`/collect?rule=${encodeURIComponent(rule.alert_rule_id)}`)}
            >
              Collect alerts
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
