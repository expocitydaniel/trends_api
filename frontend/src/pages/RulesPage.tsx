import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type AlertRule, type Camera, type Category } from '../api'

const RULE_TYPES = ['user', 'wordmap', 'test'] as const
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const

function titleCase(value?: string | null) {
  if (!value) return '—'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function eligibleCount(rule: AlertRule): number {
  if (typeof rule.eligible_count === 'number') return rule.eligible_count
  if (typeof rule.n_eligible === 'number') return rule.n_eligible
  if (typeof rule.eligible === 'number') return rule.eligible
  if (Array.isArray(rule.eligible)) return rule.eligible.length
  return 0
}

function scopeParts(rule: AlertRule) {
  const cameras = rule.camera_ids?.filter(Boolean) ?? []
  const groups = rule.camera_group_ids?.filter(Boolean) ?? []
  const clusters = rule.cluster_ids?.filter(Boolean) ?? []
  const parts: string[] = []
  if (clusters.length) {
    parts.push(`${clusters.length} cluster${clusters.length === 1 ? '' : 's'}`)
  }
  if (groups.length) {
    parts.push(`${groups.length} group${groups.length === 1 ? '' : 's'}`)
  }
  if (cameras.length) {
    parts.push(`${cameras.length} camera${cameras.length === 1 ? '' : 's'}`)
  }
  return {
    cameras,
    groups,
    clusters,
    label: parts.length ? parts.join(' + ') : 'all cameras',
    hasDetails: cameras.length + groups.length + clusters.length > 0,
  }
}

function ScopeCell({
  rule,
  cameras,
}: {
  rule: AlertRule
  cameras: Camera[]
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const scope = scopeParts(rule)
  const cameraNames = useMemo(() => {
    const byId = new Map(cameras.map((c) => [c.camera_id, c.name || c.camera_id]))
    return scope.cameras.map((id) => byId.get(id) || id)
  }, [cameras, scope.cameras])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (!scope.hasDetails) {
    return <span className="scope-plain">all cameras</span>
  }

  return (
    <div className="scope-wrap" ref={wrapRef}>
      <button
        type="button"
        className="scope-toggle"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        {scope.label}
        <span className="scope-caret">▾</span>
      </button>
      {open && (
        <div className="scope-pop" onClick={(e) => e.stopPropagation()}>
          {cameraNames.length > 0 && (
            <>
              <div className="scope-pop-label">Cameras</div>
              <ul>
                {cameraNames.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </>
          )}
          {scope.clusters.length > 0 && (
            <>
              <div className="scope-pop-label">Clusters</div>
              <ul>
                {scope.clusters.map((id) => (
                  <li key={id}>{id}</li>
                ))}
              </ul>
            </>
          )}
          {scope.groups.length > 0 && (
            <>
              <div className="scope-pop-label">Groups</div>
              <ul>
                {scope.groups.map((id) => (
                  <li key={id}>{id}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function RulesPage() {
  const navigate = useNavigate()
  const [rules, setRules] = useState<AlertRule[]>([])
  const [count, setCount] = useState(0)
  const [categories, setCategories] = useState<Category[]>([])
  const [cameras, setCameras] = useState<Camera[]>([])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [severity, setSeverity] = useState('')
  const [ruleType, setRuleType] = useState('test')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 280)
    return () => window.clearTimeout(t)
  }, [search])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [cats, cams] = await Promise.all([api.categories(), api.cameras()])
        if (cancelled) return
        setCategories(cats.alert_categories || [])
        setCameras(cams.cameras || [])
      } catch {
        /* table still works without lookup data */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.rules({
        search: debouncedSearch || undefined,
        status: status || undefined,
        severity: severity || undefined,
        category_id: categoryId || undefined,
        alert_rule_type: ruleType || undefined,
      })
      setRules(data.alert_rules || [])
      setCount(data.count ?? data.alert_rules?.length ?? 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, status, severity, categoryId, ruleType])

  function resetFilters() {
    setSearch('')
    setDebouncedSearch('')
    setCategoryId('')
    setSeverity('')
    setRuleType('')
    setStatus('')
  }

  const filtersActive = Boolean(
    search || categoryId || severity || ruleType || status,
  )

  return (
    <div className="stack rules-page">
      <section className="panel rules-panel">
        <div className="rules-head">
          <div>
            <h2>Alert Rules</h2>
            <p className="muted rules-sub">
              {count} {count === 1 ? 'rule' : 'rules'} · filter by type; test
              rules also record dropped candidates
            </p>
          </div>
          <div className="row wrap">
            <button className="btn" type="button" onClick={() => void load()}>
              Refresh
            </button>
            <Link className="btn primary" to="/rules/new">
              New rule
            </Link>
          </div>
        </div>

        <div className="rules-filters">
          <input
            className="rules-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setDebouncedSearch(search.trim())
            }}
            placeholder="Search query..."
          />
          <select
            className={categoryId ? 'filter-select active' : 'filter-select'}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.alert_category_id} value={c.alert_category_id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            className={severity ? 'filter-select active' : 'filter-select'}
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
          >
            <option value="">All Severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </select>
          <select
            className={ruleType ? 'filter-select active' : 'filter-select'}
            value={ruleType}
            onChange={(e) => setRuleType(e.target.value)}
          >
            <option value="">All types</option>
            {RULE_TYPES.map((t) => (
              <option key={t} value={t}>
                type: {t}
              </option>
            ))}
          </select>
          <select
            className={status ? 'filter-select active' : 'filter-select'}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All Statuses</option>
            <option value="active">active</option>
            <option value="paused">paused</option>
          </select>
          <button
            className="btn ghost"
            type="button"
            onClick={resetFilters}
            disabled={!filtersActive}
          >
            Reset all
          </button>
        </div>

        {error && <p className="error-text">{error}</p>}

        <div className="table-wrap rules-table-wrap">
          <table className="rules-table">
            <thead>
              <tr>
                <th>Query</th>
                <th>Type</th>
                <th>Category</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Scope</th>
                <th className="num">Eligible</th>
              </tr>
            </thead>
            <tbody>
              {loading && rules.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    Loading rules…
                  </td>
                </tr>
              )}
              {!loading && rules.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No alert rules found.
                  </td>
                </tr>
              )}
              {rules.map((rule) => {
                const categoryName =
                  rule.category?.name || (rule.category_id ? rule.category_id : null)
                const color = rule.category?.color || '#3dd68c'
                return (
                  <tr
                    key={rule.alert_rule_id}
                    className="rules-row"
                    onClick={() => navigate(`/rules/${rule.alert_rule_id}`)}
                  >
                    <td>
                      <div className="rule-query">
                        {rule.query_text || rule.alert_rule_id}
                      </div>
                      {rule.description && (
                        <div className="rule-desc">{rule.description}</div>
                      )}
                      <div className="rule-id">{rule.alert_rule_id}</div>
                    </td>
                    <td>
                      <span className="type-badge">
                        {rule.alert_rule_type || 'test'}
                      </span>
                    </td>
                    <td>
                      {categoryName ? (
                        <span className="category-cell">
                          <span
                            className="category-dot"
                            style={{ background: color }}
                          />
                          {categoryName}
                        </span>
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </td>
                    <td>{titleCase(rule.severity)}</td>
                    <td>
                      <span
                        className={`status-text ${
                          rule.status === 'paused' ? 'paused' : 'active'
                        }`}
                      >
                        {rule.status || 'unknown'}
                      </span>
                    </td>
                    <td>
                      <ScopeCell rule={rule} cameras={cameras} />
                    </td>
                    <td className="num">{eligibleCount(rule)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="rules-foot muted">
          Showing {rules.length} of {count}
        </div>
      </section>
    </div>
  )
}
