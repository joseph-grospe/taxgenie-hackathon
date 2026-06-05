import { IconInfoCircle } from '@tabler/icons-react'

import type { DashboardMetricGroup } from '@/lib/dashboard-types'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const SKELETON_GROUPS = ['Volume', 'Collection', 'Quality', 'Timing']

const GROUP_ACCENTS: Record<
  DashboardMetricGroup['id'],
  { dot: string; value: string }
> = {
  volume: {
    dot: 'bg-chart-1',
    value: 'text-chart-1',
  },
  collection: {
    dot: 'bg-chart-2',
    value: 'text-chart-2',
  },
  quality: {
    dot: 'bg-chart-5',
    value: 'text-chart-5',
  },
  timing: {
    dot: 'bg-chart-3',
    value: 'text-chart-3',
  },
}

const GROUP_HELP: Record<DashboardMetricGroup['id'], string> = {
  volume: 'Uploaded certificates and terminal processing outcomes.',
  collection:
    'Matched certificates, collected withholding, and outstanding reconciliation differences.',
  quality: 'Successful certificates compared with duplicate or error outcomes.',
  timing: 'Cycle time to first download and average age of uncollected rows.',
}

export function DashboardMetricBand({
  groups,
  loading = false,
}: {
  groups: Array<DashboardMetricGroup>
  loading?: boolean
}) {
  return (
    <Card
      size="sm"
      className="rounded-lg border border-border/70 shadow-none ring-0"
    >
      <CardContent className="overflow-hidden p-0">
        <div className="grid grid-cols-1 gap-px bg-border/70 md:grid-cols-2 xl:grid-cols-4">
          {loading
            ? SKELETON_GROUPS.map((label) => (
                <MetricGroupSkeleton key={label} label={label} />
              ))
            : groups.map((group) => {
                const accent = GROUP_ACCENTS[group.id]

                return (
                  <section
                    key={group.id}
                    className="min-w-0 bg-card p-3 transition-colors hover:bg-muted/25"
                  >
                    <div className="mb-2 flex items-center gap-1.5">
                      <span
                        className={cn(
                          'size-2.5 shrink-0 rounded-full',
                          accent.dot,
                        )}
                      />
                      <h2 className="text-sm font-semibold">{group.label}</h2>
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
                    <div className="grid grid-cols-2 divide-x divide-border/70">
                      {group.metrics.map((metric) => (
                        <div
                          key={metric.id}
                          className="min-w-0 px-3 first:pl-0 last:pr-0"
                        >
                          <p className="truncate text-xs text-muted-foreground">
                            {metric.label}
                          </p>
                          <p
                            className={cn(
                              'mt-1.5 truncate text-2xl font-semibold leading-none tabular-nums',
                              accent.value,
                            )}
                          >
                            {metric.value}
                          </p>
                          <p className="mt-1.5 truncate text-xs text-muted-foreground">
                            {metric.detail}
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>
                )
              })}
        </div>
      </CardContent>
    </Card>
  )
}

function MetricGroupSkeleton({ label }: { label: string }) {
  return (
    <section className="min-w-0 bg-card p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <h2 className="text-sm font-semibold">{label}</h2>
        <IconInfoCircle className="text-muted-foreground" />
      </div>
      <div className="grid grid-cols-2 divide-x divide-border/70">
        {Array.from({ length: 2 }, (_item, index) => (
          <div key={index} className="min-w-0 px-3 first:pl-0 last:pr-0">
            <Skeleton className="mb-2 h-3 w-24" />
            <Skeleton className="mb-1.5 h-7 w-20" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>
    </section>
  )
}
