import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type Dataset, type DatasetAlert } from '../api'
import { formatEpoch, formatRange, scorePct } from '../utils'

type Filter = 'unlabeled' | 'all' | 'like' | 'dislike' | 'neutral'

function pickDataset(
  datasets: Dataset[],
  requestedDataset: string,
  requestedRule: string,
): string {
  if (requestedDataset && datasets.some((d) => d.dataset_id === requestedDataset)) {
    return requestedDataset
  }
  if (requestedRule) {
    const matches = datasets.filter((d) => d.alert_rule_id === requestedRule)
    if (matches[0]) return matches[0].dataset_id
  }
  return datasets.length === 1 ? datasets[0].dataset_id : ''
}

export function LabelPage() {
  const [searchParams] = useSearchParams()
  const requestedDataset = searchParams.get('dataset') || ''
  const requestedRule = searchParams.get('rule') || ''
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [datasetId, setDatasetId] = useState(requestedDataset)
  const [filter, setFilter] = useState<Filter>('unlabeled')
  const [alerts, setAlerts] = useState<DatasetAlert[]>([])
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncWarning, setSyncWarning] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [undoStack, setUndoStack] = useState<
    { alert_id: string; previous: DatasetAlert['feedback'] }[]
  >([])
  const [hitsOpen, setHitsOpen] = useState(false)
  const [hits, setHits] = useState<{ timestamp: number; value: number }[]>([])
  const [totalHits, setTotalHits] = useState<number | null>(null)

  const selected = datasets.find((d) => d.dataset_id === datasetId) || null

  const load = useCallback(async () => {
    if (!datasetId) {
      setAlerts([])
      setIndex(0)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const params: {
        dataset_id: string
        feedback?: string
        unlabeled_only?: boolean
      } = { dataset_id: datasetId }
      if (filter === 'unlabeled') params.unlabeled_only = true
      else if (filter !== 'all') params.feedback = filter
      const data = await api.datasetAlerts(params)
      setAlerts(data.alerts || [])
      setIndex(0)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [datasetId, filter])

  useEffect(() => {
    ;(async () => {
      try {
        const data = await api.datasets()
        const cached = data.datasets || []
        setDatasets(cached)
        setDatasetId((current) => pickDataset(cached, requestedDataset || current, requestedRule))
      } catch {
        /* dataset still loads without the list */
      }
    })()
  }, [requestedDataset, requestedRule])

  useEffect(() => {
    void load()
  }, [load])

  const current = alerts[index] || null

  const progress = useMemo(() => {
    if (!alerts.length) return '0 / 0'
    return `${index + 1} / ${alerts.length}`
  }, [alerts.length, index])

  const applyLabel = useCallback(
    async (feedback: 'like' | 'dislike' | 'neutral') => {
      if (!current || busy) return
      setBusy(true)
      const previous = current.feedback
      setAlerts((prev) =>
        prev.map((a, i) =>
          i === index ? { ...a, feedback, feedback_type: 'user' } : a,
        ),
      )
      try {
        const result = await api.feedback(current.alert_id, feedback)
        setSyncWarning(result.central_brain_error || null)
        setUndoStack((s) => [...s, { alert_id: current.alert_id, previous }])
        if (filter === 'unlabeled') {
          setAlerts((prev) => {
            const next = prev.filter((_, i) => i !== index)
            setIndex((i) => Math.min(i, Math.max(0, next.length - 1)))
            return next
          })
        } else {
          setIndex((i) => Math.min(i + 1, alerts.length - 1))
        }
      } catch (e) {
        setAlerts((prev) =>
          prev.map((a, i) => (i === index ? { ...a, feedback: previous } : a)),
        )
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [alerts.length, busy, current, filter, index],
  )

  const undo = useCallback(async () => {
    const last = undoStack[undoStack.length - 1]
    if (!last || busy) return
    setBusy(true)
    try {
      const result = await api.feedback(last.alert_id, last.previous ?? null)
      setSyncWarning(result.central_brain_error || null)
      setUndoStack((s) => s.slice(0, -1))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [busy, load, undoStack])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'j' || e.key === 'J') void applyLabel('like')
      if (e.key === 'k' || e.key === 'K') void applyLabel('neutral')
      if (e.key === 'l' || e.key === 'L') void applyLabel('dislike')
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault()
        setIndex((i) => Math.min(i + 1, Math.max(0, alerts.length - 1)))
      }
      if (e.key === 'ArrowLeft') {
        setIndex((i) => Math.max(i - 1, 0))
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        void undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [alerts.length, applyLabel, undo])

  async function openHits() {
    if (!current) return
    setHitsOpen(true)
    try {
      const data = await api.hits(current.alert_id)
      setHits(data.hits || [])
      setTotalHits(data.total_hits)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="stack">
      <section className="panel compact">
        <div className="row wrap between">
          <div className="row wrap">
            <label className="inline dataset-select">
              Training dataset
              <select value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
                <option value="">Select a rule + time window</option>
                {datasets.map((d) => (
                  <option key={d.dataset_id} value={d.dataset_id}>
                    {d.query_text || d.alert_rule_id} · {formatRange(d.from_timestamp, d.to_timestamp)}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline">
              Filter
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as Filter)}
                disabled={!datasetId}
              >
                <option value="unlabeled">Unlabeled</option>
                <option value="all">All</option>
                <option value="like">Like</option>
                <option value="neutral">Neutral</option>
                <option value="dislike">Dislike</option>
              </select>
            </label>
          </div>
          <div className="row">
            <span className="pill muted">{progress}</span>
            <button className="btn ghost" type="button" onClick={() => void load()} disabled={!datasetId}>
              Refresh
            </button>
          </div>
        </div>
        {selected && (
          <div className="meta-row">
            {selected.category_name && <span className="chip">{selected.category_name}</span>}
            <span className="chip">{selected.stats?.alerts ?? 0} in window</span>
            <span className="chip">{selected.stats?.labeled ?? 0} labeled</span>
            <Link className="btn ghost small" to={`/export?dataset=${encodeURIComponent(selected.dataset_id)}`}>
              Export this window
            </Link>
          </div>
        )}
      </section>

      {loading && <div className="panel empty">Loading alerts…</div>}
      {error && <p className="error-text">{error}</p>}
      {syncWarning && <p className="warn-text">{syncWarning}</p>}

      {!loading && !datasetId && (
        <div className="panel empty">
          <h2>Choose a training window</h2>
          <p className="muted">
            Labeling is scoped to one alert rule and timestamp range so the export is a clean ML
            class. Mixed “all cached” labeling is disabled.
          </p>
          <p>
            <Link className="btn" to="/collect">
              Collect a window
            </Link>
          </p>
        </div>
      )}

      {!loading && datasetId && !current && (
        <div className="panel empty">
          <h2>Nothing to label</h2>
          <p className="muted">
            {filter === 'unlabeled'
              ? 'No unlabeled alerts in this window. Switch the filter to All, or collect a different range.'
              : 'Collect alerts for this rule and time window first.'}
          </p>
          <p>
            <Link className="btn" to="/collect">
              Go to collect
            </Link>
          </p>
        </div>
      )}

      {current && (
        <section className="label-stage">
          <div className="label-question">
            Is this: <em>{current.query_text || selected?.query_text || 'unknown condition'}</em>?
          </div>

          <div className="image-frame">
            {current.media_url ? (
              <img src={current.media_url} alt={current.alert_id} />
            ) : (
              <div className="image-missing">
                {current.image_error || 'Image not cached (media may have expired)'}
              </div>
            )}
          </div>

          <div className="meta-row">
            <span className="chip">{current.camera_name || current.camera_id || 'camera'}</span>
            <span className="chip">{formatEpoch(current.timestamp)}</span>
            <span className="chip">score {scorePct(current.score)}</span>
            <span className="chip">hits {current.hits ?? '—'}</span>
            {current.feedback && (
              <span className={`pill ${current.feedback}`}>{current.feedback}</span>
            )}
            <button type="button" className="btn ghost small" onClick={() => void openHits()}>
              Hit timeline
            </button>
          </div>

          <div className="label-actions">
            <button
              type="button"
              className="btn like big"
              disabled={busy}
              onClick={() => void applyLabel('like')}
            >
              Like <kbd>J</kbd>
            </button>
            <button
              type="button"
              className="btn neutral big"
              disabled={busy}
              onClick={() => void applyLabel('neutral')}
            >
              Neutral <kbd>K</kbd>
            </button>
            <button
              type="button"
              className="btn dislike big"
              disabled={busy}
              onClick={() => void applyLabel('dislike')}
            >
              Dislike <kbd>L</kbd>
            </button>
          </div>

          <div className="row center">
            <button
              type="button"
              className="btn ghost"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={index === 0}
            >
              ← Prev
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setIndex((i) => Math.min(alerts.length - 1, i + 1))}
              disabled={index >= alerts.length - 1}
            >
              Skip / Next →
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => void undo()}
              disabled={!undoStack.length || busy}
            >
              Undo
            </button>
          </div>
        </section>
      )}

      {hitsOpen && (
        <div className="drawer-backdrop" onClick={() => setHitsOpen(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="panel-head">
              <h3>Hit timeline</h3>
              <button className="btn ghost small" onClick={() => setHitsOpen(false)}>
                Close
              </button>
            </div>
            <p className="muted">total_hits = {totalHits ?? '—'}</p>
            {hits.length === 0 ? (
              <p className="muted">No later hits</p>
            ) : (
              <ul className="hit-list">
                {hits.map((h) => (
                  <li key={`${h.timestamp}-${h.value}`}>
                    <span>{formatEpoch(h.timestamp)}</span>
                    <strong>+{h.value}</strong>
                  </li>
                ))}
              </ul>
            )}
            <div className="sparkline">
              {hits.map((h, i) => (
                <div
                  key={i}
                  className="spark-bar"
                  style={{ height: `${Math.min(100, 20 + h.value * 15)}%` }}
                  title={`${formatEpoch(h.timestamp)} (+${h.value})`}
                />
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
