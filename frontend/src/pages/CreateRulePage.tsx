import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Camera, type Category, type AlertRule } from '../api'

export function CreateRulePage() {
  const navigate = useNavigate()
  const [categories, setCategories] = useState<Category[]>([])
  const [cameras, setCameras] = useState<Camera[]>([])
  const [categoryId, setCategoryId] = useState('')
  const [queryText, setQueryText] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState('medium')
  const [selectedCameras, setSelectedCameras] = useState<string[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<AlertRule | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const [cats, cams] = await Promise.all([
          api.categories(search || undefined),
          api.cameras(),
        ])
        setCategories(cats.alert_categories || [])
        setCameras(cams.cameras || [])
        if (!categoryId && cats.alert_categories?.[0]) {
          setCategoryId(cats.alert_categories[0].alert_category_id)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [search])

  function toggleCamera(id: string) {
    setSelectedCameras((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    )
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const form = new FormData()
      form.append('category_id', categoryId)
      if (queryText.trim()) form.append('query_text', queryText.trim())
      if (description.trim()) form.append('description', description.trim())
      form.append('severity', severity)
      form.append('status', 'active')
      form.append('wait_for_preprocess', 'true')
      selectedCameras.forEach((id) => form.append('camera_ids', id))
      if (file) form.append('file', file)
      const result = await api.createRule(form)
      setCreated(result.rule)
      if (result.rule?.is_preprocessed) {
        setTimeout(() => navigate('/collect'), 800)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h2>Create Trends rule</h2>
          <p className="muted">Uses an existing category. Categories cannot be created here.</p>
        </div>

        <form className="form" onSubmit={onSubmit}>
          <label>
            Category search
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter categories…"
            />
          </label>

          <label>
            Category
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              required
            >
              {categories.length === 0 && <option value="">No categories</option>}
              {categories.map((c) => (
                <option key={c.alert_category_id} value={c.alert_category_id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Visual condition (query text)
            <textarea
              rows={3}
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="person without a safety helmet"
            />
          </label>

          <label className="dropzone">
            Or drop a reference image
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            {file && <span className="pill muted">{file.name}</span>}
          </label>

          <label>
            Description
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </label>

          <label>
            Severity
            <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="critical">critical</option>
            </select>
          </label>

          <fieldset>
            <legend>Camera scope (optional — empty = all enabled)</legend>
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

          <div className="row">
            <button className="btn primary" type="submit" disabled={loading || !categoryId}>
              {loading ? 'Creating & preprocessing…' : 'Create rule'}
            </button>
          </div>
        </form>
      </section>

      {created && (
        <section className="panel">
          <div className="panel-head">
            <h2>Rule created</h2>
            <span className={`pill ${created.is_preprocessed ? 'ok' : 'warn'}`}>
              {created.is_preprocessed ? 'Ready' : 'Still preprocessing'}
            </span>
          </div>
          <p>
            <code>{created.alert_rule_id}</code>
          </p>
          <p>{created.query_text}</p>
        </section>
      )}
    </div>
  )
}
