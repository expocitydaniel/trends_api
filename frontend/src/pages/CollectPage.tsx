import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, type AlertRule } from '../api'
import { datetimeLocalToEpoch, epochToDatetimeLocal, formatEpoch, presetRange } from '../utils'

export function CollectPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const requestedRule = searchParams.get('rule') || ''
  const [rules, setRules] = useState<AlertRule[]>([])
  const [ruleId, setRuleId] = useState(requestedRule)
  const [from, setFrom] = useState(() => presetRange('24h').from)
  const [to, setTo] = useState(() => presetRange('24h').to)
  const [preview, setPreview] = useState<{ count: number; hits: number } | null>(null)
  const [result, setResult] = useState<{
    pages_fetched: number
    alerts_collected: number
    images_cached: number
    images_missing: number
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const data = await api.rules()
        setRules(data.alert_rules || [])
        const ids = (data.alert_rules || []).map((r) => r.alert_rule_id)
        if (requestedRule && ids.includes(requestedRule)) {
          setRuleId(requestedRule)
        } else if (!requestedRule && data.alert_rules?.[0]) {
          setRuleId(data.alert_rules[0].alert_rule_id)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [])

  function applyPreset(preset: '1h' | '24h' | '7d') {
    const range = presetRange(preset)
    setFrom(range.from)
    setTo(range.to)
    setPreview(null)
  }

  async function onPreview() {
    if (!ruleId) return
    setPreviewing(true)
    setError(null)
    try {
      const data = await api.alertCount(ruleId, from, to)
      setPreview(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPreviewing(false)
    }
  }

  async function onCollect(e: FormEvent) {
    e.preventDefault()
    if (!ruleId) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const data = await api.collect({
        alert_rule_id: ruleId,
        from_timestamp: from,
        to_timestamp: to,
        download_images: true,
      })
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const selected = rules.find((r) => r.alert_rule_id === ruleId)

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h2>Collect alerts</h2>
          <p className="muted">One Trends rule + inclusive time range. Images are cached by the BFF.</p>
        </div>

        <form className="form" onSubmit={onCollect}>
          <label>
            Trends rule
            <select value={ruleId} onChange={(e) => setRuleId(e.target.value)} required>
              {rules.length === 0 && <option value="">No rules yet</option>}
              {rules.map((r) => (
                <option key={r.alert_rule_id} value={r.alert_rule_id}>
                  {r.query_text || r.alert_rule_id}
                </option>
              ))}
            </select>
          </label>

          {selected && (
            <div className="meta-row">
              <span className="chip">{selected.category?.name || selected.category_id}</span>
              <span className={`pill ${selected.is_preprocessed ? 'ok' : 'warn'}`}>
                {selected.is_preprocessed ? 'preprocessed' : 'not ready'}
              </span>
              <span className="pill muted">{selected.status}</span>
            </div>
          )}

          <div className="row wrap">
            <button type="button" className="btn ghost" onClick={() => applyPreset('1h')}>
              Last 1h
            </button>
            <button type="button" className="btn ghost" onClick={() => applyPreset('24h')}>
              Last 24h
            </button>
            <button type="button" className="btn ghost" onClick={() => applyPreset('7d')}>
              Last 7d
            </button>
          </div>

          <div className="grid two">
            <label>
              From
              <input
                className="datetime"
                type="datetime-local"
                value={epochToDatetimeLocal(from)}
                onChange={(e) => {
                  setFrom(datetimeLocalToEpoch(e.target.value))
                  setPreview(null)
                }}
                required
              />
              <span className="hint">{formatEpoch(from)}</span>
            </label>
            <label>
              To
              <input
                className="datetime"
                type="datetime-local"
                value={epochToDatetimeLocal(to)}
                onChange={(e) => {
                  setTo(datetimeLocalToEpoch(e.target.value))
                  setPreview(null)
                }}
                required
              />
              <span className="hint">{formatEpoch(to)}</span>
            </label>
          </div>

          <div className="row">
            <button type="button" className="btn" onClick={onPreview} disabled={!ruleId || previewing}>
              {previewing ? 'Counting…' : 'Preview count'}
            </button>
            <button type="submit" className="btn primary" disabled={!ruleId || loading}>
              {loading ? 'Collecting…' : 'Collect & cache images'}
            </button>
          </div>
        </form>

        {preview && (
          <div className="preview-box">
            <strong>{preview.count}</strong> alerts · <strong>{preview.hits}</strong> hits in window
          </div>
        )}

        {error && <p className="error-text">{error}</p>}
      </section>

      {result && (
        <section className="panel success">
          <div className="panel-head">
            <h2>Collection complete</h2>
          </div>
          <div className="grid stats-grid">
            <div className="stat">
              <span className="stat-label">Pages</span>
              <strong>{result.pages_fetched}</strong>
            </div>
            <div className="stat">
              <span className="stat-label">Alerts</span>
              <strong>{result.alerts_collected}</strong>
            </div>
            <div className="stat">
              <span className="stat-label">Images cached</span>
              <strong>{result.images_cached}</strong>
            </div>
            <div className="stat">
              <span className="stat-label">Missing (404)</span>
              <strong>{result.images_missing}</strong>
            </div>
          </div>
          <div className="row">
            <button className="btn primary" onClick={() => navigate('/label')}>
              Start labeling
            </button>
            <Link className="btn ghost" to="/export">
              Go to export
            </Link>
          </div>
        </section>
      )}
    </div>
  )
}
