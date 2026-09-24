export type Health = {
  bff: string
  configured: boolean
  base_url_set: boolean
  api_key_present: boolean
  alert_rule_type?: string
  central_brain_reachable: boolean
  central_brain_error: string | null
}

export type Dataset = {
  dataset_id: string
  alert_rule_id: string
  query_text?: string | null
  category_id?: string | null
  category_name?: string | null
  from_timestamp: number
  to_timestamp: number
  from_iso_utc?: string
  to_iso_utc?: string
  created_at?: number | string
  updated_at?: number
  stats: {
    alerts: number
    labeled: number
    unlabeled: number
    by_label: { like: number; dislike: number; neutral: number }
    images_cached: number
    export_ready: boolean
  }
}

export type Stats = {
  alerts: number
  labeled: number
  unlabeled: number
  by_label: { like: number; dislike: number; neutral: number }
  rules: number
  images_cached: number
  export_ready: boolean
  datasets?: number
  dataset_summaries?: Dataset[]
}

export type Category = {
  alert_category_id: string
  name: string
  weight?: number
  color?: string | null
}

export type Camera = {
  camera_id: string
  name: string
  enabled_trvision?: boolean
}

export type AlertRule = {
  alert_rule_id: string
  query_text?: string | null
  category_id?: string
  alert_rule_type?: string
  severity?: string
  status?: string
  is_preprocessed?: boolean
  description?: string | null
  camera_ids?: string[] | null
  camera_group_ids?: string[] | null
  cluster_ids?: string[] | null
  eligible_count?: number | null
  n_eligible?: number | null
  eligible?: number | string[] | null
  created_at?: number | string | null
  category?: Category | null
}

export type CollectDiagnostics = {
  verdict: 'ok' | 'no_data' | 'parse_mismatch' | string
  message: string
  alert_rule_type?: string
  base_url?: string
  from_iso_utc?: string
  to_iso_utc?: string
  cb_count?: number | null
  cb_hits?: number | null
  count_error?: string | null
  skipped_no_id?: number
  pages?: Record<string, unknown>[]
  log_file?: string
}

export type DatasetAlert = {
  alert_id: string
  alert_rule_id: string
  document_id?: string
  camera_id?: string
  camera_name?: string
  timestamp?: number
  score?: number
  hits?: number
  status?: string | null
  feedback?: 'like' | 'dislike' | 'neutral' | null
  feedback_type?: string | null
  query_text?: string
  category_id?: string
  category_name?: string
  media_url?: string | null
  image_error?: string
  image_path?: string | null
  has_image?: boolean
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const body = await response.json()
      message = body.message || body.detail || message
      if (typeof body.detail === 'string') message = body.detail
    } catch {
      /* ignore */
    }
    throw new Error(message)
  }
  if (response.status === 204) return undefined as T
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return response.json() as Promise<T>
  }
  return response as unknown as T
}

export const api = {
  health: () => request<Health>('/api/health'),
  stats: () => request<Stats>('/api/stats'),

  categories: (search?: string) => {
    const q = new URLSearchParams({ page: '1', size: '50' })
    if (search) q.set('search', search)
    return request<{ count: number; alert_categories: Category[] }>(
      `/api/categories?${q}`,
    )
  },

  cameras: () =>
    request<{ count: number; cameras: Camera[] }>('/api/cameras?page=1&size=200'),

  rules: (params: {
    search?: string
    status?: string
    severity?: string
    category_id?: string
    alert_rule_type?: string
    page?: number
    size?: number
    sort_by?: string
    sort_order?: string
  } = {}) => {
    const q = new URLSearchParams({
      page: String(params.page ?? 1),
      size: String(params.size ?? 200),
    })
    if (params.search) q.set('search', params.search)
    if (params.status) q.set('status', params.status)
    if (params.severity) q.set('severity', params.severity)
    if (params.category_id) q.set('category_id', params.category_id)
    if (params.alert_rule_type) q.set('alert_rule_type', params.alert_rule_type)
    if (params.sort_by) q.set('sort_by', params.sort_by)
    if (params.sort_order) q.set('sort_order', params.sort_order)
    return request<{ count: number; alert_rules: AlertRule[] }>(`/api/rules?${q}`)
  },

  getRule: (id: string) => request<AlertRule>(`/api/rules/${id}`),

  createRule: async (form: FormData) =>
    request<{ message: string; id: string; rule: AlertRule | null }>('/api/rules', {
      method: 'POST',
      body: form,
    }),

  updateRule: (
    id: string,
    body: {
      category_id?: string
      query_text?: string
      description?: string
      severity?: string
      status?: 'active' | 'paused'
      camera_ids?: string[]
    },
  ) =>
    request<{ message: string; rule: AlertRule }>(`/api/rules/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  setRuleStatus: (id: string, status: 'active' | 'paused') =>
    request<{ message: string; rule: AlertRule }>(`/api/rules/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }),

  alertCount: (alertRuleId: string, from: number, to: number) => {
    const q = new URLSearchParams({
      alert_rule_id: alertRuleId,
      from_timestamp: String(from),
      to_timestamp: String(to),
    })
    return request<{ count: number; hits: number }>(`/api/alerts/count?${q}`)
  },

  collect: (body: {
    alert_rule_id: string
    from_timestamp: number
    to_timestamp: number
    download_images?: boolean
  }) =>
    request<{
      pages_fetched: number
      alerts_collected: number
      images_cached: number
      images_missing: number
      errors: string[]
      diagnostics?: CollectDiagnostics
      alerts?: DatasetAlert[]
      dataset?: Dataset | null
      rule: AlertRule
    }>('/api/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  datasetAlerts: (params: {
    dataset_id?: string
    alert_rule_id?: string
    feedback?: string
    unlabeled_only?: boolean
    from_timestamp?: number
    to_timestamp?: number
  }) => {
    const q = new URLSearchParams()
    if (params.dataset_id) q.set('dataset_id', params.dataset_id)
    if (params.alert_rule_id) q.set('alert_rule_id', params.alert_rule_id)
    if (params.feedback) q.set('feedback', params.feedback)
    if (params.unlabeled_only) q.set('unlabeled_only', 'true')
    if (params.from_timestamp != null) q.set('from_timestamp', String(params.from_timestamp))
    if (params.to_timestamp != null) q.set('to_timestamp', String(params.to_timestamp))
    return request<{ count: number; dataset: Dataset; alerts: DatasetAlert[] }>(
      `/api/dataset/alerts?${q}`,
    )
  },

  datasets: () =>
    request<{ count: number; datasets: Dataset[] }>('/api/datasets'),

  dataset: (id: string) => request<Dataset>(`/api/datasets/${id}`),

  datasetRules: () =>
    request<{ count: number; alert_rules: AlertRule[] }>('/api/dataset/rules'),

  feedback: (alert_id: string, feedback: 'like' | 'dislike' | 'neutral' | null) =>
    request<{
      message: string
      alert: DatasetAlert | null
      central_brain_error?: string | null
    }>('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alert_id, feedback, feedback_type: 'user' }),
    }),

  hits: (alertId: string) =>
    request<{
      count: number
      total_hits: number
      hits: { id: number; timestamp: number; value: number }[]
    }>(`/api/alerts/${alertId}/hits`),

  exportPreview: (params: {
    dataset_id?: string
    alert_rule_id?: string
    from_timestamp?: number
    to_timestamp?: number
    feedback?: string
    labeled_only?: boolean
  }) => {
    const q = new URLSearchParams()
    if (params.dataset_id) q.set('dataset_id', params.dataset_id)
    if (params.alert_rule_id) q.set('alert_rule_id', params.alert_rule_id)
    if (params.from_timestamp != null) q.set('from_timestamp', String(params.from_timestamp))
    if (params.to_timestamp != null) q.set('to_timestamp', String(params.to_timestamp))
    if (params.feedback) q.set('feedback', params.feedback)
    if (params.labeled_only === false) q.set('labeled_only', 'false')
    return request<{
      count: number
      filename?: string
      dataset?: Dataset
      label_mix: Record<string, number>
      sample: DatasetAlert[]
      data_dir: string
      dataset_stats?: Stats
    }>(`/api/export/preview?${q}`)
  },

  exportDownloadUrl: (params: {
    dataset_id?: string
    alert_rule_id?: string
    from_timestamp?: number
    to_timestamp?: number
    feedback?: string
    labeled_only?: boolean
  }) => {
    const q = new URLSearchParams()
    if (params.dataset_id) q.set('dataset_id', params.dataset_id)
    if (params.alert_rule_id) q.set('alert_rule_id', params.alert_rule_id)
    if (params.from_timestamp != null) q.set('from_timestamp', String(params.from_timestamp))
    if (params.to_timestamp != null) q.set('to_timestamp', String(params.to_timestamp))
    if (params.feedback) q.set('feedback', params.feedback)
    if (params.labeled_only === false) q.set('labeled_only', 'false')
    return `/api/export/download?${q}`
  },
}
