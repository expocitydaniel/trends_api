import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type AlertRule } from '../api'

export function RulesPage() {
  const [rules, setRules] = useState<AlertRule[]>([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load(nextSearch = search) {
    setLoading(true)
    setError(null)
    try {
      const data = await api.rules(nextSearch || undefined, status || undefined)
      setRules(data.alert_rules || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  async function toggleStatus(rule: AlertRule) {
    if (!rule.alert_rule_id) return
    const next = rule.status === 'paused' ? 'active' : 'paused'
    setBusyId(rule.alert_rule_id)
    setError(null)
    try {
      const result = await api.setRuleStatus(rule.alert_rule_id, next)
      setRules((prev) =>
        prev.map((r) =>
          r.alert_rule_id === rule.alert_rule_id ? { ...r, ...result.rule } : r,
        ),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h2>Trends rules</h2>
          <Link className="btn primary" to="/rules/new">
            New rule
          </Link>
        </div>
        <p className="muted">
          Fetch and inspect existing Trends rules, then edit or pause them. Rule
          deletion is not allowed by the Central Brain contract — pause a rule
          instead of deleting it.
        </p>

        <div className="row wrap" style={{ marginTop: '0.9rem' }}>
          <label className="inline">
            Search
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void load()
              }}
              placeholder="Query text…"
            />
          </label>
          <label className="inline">
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="active">active</option>
              <option value="paused">paused</option>
            </select>
          </label>
          <button className="btn" type="button" onClick={() => void load()}>
            Refresh
          </button>
        </div>

        {error && <p className="error-text">{error}</p>}
        {loading && <p className="muted">Loading rules…</p>}
        {!loading && rules.length === 0 && (
          <div className="empty" style={{ marginTop: '1rem' }}>
            No Trends rules found. Create one first.
          </div>
        )}
      </section>

      {rules.map((rule) => (
        <section className="panel" key={rule.alert_rule_id}>
          <div className="panel-head">
            <h3>{rule.query_text || rule.alert_rule_id}</h3>
            <div className="row wrap">
              <span className={`pill ${rule.status === 'active' ? 'ok' : 'warn'}`}>
                {rule.status || 'unknown'}
              </span>
              <span className={`pill ${rule.is_preprocessed ? 'ok' : 'warn'}`}>
                {rule.is_preprocessed ? 'preprocessed' : 'not ready'}
              </span>
            </div>
          </div>
          <p className="muted">
            <code>{rule.alert_rule_id}</code>
          </p>
          <div className="meta-row">
            <span className="chip">{rule.category?.name || rule.category_id || 'category'}</span>
            <span className="chip">{rule.severity || 'severity'}</span>
            {rule.camera_ids?.length ? (
              <span className="chip">{rule.camera_ids.length} cameras</span>
            ) : (
              <span className="chip">all cameras</span>
            )}
          </div>
          {rule.description && <p>{rule.description}</p>}
          <div className="row wrap" style={{ marginTop: '0.85rem' }}>
            <Link className="btn" to={`/rules/${rule.alert_rule_id}`}>
              Check / edit
            </Link>
            <Link className="btn ghost" to={`/collect?rule=${encodeURIComponent(rule.alert_rule_id)}`}>
              Collect
            </Link>
            <button
              type="button"
              className="btn ghost"
              disabled={busyId === rule.alert_rule_id}
              onClick={() => void toggleStatus(rule)}
            >
              {rule.status === 'paused' ? 'Resume' : 'Pause'}
            </button>
          </div>
        </section>
      ))}
    </div>
  )
}
