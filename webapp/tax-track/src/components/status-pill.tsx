import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type StatusPillProps = {
  status: string
  className?: string
}

const statusStyles: Record<string, string> = {
  Pending: 'bg-slate-500/10 text-slate-600 border-slate-500/30',
  Processing: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
  Queued: 'bg-slate-500/10 text-slate-600 border-slate-500/30',
  Queueing: 'bg-slate-500/10 text-slate-600 border-slate-500/30',
  Uploaded: 'bg-sky-500/15 text-sky-700 border-sky-500/30',
  Requesting: 'bg-sky-500/15 text-sky-700 border-sky-500/30',
  Uploading: 'bg-sky-500/15 text-sky-700 border-sky-500/30',
  OCR: 'bg-cyan-500/15 text-cyan-700 border-cyan-500/30',
  Validation: 'bg-indigo-500/15 text-indigo-700 border-indigo-500/30',
  Done: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  Success: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  Validated: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  Reconciled: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  Matched: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  Variance: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
  Error: 'bg-rose-500/15 text-rose-700 border-rose-500/30',
  Duplicate: 'bg-fuchsia-500/15 text-fuchsia-700 border-fuchsia-500/30',
  Ready: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  'OCR Required': 'bg-cyan-500/15 text-cyan-700 border-cyan-500/30',
  Active: 'bg-sky-500/15 text-sky-700 border-sky-500/30',
  ProcessingReport: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
}

export function StatusPill({ status, className }: StatusPillProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'border text-xs font-medium',
        statusStyles[status],
        className,
      )}
    >
      {status}
    </Badge>
  )
}
