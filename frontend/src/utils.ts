export function formatEpoch(seconds?: number | null): string {
  if (seconds == null) return '—'
  return new Date(seconds * 1000).toLocaleString()
}

export function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

export function presetRange(preset: '1h' | '24h' | '7d'): { from: number; to: number } {
  const to = nowEpoch()
  const map = { '1h': 3600, '24h': 86400, '7d': 604800 }
  return { from: to - map[preset], to }
}

export function scorePct(score?: number | null): string {
  if (score == null) return '—'
  return `${Math.round(score * 100)}%`
}

/** Local `datetime-local` value for a UTC epoch in seconds. */
export function epochToDatetimeLocal(seconds?: number | null): string {
  if (seconds == null || Number.isNaN(seconds)) return ''
  const date = new Date(seconds * 1000)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** UTC epoch seconds from a local `datetime-local` value. */
export function datetimeLocalToEpoch(value: string): number {
  if (!value) return 0
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 0
  return Math.floor(parsed.getTime() / 1000)
}
