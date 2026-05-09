const RECONCILIATION_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Manila',
})

export const formatReconciliationTimestamp = (value: string | null) =>
  value ? RECONCILIATION_TIMESTAMP_FORMATTER.format(new Date(value)) : '—'

export const formatDaysUncollected = (value: number | null) =>
  value === null ? '—' : String(value)
