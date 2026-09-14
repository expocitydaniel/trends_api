import { useEffect, useState } from 'react'
import { api, type AlertRule, type DatasetAlert } from '../api'
import { formatEpoch } from '../utils'

export function ExportPage() {
  const [rules, setRules] = useState<AlertRule[]>([])
  const [ruleId, setRuleId] = useState('')
  const [feedback, setFeedback] = useState('')
  const [labeledOnly, setLabeledOnly] = useState(true)
  const [count, setCount] = useState(0)
  const [mix, setMix] = useState<Record<string, number>>({})
  const [sample, setSample] = useState<DatasetAlert[]>([])
  const [dataDir, setDataDir] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const preview = await api.exportPreview({
        alert_rule_id: ruleId || undefined,
        feedback: feedback || undefined,
        labeled_only: labeledOnly,
      })
      setCount(preview.count)
      setMix(preview.label_mix || {})
      setSample(preview.sample || [])
      setDataDir(preview.data_dir)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    ;(async () => {
      try {
        const data = await api.rules()
        setRules(data.alert_rules || [])
      } catch {
        /* optional */
      }
      await refresh()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const downloadUrl = api.exportDownloadUrl({
    alert_rule_id: ruleId || undefined,
    feedback: feedback || undefined,
    labeled_only: labeledOnly,
  })

  const totalLabeled =
    (mix.like || 0) + (mix.dislike || 0) + (mix.neutral || 0)
  const unbalanced =
    totalLabeled > 0 &&
    Math.max(mix.like || 0, mix.dislike || 0, mix.neutral || 0) / totalLabeled > 0.8

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h2>Export training dataset</h2>
          <p className="muted">JSONL manifest + images zip for later ML training.</p>
        </div>

        <div className="form">
          <div className="grid two">
            <label>
              Rule
              <select value={ruleId} onChange={(e) => setRuleId(e.target.value)}>
                <option value="">All rules</option>
                {rules.map((r) => (
                  <option key={r.alert_rule_id} value={r.alert_rule_id}>
                    {r.query_text || r.alert_rule_id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Label filter
              <select value={feedback} onChange={(e) => setFeedback(e.target.value)}>
                <option value="">Any</option>
                <option value="like">like</option>
                <option value="neutral">neutral</option>
                <option value="dislike">dislike</option>
              </select>
            </label>
          </div>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={labeledOnly}
              onChange={(e) => setLabeledOnly(e.target.checked)}
            />
            Labeled only
          </label>

          <div className="row">
            <button type="button" className="btn" onClick={() => void refresh()} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh preview'}
            </button>
            <a className="btn primary" href={downloadUrl}>
              Download zip
            </a>
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Label mix</h2>
          <span className="pill muted">{count} rows</span>
        </div>
        <div className="label-mix large">
          <span className="like">Like {mix.like ?? 0}</span>
          <span className="neutral">Neutral {mix.neutral ?? 0}</span>
          <span className="dislike">Dislike {mix.dislike ?? 0}</span>
          {!labeledOnly && <span className="muted">Unlabeled {mix.unlabeled ?? 0}</span>}
        </div>
        {unbalanced && (
          <p className="warn-text">
            Label mix looks unbalanced (&gt;80% one class). Consider more diverse labels.
          </p>
        )}
        {dataDir && (
          <p className="muted">
            Local data folder: <code>{dataDir}</code>
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Sample rows</h2>
        </div>
        {sample.length === 0 ? (
          <p className="muted">No rows match. Label some alerts first.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Alert</th>
                  <th>Query</th>
                  <th>Label</th>
                  <th>Time</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {sample.map((row) => (
                  <tr key={row.alert_id}>
                    <td>
                      <code>{row.alert_id}</code>
                    </td>
                    <td>{row.query_text}</td>
                    <td>
                      <span className={`pill ${row.feedback || 'muted'}`}>
                        {row.feedback || '—'}
                      </span>
                    </td>
                    <td>{formatEpoch(row.timestamp)}</td>
                    <td>{row.score ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
