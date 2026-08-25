'use client'

import { Cell, Pie, PieChart } from 'recharts'
import { useState } from 'react'

import type { ChartConfig } from '@/components/ui/chart'
import type { DashboardCollectionSummary } from '@/lib/dashboard-types'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ChartContainer } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'

const chartConfig = {
  collected: {
    label: 'Collected',
    color: 'var(--chart-1)',
  },
  uncollected: {
    label: 'Uncollected',
    color: 'var(--chart-4)',
  },
} satisfies ChartConfig

type CollectionChartKey = 'collected' | 'uncollected'

type CollectionChartDatum = {
  name: string
  key: CollectionChartKey
  value: number
  fill: string
}

export const DASHBOARD_COLLECTION_CARD_TITLE = 'Collection and reconciliation'

export function DashboardCollectionSummaryCard({
  summary,
  loading = false,
}: {
  summary?: DashboardCollectionSummary
  loading?: boolean
}) {
  const [activeKey, setActiveKey] = useState<CollectionChartKey | null>(null)
  const hasAmount = Boolean(summary && summary.totalAmount > 0)
  const chartData: Array<CollectionChartDatum> = summary
    ? (
        [
          {
            name: 'Collected',
            key: 'collected',
            value: summary.collectedAmount,
            fill: 'var(--color-collected)',
          },
          {
            name: 'Uncollected',
            key: 'uncollected',
            value: summary.uncollectedAmount,
            fill: 'var(--color-uncollected)',
          },
        ] as Array<CollectionChartDatum>
      ).filter((item) => item.value > 0)
    : []

  return (
    <Card size="sm" className="h-full gap-3 py-3 shadow-none ring-0">
      <CardHeader className="gap-0.5 border-b border-border/60 group-data-[size=sm]/card:[.border-b]:pb-3">
        <CardTitle className="text-sm">
          {DASHBOARD_COLLECTION_CARD_TITLE}
        </CardTitle>
        <CardDescription className="text-xs">
          Withholding collection plus certificate reconciliation status.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-[150px] flex-1 flex-col justify-center">
        {loading ? (
          <div className="grid divide-y divide-border/70 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {Array.from({ length: 3 }, (_item, index) => (
              <div
                key={index}
                className="flex min-w-0 flex-col gap-1.5 py-3 first:pt-0 last:pb-0 sm:px-3 sm:py-0 sm:first:pl-0 sm:last:pr-0"
              >
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-7 w-28 max-w-full" />
                <Skeleton className="h-3 w-20" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid divide-y divide-border/70 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <SummaryAmount
              label="Total withholding"
              value={summary?.totalAmountLabel ?? '₱0.00'}
              detail="Selected period"
            />
            <SummaryAmount
              label="Collected"
              value={summary?.collectedAmountLabel ?? '₱0.00'}
              detail={`${(summary?.collectedCount ?? 0).toLocaleString()} certificates`}
              markerColor="var(--chart-1)"
              isActive={activeKey === 'collected'}
            />
            <SummaryAmount
              label="Uncollected"
              value={summary?.uncollectedAmountLabel ?? '₱0.00'}
              detail={`${(summary?.uncollectedCount ?? 0).toLocaleString()} records`}
              markerColor="var(--chart-4)"
              isActive={activeKey === 'uncollected'}
            />
          </div>
        )}
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-3 border-t border-border/60 text-sm group-data-[size=sm]/card:[.border-t]:pt-3">
        {loading ? (
          <>
            <div className="flex gap-2">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-6 w-28" />
            </div>
            <Skeleton className="size-14 rounded-full" />
          </>
        ) : (
          <>
            <DashboardCollectionStatusBadges summary={summary} />
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Collection Rate</p>
                <p className="font-semibold tabular-nums text-primary">
                  {summary?.collectionRateLabel ?? '0%'}
                </p>
              </div>
              <div className="relative size-14 shrink-0">
                {hasAmount ? (
                  <ChartContainer
                    config={chartConfig}
                    className="aspect-square size-full"
                  >
                    <PieChart>
                      <Pie
                        data={chartData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius="68%"
                        outerRadius="88%"
                        strokeWidth={0}
                        onMouseEnter={(_entry, index) => {
                          setActiveKey(chartData[index]?.key ?? null)
                        }}
                        onMouseLeave={() => setActiveKey(null)}
                      >
                        {chartData.map((entry) => (
                          <Cell key={entry.key} fill={entry.fill} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                ) : (
                  <div className="size-full rounded-full border-[6px] border-muted" />
                )}
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums">
                  {summary?.collectionRateLabel ?? '0%'}
                </span>
              </div>
            </div>
          </>
        )}
      </CardFooter>
    </Card>
  )
}

export function DashboardCollectionStatusBadges({
  summary,
}: {
  summary?: Pick<
    DashboardCollectionSummary,
    'matchedResultCount' | 'pendingVarianceResultCount'
  >
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge variant="secondary">
        {(summary?.matchedResultCount ?? 0).toLocaleString()} matched
      </Badge>
      <Badge variant="outline">
        {(summary?.pendingVarianceResultCount ?? 0).toLocaleString()} pending
        variance
      </Badge>
    </div>
  )
}

function SummaryAmount({
  label,
  value,
  detail,
  markerColor,
  isActive = false,
}: {
  label: string
  value: string
  detail: string
  markerColor?: string
  isActive?: boolean
}) {
  return (
    <div
      data-slot="collection-summary-amount"
      className="min-w-0 py-3 transition-colors first:pt-0 last:pb-0 data-[active=true]:bg-muted/40 sm:px-3 sm:py-0 sm:first:pl-0 sm:last:pr-0"
      data-active={isActive}
    >
      <div className="flex items-center gap-2">
        {markerColor ? (
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: markerColor }}
          />
        ) : null}
        <span className="truncate text-xs font-medium">{label}</span>
      </div>
      <p className="mt-2 truncate text-xl font-semibold leading-7 tracking-tight tabular-nums">
        {value}
      </p>
      <p className="mt-1 truncate text-xs text-muted-foreground tabular-nums">
        {detail}
      </p>
    </div>
  )
}
