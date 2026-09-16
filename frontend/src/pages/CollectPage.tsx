import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, type AlertRule, type CollectDiagnostics, type DatasetAlert } from '../api'
import { datetimeLocalToEpoch, epochToDatetimeLocal, formatEpoch, presetRange, scorePct } from '../utils'

type HitRow = { timestamp: number; value: number }

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
    diagnostics?: CollectDiagnostics
  } | null>(null)
  const [alerts, setAlerts] = useState<DatasetAlert[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hits, setHits] = useState<HitRow[]>([])
  const [totalHits, setTotalHits] = useState<number | null>(null)
  const [hitsLoading, setHitsLoading] = useState(false)
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

  const selected = rules.find((r) => r.alert_rule_id === ruleId)
  const selectedAlert = alerts.find((a) => a.alert_id === selectedId) || alerts[0] || null

  useEffect(() => {
    if (!selectedAlert) {
      setHits([])
      setTotalHits(null)
      return
    }
    let cancelled = false
    setHitsLoading(true)
    setHits([])
    setTotalHits(null)
    ;(async () => {
      try {
        const data = await api.hits(selectedAlert.alert_id)
        if (!cancelled) {
          setHits(data.hits || [])
          setTotalHits(data.total_hits)
        }
      } catch {
        if (!cancelled) {
          setHits([])
          setTotalHits(null)
        }
      } finally {
        if (!cancelled) setHitsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedAlert?.alert_id])

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
    setAlerts([])
    setSelectedId(null)
    try {
      const data = await api.collect({
        alert_rule_id: ruleId,
        from_timestamp: from,
        to_timestamp: to,
        download_images: true,
      })
      let collected = data.alerts || []
      if (!collected.length && data.alerts_collected > 0) {
        const listed = await api.datasetAlerts({
          alert_rule_id: ruleId,
          from_timestamp: from,
          to_timestamp: to,
        })
        collected = listed.alerts || []
      }
      setResult(data)
      setAlerts(collected)
      setSelectedId(collected[0]?.alert_id ?? null)
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
            <button className="btn primary" onClick={() => navigate(`/label?rule=${encodeURIComponent(ruleId)}`)}>
              Start labeling
            </button>
            <Link className="btn ghost" to="/export">
              Go to export
            </Link>
          </div>
        </section>
      )}

      {result && (
        <section className="panel">
          <div className="panel-head">
            <h2>Collected alerts</h2>
            <span className="pill muted">{alerts.length} shown</span>
          </div>
          {alerts.length === 0 ? (
            <p className="muted">No alerts were stored for this window.</p>
          ) : (
            <div className="alert-browser">
              <div className="alert-list" role="list">
                {alerts.map((alert) => {
                  const active = selectedAlert?.alert_id === alert.alert_id
                  return (
                    <button
                      key={alert.alert_id}
                      type="button"
                      role="listitem"
                      className={`alert-row ${active ? 'selected' : ''}`}
                      onClick={() => setSelectedId(alert.alert_id)}
                    >
                      <div className="alert-thumb">
                        {alert.media_url ? (
                          <img src={alert.media_url} alt="" />
                        ) : (
                          <span>No image</span>
                        )}
                      </div>
                      <div className="alert-row-body">
                        <strong>{alert.camera_name || alert.camera_id || 'Unknown camera'}</strong>
                        <span className="muted">{formatEpoch(alert.timestamp)}</span>
                        <div className="meta-row">
                          <span className="chip">score {scorePct(alert.score)}</span>
                          <span className="chip">hits {alert.hits ?? '—'}</span>
                          <span className={`pill ${alert.media_url ? 'ok' : 'warn'}`}>
                            {alert.media_url ? 'cached' : 'missing'}
                          </span>
                          {alert.feedback && (
                            <span className={`pill ${alert.feedback}`}>{alert.feedback}</span>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>

              {selectedAlert && (
                <article className="alert-detail">
                  <div className="alert-detail-image">
                    {selectedAlert.media_url ? (
                      <img src={selectedAlert.media_url} alt={selectedAlert.alert_id} />
                    ) : (
                      <div className="image-missing">
                        {selectedAlert.image_error || 'Image not cached (media may have expired)'}
                      </div>
                    )}
                  </div>
                  <h3>{selectedAlert.query_text || 'Alert'}</h3>
                  <dl className="alert-dl">
                    <div>
                      <dt>Alert ID</dt>
                      <dd>
                        <code>{selectedAlert.alert_id}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Document</dt>
                      <dd>
                        <code>{selectedAlert.document_id || '—'}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Camera</dt>
                      <dd>
                        {selectedAlert.camera_name || '—'}
                        {selectedAlert.camera_id ? (
                          <span className="muted"> · {selectedAlert.camera_id}</span>
                        ) : null}
                      </dd>
                    </div>
                    <div>
                      <dt>Time</dt>
                      <dd>{formatEpoch(selectedAlert.timestamp)}</dd>
                    </div>
                    <div>
                      <dt>Score</dt>
                      <dd>{scorePct(selectedAlert.score)}</dd>
                    </div>
                    <div>
                      <dt>Hits</dt>
                      <dd>{selectedAlert.hits ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>{selectedAlert.status || '—'}</dd>
                    </div>
                    <div>
                      <dt>Category</dt>
                      <dd>{selectedAlert.category_name || selectedAlert.category_id || '—'}</dd>
                    </div>
                    <div>
                      <dt>Label</dt>
                      <dd>
                        {selectedAlert.feedback ? (
                          <span className={`pill ${selectedAlert.feedback}`}>
                            {selectedAlert.feedback}
                          </span>
                        ) : (
                          <span className="muted">unlabeled</span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Image</dt>
                      <dd>
                        {selectedAlert.media_url
                          ? 'Cached locally'
                          : selectedAlert.image_error || 'Not cached'}
                      </dd>
                    </div>
                  </dl>

                  <div className="alert-hits">
                    <div className="panel-head">
                      <h3>Hit timeline</h3>
                      <span className="pill muted">total {totalHits ?? selectedAlert.hits ?? '—'}</span>
                    </div>
                    {hitsLoading ? (
                      <p className="muted">Loading hits…</p>
                    ) : hits.length === 0 ? (
                      <p className="muted">No later hits for this alert.</p>
                    ) : (
                      <>
                        <ul className="hit-list">
                          {hits.map((h) => (
                            <li key={`${h.timestamp}-${h.value}`}>
                              <span>{formatEpoch(h.timestamp)}</span>
                              <strong>+{h.value}</strong>
                            </li>
                          ))}
                        </ul>
                        <div className="sparkline">
                          {hits.map((h, i) => (
                            <div
                              key={`${h.timestamp}-${i}`}
                              className="spark-bar"
                              style={{ height: `${Math.min(100, 20 + h.value * 15)}%` }}
                              title={`${formatEpoch(h.timestamp)} (+${h.value})`}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </article>
              )}
            </div>
          )}
        </section>
      )}

      {result?.diagnostics && (
        <section
          className={`panel collect-log ${
            result.diagnostics.verdict === 'ok'
              ? 'ok'
              : result.diagnostics.verdict === 'no_data'
                ? 'warn'
                : 'bad'
          }`}
        >
          <strong>
            {result.diagnostics.verdict === 'no_data'
              ? 'No alerts in Central Brain'
              : result.diagnostics.verdict === 'parse_mismatch'
                ? 'Response shape mismatch'
                : 'Collect log'}
          </strong>
          <p>{result.diagnostics.message}</p>
          <pre>
            {JSON.stringify(
              {
                verdict: result.diagnostics.verdict,
                cb_count: result.diagnostics.cb_count,
                cb_hits: result.diagnostics.cb_hits,
                from: result.diagnostics.from_iso_utc,
                to: result.diagnostics.to_iso_utc,
                alert_rule_type: result.diagnostics.alert_rule_type,
                base_url: result.diagnostics.base_url,
                skipped_no_id: result.diagnostics.skipped_no_id,
                pages: result.diagnostics.pages,
                log_file: result.diagnostics.log_file,
              },
              null,
              2,
            )}
          </pre>
        </section>
      )}
    </div>
  )
}
