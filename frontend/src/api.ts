export type Health = {
  bff: string
  configured: boolean
  base_url_set: boolean
  api_key_present: boolean
  central_brain_reachable: boolean
  central_brain_error: string | null
}

export type Stats = {
  alerts: number
  labeled: number
  unlabeled: number
  by_label: { like: number; dislike: number; neutral: number }
  rules: number
  images_cached: number
  export_ready: boolean
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
  severity?: string
  status?: string
  is_preprocessed?: boolean
  description?: string | null
  camera_ids?: string[] | null
  category?: Category | null
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
  feedback?: 'like' | 'dislike' | 'neutral' | null
  feedback_type?: string | null
  query_text?: string
  category_name?: string
  media_url?: string | null
  image_error?: string
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
    request<{ count: number; cameras: Camera[] }>('/api/cameras?page=1&size=100'),

  rules: (search?: string) => {
    const q = new URLSearchParams({ page: '1', size: '50' })
    if (search) q.set('search', search)
    return request<{ count: number; alert_rules: AlertRule[] }>(`/api/rules?${q}`)
  },

  getRule: (id: string) => request<AlertRule>(`/api/rules/${id}`),

  createRule: async (form: FormData) =>
    request<{ message: string; id: string; rule: AlertRule | null }>('/api/rules', {
      method: 'POST',
      body: form,
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
      rule: AlertRule
    }>('/api/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  datasetAlerts: (params: {
    alert_rule_id?: string
    feedback?: string
    unlabeled_only?: boolean
  }) => {
    const q = new URLSearchParams()
    if (params.alert_rule_id) q.set('alert_rule_id', params.alert_rule_id)
    if (params.feedback) q.set('feedback', params.feedback)
    if (params.unlabeled_only) q.set('unlabeled_only', 'true')
    return request<{ count: number; alerts: DatasetAlert[] }>(
      `/api/dataset/alerts?${q}`,
    )
  },

  feedback: (alert_id: string, feedback: 'like' | 'dislike' | 'neutral') =>
    request<{ message: string; alert: DatasetAlert | null }>('/api/feedback', {
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
    alert_rule_id?: string
    feedback?: string
    labeled_only?: boolean
  }) => {
    const q = new URLSearchParams()
    if (params.alert_rule_id) q.set('alert_rule_id', params.alert_rule_id)
    if (params.feedback) q.set('feedback', params.feedback)
    if (params.labeled_only === false) q.set('labeled_only', 'false')
    return request<{
      count: number
      label_mix: Record<string, number>
      sample: DatasetAlert[]
      data_dir: string
    }>(`/api/export/preview?${q}`)
  },

  exportDownloadUrl: (params: {
    alert_rule_id?: string
    feedback?: string
    labeled_only?: boolean
  }) => {
    const q = new URLSearchParams()
    if (params.alert_rule_id) q.set('alert_rule_id', params.alert_rule_id)
    if (params.feedback) q.set('feedback', params.feedback)
    if (params.labeled_only === false) q.set('labeled_only', 'false')
    return `/api/export/download?${q}`
  },
}
