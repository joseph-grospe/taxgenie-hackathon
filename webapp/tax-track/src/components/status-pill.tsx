import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type StatusPillProps = {
  status: string
  className?: string
}

export type StatusTone =
  | 'neutral'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'accent'

const normalizeStatusKey = (status: string) =>
  status
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()

const statusLabelOverrides: Record<string, string> = {}

export const formatStatusLabel = (status: string) => {
  const key = normalizeStatusKey(status)

  if (!key) return 'Unknown'

  return (
    statusLabelOverrides[key] ??
    key
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  )
}

export const statusToneStyles: Record<StatusTone, string> = {
  neutral: 'border-slate-500/30 bg-slate-500/10 text-slate-600',
  info: 'border-sky-500/30 bg-sky-500/15 text-sky-700',
  success: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700',
  warning: 'border-amber-500/30 bg-amber-500/15 text-amber-700',
  danger: 'border-rose-500/30 bg-rose-500/15 text-rose-700',
  accent: 'border-indigo-500/30 bg-indigo-500/15 text-indigo-700',
}

const statusTones: Record<string, StatusTone> = {
  active: 'info',
  archived: 'neutral',
  closed: 'success',
  completed: 'success',
  deleted: 'danger',
  done: 'success',
  duplicate: 'accent',
  error: 'danger',
  failed: 'danger',
  matched: 'success',
  'matched with variance': 'warning',
  pending: 'neutral',
  'pending outreach': 'warning',
  processing: 'warning',
  'processing report': 'warning',
  queued: 'neutral',
  queueing: 'neutral',
  ready: 'success',
  reconciled: 'success',
  requesting: 'info',
  running: 'info',
  sent: 'success',
  success: 'success',
  unmatched: 'warning',
  uploaded: 'info',
  uploading: 'info',
  validated: 'success',
  validating: 'accent',
  validation: 'accent',
  variance: 'warning',
}

export const getStatusTone = (status: string): StatusTone =>
  statusTones[normalizeStatusKey(status)] ?? 'neutral'

export const getStatusPillClassName = (status: string) =>
  statusToneStyles[getStatusTone(status)]

export function StatusPill({ status, className }: StatusPillProps) {
  const label = formatStatusLabel(status)

  return (
    <Badge
      variant="outline"
      className={cn(
        'border text-xs font-medium',
        getStatusPillClassName(status),
        className,
      )}
    >
      {label}
    </Badge>
  )
}
