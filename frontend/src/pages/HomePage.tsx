import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Health, type Stats } from '../api'

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
          <h2>Dataset</h2>
          <span className={`pill ${stats?.export_ready ? 'ok' : 'muted'}`}>
            {stats?.export_ready ? 'Export ready' : 'Collect & label first'}
          </span>
        </div>
        <div className="grid stats-grid">
          <div className="stat">
            <span className="stat-label">Cached alerts</span>
            <strong>{stats?.alerts ?? 0}</strong>
          </div>
          <div className="stat">
            <span className="stat-label">Labeled</span>
            <strong>{stats?.labeled ?? 0}</strong>
          </div>
          <div className="stat">
            <span className="stat-label">Unlabeled</span>
            <strong>{stats?.unlabeled ?? 0}</strong>
          </div>
          <div className="stat">
            <span className="stat-label">Images</span>
            <strong>{stats?.images_cached ?? 0}</strong>
          </div>
        </div>
        <div className="label-mix">
          <span className="like">Like {stats?.by_label.like ?? 0}</span>
          <span className="neutral">Neutral {stats?.by_label.neutral ?? 0}</span>
          <span className="dislike">Dislike {stats?.by_label.dislike ?? 0}</span>
        </div>
      </section>

      <section className="action-grid">
        <Link className="action-card" to="/rules/new">
          <h3>New rule</h3>
          <p>Create a Trends alert rule for the condition you want to train on.</p>
        </Link>
        <Link className="action-card" to="/collect">
          <h3>Collect</h3>
          <p>Pull alerts for a rule and time window, cache images locally.</p>
        </Link>
        <Link className="action-card primary" to="/label">
          <h3>Label</h3>
          <p>Keyboard-first labeling with J / K / L for like / neutral / dislike.</p>
        </Link>
        <Link className="action-card" to="/export">
          <h3>Export</h3>
          <p>Download JSONL + images for ML training.</p>
        </Link>
      </section>
    </div>
  )
}
