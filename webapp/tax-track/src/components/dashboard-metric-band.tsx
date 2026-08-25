import {
  IconAlertTriangle,
  IconChartBar,
  IconCircleCheck,
  IconClockHour4,
  IconDownload,
  IconFileUpload,
  IconInfoCircle,
  IconReceipt,
} from '@tabler/icons-react'
import type { Icon } from '@tabler/icons-react'

import type {
  DashboardMetric,
  DashboardMetricGroup,
} from '@/lib/dashboard-types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const SKELETON_GROUPS = [
  { label: 'Quality', metricCount: 3 },
  { label: 'Timing', metricCount: 2 },
]

const PRIMARY_METRIC_IDS: Array<DashboardMetric['id']> = [
  'totalUploaded',
  'totalProcessed',
  'totalCollected',
  'totalUncollected',
]

const METRIC_ACCENTS: Record<
  DashboardMetric['id'],
  {
    icon: Icon
    iconContainer: string
    value: string
  }
> = {
  totalUploaded: {
    icon: IconFileUpload,
    iconContainer: 'bg-primary/10 text-primary',
    value: 'text-foreground',
  },
  totalProcessed: {
    icon: IconChartBar,
    iconContainer: 'bg-chart-4/10 text-chart-4',
    value: 'text-foreground',
  },
  totalCollected: {
    icon: IconReceipt,
    iconContainer: 'bg-primary/10 text-primary',
    value: 'text-foreground',
  },
  totalUncollected: {
    icon: IconAlertTriangle,
    iconContainer: 'bg-destructive/10 text-destructive',
    value: 'text-foreground',
  },
  good2307: {
    icon: IconCircleCheck,
    iconContainer: 'bg-primary/10 text-primary',
    value: 'text-primary',
  },
  review2307: {
    icon: IconClockHour4,
    iconContainer: 'bg-chart-4/10 text-chart-4',
    value: 'text-chart-4',
  },
  bad2307: {
    icon: IconAlertTriangle,
    iconContainer: 'bg-destructive/10 text-destructive',
    value: 'text-destructive',
  },
  averageTat: {
    icon: IconClockHour4,
    iconContainer: 'bg-muted text-muted-foreground',
    value: 'text-foreground',
  },
  daysUncollected: {
    icon: IconDownload,
    iconContainer: 'bg-muted text-muted-foreground',
    value: 'text-foreground',
  },
}

const GROUP_HELP: Record<DashboardMetricGroup['id'], string> = {
  volume: 'Uploaded certificates and terminal processing outcomes.',
  collection:
    'Collected certificates, fully matched rows, pending variance, and outstanding withholding.',
  quality:
    'Terminal certificates partitioned into accepted, under-review, and error or duplicate outcomes.',
  timing: 'Cycle time to first download and average age of uncollected rows.',
}

export function DashboardMetricBand({
  groups,
  loading = false,
}: {
  groups: Array<DashboardMetricGroup>
  loading?: boolean
}) {
  if (loading) {
    return <DashboardMetricBandSkeleton />
  }

  const metricById = new Map(
    groups
      .flatMap((group) => group.metrics)
      .map((metric) => [metric.id, metric]),
  )
  const primaryMetrics = PRIMARY_METRIC_IDS.flatMap((id) => {
    const metric = metricById.get(id)
    return metric ? [metric] : []
  })
  const qualityGroup = groups.find((group) => group.id === 'quality')
  const timingGroup = groups.find((group) => group.id === 'timing')

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {primaryMetrics.map((metric) => (
          <PrimaryMetricCard key={metric.id} metric={metric} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        {qualityGroup ? <MetricGroupCard group={qualityGroup} /> : null}
        {timingGroup ? <MetricGroupCard group={timingGroup} /> : null}
      </div>
    </div>
  )
}

function PrimaryMetricCard({ metric }: { metric: DashboardMetric }) {
  const accent = METRIC_ACCENTS[metric.id]
  const IconComponent = accent.icon

  return (
    <Card size="sm" className="gap-3 py-3 shadow-none ring-0">
      <CardHeader className="flex flex-row items-start gap-3">
        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-md',
            accent.iconContainer,
          )}
        >
          <IconComponent className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <MetricLabel metric={metric} />
          <p
            className={cn(
              'mt-1.5 truncate text-xl font-semibold leading-none tracking-tight tabular-nums',
              accent.value,
            )}
          >
            {metric.value}
          </p>
          <p className="mt-1.5 truncate text-xs text-muted-foreground">
            {metric.detail}
          </p>
        </div>
      </CardHeader>
    </Card>
  )
}

function MetricGroupCard({ group }: { group: DashboardMetricGroup }) {
  return (
    <Card size="sm" className="gap-3 py-3 shadow-none ring-0">
      <CardHeader className="border-b border-border/60 group-data-[size=sm]/card:[.border-b]:pb-3">
        <div className="flex items-center gap-1.5">
          <CardTitle className="text-sm">{group.label}</CardTitle>
          <Tooltip>
            <TooltipTrigger
              aria-label={`${group.label} metric details`}
              className="inline-flex rounded-full border-0 bg-transparent p-0 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none [&_svg:not([class*='size-'])]:size-4"
            >
              <IconInfoCircle />
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              <p>{GROUP_HELP[group.id]}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </CardHeader>
      <CardContent
        className={cn(
          'grid divide-y divide-border/70 sm:divide-x sm:divide-y-0',
          group.metrics.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2',
        )}
      >
        {group.metrics.map((metric) => {
          const accent = METRIC_ACCENTS[metric.id]
          const IconComponent = accent.icon

          return (
            <div
              key={metric.id}
              className="min-w-0 py-3 first:pt-0 last:pb-0 sm:px-4 sm:py-0 sm:first:pl-0 sm:last:pr-0"
            >
              <div className="flex items-center gap-2">
                <IconComponent className={cn('size-4', accent.value)} />
                <MetricLabel metric={metric} />
              </div>
              <p
                className={cn(
                  'mt-2 text-xl font-semibold leading-7 tracking-tight tabular-nums',
                  group.id === 'timing'
                    ? 'line-clamp-2 min-h-12 break-words'
                    : 'truncate',
                  accent.value,
                )}
              >
                {metric.value}
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {metric.detail}
              </p>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function MetricLabel({ metric }: { metric: DashboardMetric }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <p className="truncate text-xs font-medium">{metric.label}</p>
      <Tooltip>
        <TooltipTrigger
          aria-label={`${metric.label} details`}
          className="inline-flex shrink-0 rounded-full border-0 bg-transparent p-0 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none [&_svg:not([class*='size-'])]:size-3.5"
        >
          <IconInfoCircle />
        </TooltipTrigger>
        <TooltipContent className="max-w-64">
          <p>{metric.description}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

function DashboardMetricBandSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_item, index) => (
          <Card key={index} size="sm" className="gap-3 py-3 shadow-none ring-0">
            <CardHeader className="flex flex-row items-start gap-3">
              <Skeleton className="size-9 shrink-0 rounded-md" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-7 w-24" />
                <Skeleton className="h-3 w-40 max-w-full" />
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        {SKELETON_GROUPS.map((group) => (
          <MetricGroupSkeleton key={group.label} {...group} />
        ))}
      </div>
    </div>
  )
}

function MetricGroupSkeleton({
  label,
  metricCount,
}: {
  label: string
  metricCount: number
}) {
  return (
    <Card size="sm" className="gap-3 py-3 shadow-none ring-0">
      <CardHeader className="border-b border-border/60 group-data-[size=sm]/card:[.border-b]:pb-3">
        <CardTitle className="text-sm">{label}</CardTitle>
      </CardHeader>
      <CardContent
        className={cn(
          'grid divide-y divide-border/70 sm:divide-x sm:divide-y-0',
          metricCount === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2',
        )}
      >
        {Array.from({ length: metricCount }, (_item, index) => (
          <div
            key={index}
            className="flex min-w-0 flex-col gap-1.5 py-3 first:pt-0 last:pb-0 sm:px-4 sm:py-0 sm:first:pl-0 sm:last:pr-0"
          >
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-3 w-32 max-w-full" />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
