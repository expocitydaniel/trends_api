import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type Dataset, type DatasetAlert } from '../api'
import { formatEpoch, formatRange, scorePct } from '../utils'

export function ExportPage() {
  const [searchParams] = useSearchParams()
  const requestedDataset = searchParams.get('dataset') || ''
  const requestedRule = searchParams.get('rule') || ''
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [datasetId, setDatasetId] = useState(requestedDataset)
  const [feedback, setFeedback] = useState('')
  const [labeledOnly, setLabeledOnly] = useState(true)
  const [count, setCount] = useState(0)
  const [mix, setMix] = useState<Record<string, number>>({})
  const [sample, setSample] = useState<DatasetAlert[]>([])
  const [dataDir, setDataDir] = useState('')
  const [filename, setFilename] = useState('')
  const [selected, setSelected] = useState<Dataset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function refresh(nextDatasetId = datasetId, nextFeedback = feedback, nextLabeledOnly = labeledOnly) {
    if (!nextDatasetId) {
      setCount(0)
      setMix({})
      setSample([])
      setSelected(null)
      setFilename('')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const preview = await api.exportPreview({
        dataset_id: nextDatasetId,
        feedback: nextFeedback || undefined,
        labeled_only: nextLabeledOnly,
      })
      setCount(preview.count)
      setMix(preview.label_mix || {})
      setSample(preview.sample || [])
      setDataDir(preview.data_dir)
      setFilename(preview.filename || '')
      setSelected(preview.dataset || null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    ;(async () => {
      try {
        const data = await api.datasets()
        const cached = data.datasets || []
        setDatasets(cached)
        let next = requestedDataset
        if (next && cached.some((d) => d.dataset_id === next)) {
          setDatasetId(next)
        } else if (requestedRule) {
          const match = cached.find((d) => d.alert_rule_id === requestedRule)
          next = match?.dataset_id || ''
          setDatasetId(next)
        } else if (cached.length === 1) {
          next = cached[0].dataset_id
          setDatasetId(next)
        }
      } catch {
        /* optional */
      }
    })()
  }, [requestedDataset, requestedRule])

  useEffect(() => {
    void refresh(datasetId, feedback, labeledOnly)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, feedback, labeledOnly])

  const downloadUrl = datasetId
    ? api.exportDownloadUrl({
        dataset_id: datasetId,
        feedback: feedback || undefined,
        labeled_only: labeledOnly,
      })
    : null

  const stats = selected?.stats
  const totalLabeled = (mix.like || 0) + (mix.dislike || 0) + (mix.neutral || 0)
  const unbalanced =
    totalLabeled > 0 &&
    Math.max(mix.like || 0, mix.dislike || 0, mix.neutral || 0) / totalLabeled > 0.8
  const emptyBecauseUnlabeled = labeledOnly && count === 0 && (stats?.unlabeled || 0) > 0

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h2>Export one training dataset</h2>
          <p className="muted">
            One zip per alert rule and timestamp range: <code>dataset.json</code>, labeled{' '}
            <code>manifest.jsonl</code>, and images.
          </p>
        </div>

        <div className="form">
          <label>
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

          {selected && (
            <div className="meta-row">
              {selected.category_name && <span className="chip">{selected.category_name}</span>}
              <span className="chip">{formatRange(selected.from_timestamp, selected.to_timestamp)}</span>
              <span className="chip">{selected.stats?.alerts ?? 0} alerts</span>
              <span className="chip">{selected.stats?.labeled ?? 0} labeled</span>
            </div>
          )}

          <div className="grid two">
            <label>
              Label filter
              <select
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                disabled={!datasetId}
              >
                <option value="">Any</option>
                <option value="like">like</option>
                <option value="neutral">neutral</option>
                <option value="dislike">dislike</option>
              </select>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={labeledOnly}
                onChange={(e) => setLabeledOnly(e.target.checked)}
                disabled={!datasetId}
              />
              Labeled only
            </label>
          </div>

          <div className="row">
            <button
              type="button"
              className="btn"
              onClick={() => void refresh()}
              disabled={loading || !datasetId}
            >
              {loading ? 'Refreshing…' : 'Refresh preview'}
            </button>
            {downloadUrl ? (
              <a className="btn primary" href={downloadUrl}>
                Download zip
              </a>
            ) : (
              <button type="button" className="btn primary" disabled>
                Download zip
              </button>
            )}
          </div>
          {filename && <p className="hint">File: {filename}</p>}
        </div>

        {error && <p className="error-text">{error}</p>}
        {!datasetId && (
          <p className="muted">
            Mixed all-rules export is disabled. Collect a window first, then export that slice.{' '}
            <Link to="/collect">Go to collect</Link>
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Label mix</h2>
          <span className="pill muted">{count} export rows</span>
        </div>
        <div className="label-mix large">
          <span className="like">Like {mix.like ?? 0}</span>
          <span className="neutral">Neutral {mix.neutral ?? 0}</span>
          <span className="dislike">Dislike {mix.dislike ?? 0}</span>
          {!labeledOnly && <span className="muted">Unlabeled {mix.unlabeled ?? 0}</span>}
        </div>
        {stats && (
          <p className="muted">
            This window: {stats.alerts} alerts · {stats.labeled} labeled · {stats.images_cached}{' '}
            images
          </p>
        )}
        {unbalanced && (
          <p className="warn-text">
            Label mix looks unbalanced (&gt;80% one class). Consider more diverse labels.
          </p>
        )}
        {emptyBecauseUnlabeled && (
          <p className="warn-text">
            {stats?.unlabeled} unlabeled alert{stats?.unlabeled === 1 ? '' : 's'} in this window.
            Label them first, or uncheck <strong>Labeled only</strong> to export anyway.{' '}
            {datasetId && (
              <Link to={`/label?dataset=${encodeURIComponent(datasetId)}`}>Open labeling</Link>
            )}
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
          <p className="muted">
            {!datasetId
              ? 'Select a training window to preview rows.'
              : emptyBecauseUnlabeled
                ? 'No labeled rows match yet.'
                : 'No rows match. Collect and label this window first.'}
          </p>
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
                  <th>Image</th>
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
                    <td>{scorePct(row.score)}</td>
                    <td>
                      <span className={`pill ${row.has_image || row.media_url ? 'ok' : 'warn'}`}>
                        {row.has_image || row.media_url ? 'yes' : 'missing'}
                      </span>
                    </td>
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
