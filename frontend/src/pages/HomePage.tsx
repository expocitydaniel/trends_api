import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Dataset, type Health, type Stats } from '../api'
import { formatRange } from '../utils'

export function HomePage() {
  const [health, setHealth] = useState<Health | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [h, s] = await Promise.all([api.health(), api.stats()])
        if (!cancelled) {
          setHealth(h)
          setStats(s)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) return <div className="panel empty">Checking connection…</div>
  if (error)
    return (
      <div className="panel error">
        <h2>BFF unreachable</h2>
        <p>{error}</p>
        <p className="muted">Start the backend on port 8080, then refresh.</p>
      </div>
    )

  const ok = health?.central_brain_reachable
  const datasets: Dataset[] = stats?.dataset_summaries || []

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h2>Connection</h2>
          <span className={`pill ${ok ? 'ok' : health?.configured ? 'warn' : 'bad'}`}>
            {ok ? 'Central Brain reachable' : health?.configured ? 'Configured, unreachable' : 'Not configured'}
          </span>
        </div>
        <div className="grid stats-grid">
          <div className="stat">
            <span className="stat-label">BFF</span>
            <strong>{health?.bff === 'ok' ? 'Up' : 'Down'}</strong>
          </div>
          <div className="stat">
            <span className="stat-label">Base URL</span>
            <strong>{health?.base_url_set ? 'Set' : 'Missing'}</strong>
          </div>
          <div className="stat">
            <span className="stat-label">API key</span>
            <strong>{health?.api_key_present ? 'Present' : 'Missing'}</strong>
          </div>
          <div className="stat">
            <span className="stat-label">Reachable</span>
            <strong>{health?.central_brain_reachable ? 'Yes' : 'No'}</strong>
          </div>
        </div>
        {health?.central_brain_error && (
          <p className="error-text">{health.central_brain_error}</p>
        )}
        {!health?.configured && (
          <p className="muted">
            Copy <code>.env.example</code> to <code>.env</code> and set the Central Brain
            URL and key. The key never appears in the browser.
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Training datasets</h2>
          <span className={`pill ${datasets.some((d) => d.stats?.export_ready) ? 'ok' : 'muted'}`}>
            {datasets.length} window{datasets.length === 1 ? '' : 's'}
          </span>
        </div>
        <p className="muted">
          Each dataset is one alert rule and one timestamp range. Label and export stay inside that
          slice so classes are not mixed.
        </p>
        {datasets.length === 0 ? (
          <div className="empty-inline">
            <p className="muted">No collected windows yet. Collect a rule and time range first.</p>
            <Link className="btn primary" to="/collect">
              Collect a window
            </Link>
          </div>
        ) : (
          <div className="dataset-grid">
            {datasets.map((ds) => (
              <article key={ds.dataset_id} className="dataset-card">
                <h3>{ds.query_text || ds.alert_rule_id}</h3>
                <p className="muted">{formatRange(ds.from_timestamp, ds.to_timestamp)}</p>
                <div className="meta-row">
                  {ds.category_name && <span className="chip">{ds.category_name}</span>}
                  <span className="chip">{ds.stats?.alerts ?? 0} alerts</span>
                  <span className="chip">{ds.stats?.labeled ?? 0} labeled</span>
                  <span className={`pill ${ds.stats?.export_ready ? 'ok' : 'muted'}`}>
                    {ds.stats?.export_ready ? 'export ready' : 'needs labels'}
                  </span>
                </div>
                <div className="label-mix">
                  <span className="like">Like {ds.stats?.by_label.like ?? 0}</span>
                  <span className="neutral">Neutral {ds.stats?.by_label.neutral ?? 0}</span>
                  <span className="dislike">Dislike {ds.stats?.by_label.dislike ?? 0}</span>
                </div>
                <div className="row wrap">
                  <Link className="btn" to={`/label?dataset=${encodeURIComponent(ds.dataset_id)}`}>
                    Label
                  </Link>
                  <Link className="btn primary" to={`/export?dataset=${encodeURIComponent(ds.dataset_id)}`}>
                    Export
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="action-grid">
        <Link className="action-card" to="/rules">
          <h3>Rules</h3>
          <p>Fetch, inspect, edit, or pause existing Trends alert rules.</p>
        </Link>
        <Link className="action-card" to="/rules/new">
          <h3>New rule</h3>
          <p>Create a Trends alert rule for the condition you want to train on.</p>
        </Link>
        <Link className="action-card" to="/collect">
          <h3>Collect</h3>
          <p>Pull alerts for one rule and time window, cache images locally.</p>
        </Link>
        <Link className="action-card primary" to="/label">
          <h3>Label</h3>
          <p>Label one collected window at a time. J / K / L for like / neutral / dislike.</p>
        </Link>
        <Link className="action-card" to="/export">
          <h3>Export</h3>
          <p>Download one rule+window zip with dataset.json, manifest, and images.</p>
        </Link>
      </section>
    </div>
  )
}
