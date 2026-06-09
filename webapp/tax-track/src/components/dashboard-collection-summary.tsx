'use client'

import { Cell, Pie, PieChart } from 'recharts'
import { useState } from 'react'

import type { ChartConfig } from '@/components/ui/chart'
import type { DashboardCollectionSummary } from '@/lib/dashboard-types'
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
  amountLabel: string
  count: number
  fill: string
}

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
    ? [
        {
          name: 'Collected',
          key: 'collected',
          value: summary.collectedAmount,
          amountLabel: summary.collectedAmountLabel,
          count: summary.collectedCount,
          fill: 'var(--color-collected)',
        },
        {
          name: 'Uncollected',
          key: 'uncollected',
          value: summary.uncollectedAmount,
          amountLabel: summary.uncollectedAmountLabel,
          count: summary.uncollectedCount,
          fill: 'var(--color-uncollected)',
        },
      ].filter((item) => item.value > 0)
    : []
  const activeDatum = chartData.find((item) => item.key === activeKey) ?? null

  return (
    <Card
      size="sm"
      className="h-full rounded-lg border border-border/70 shadow-none ring-0"
    >
      <CardHeader className="gap-1 border-b border-border/60 py-3">
        <CardTitle className="text-base">Collected vs Uncollected</CardTitle>
        <CardDescription>
          Withholding split from matched certificates and reconciliation gaps.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid min-h-[220px] gap-3 p-3 md:grid-cols-[minmax(160px,0.85fr)_1fr] md:items-center">
        {loading ? (
          <>
            <Skeleton className="mx-auto aspect-square w-full max-w-48 rounded-full" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-5 w-52" />
              <Skeleton className="h-5 w-44" />
            </div>
          </>
        ) : (
          <>
            <div className="relative mx-auto aspect-square w-full max-w-48">
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
                      innerRadius="62%"
                      outerRadius="82%"
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
                <div className="size-full rounded-full border-[18px] border-muted" />
              )}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-xs text-muted-foreground">Total</span>
                <span className="max-w-32 px-2 text-base font-semibold leading-tight tabular-nums [overflow-wrap:anywhere]">
                  {summary?.totalAmountLabel ?? 'No data'}
                </span>
                <span className="mt-1 text-xs text-muted-foreground">
                  Withholding
                </span>
              </div>
              <FloatingCollectionTooltip activeDatum={activeDatum} />
            </div>
            <div className="flex flex-col gap-2">
              <SummaryLegendRow
                label="Collected"
                value={summary?.collectedAmountLabel ?? 'PHP 0.00'}
                count={summary?.collectedCount ?? 0}
                markerColor="var(--chart-1)"
                isActive={activeKey === 'collected'}
              />
              <SummaryLegendRow
                label="Uncollected"
                value={summary?.uncollectedAmountLabel ?? 'PHP 0.00'}
                count={summary?.uncollectedCount ?? 0}
                markerColor="var(--chart-4)"
                isActive={activeKey === 'uncollected'}
              />
            </div>
          </>
        )}
      </CardContent>
      <CardFooter className="justify-between border-t border-border/60 py-3 text-sm">
        <span className="text-muted-foreground">Collection Rate</span>
        {loading ? (
          <Skeleton className="h-5 w-16" />
        ) : (
          <span className="font-semibold tabular-nums text-primary">
            {summary?.collectionRateLabel ?? '0%'}
          </span>
        )}
      </CardFooter>
    </Card>
  )
}

function FloatingCollectionTooltip({
  activeDatum,
}: {
  activeDatum: CollectionChartDatum | null
}) {
  if (!activeDatum) return null

  return (
    <div className="pointer-events-none absolute right-0 top-0 z-10 w-44 rounded-lg border bg-background/95 p-2.5 text-xs shadow-lg">
      <div className="flex items-center gap-2">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: activeDatum.fill }}
        />
        <span className="font-medium">{activeDatum.name}</span>
      </div>
      <p className="mt-1.5 font-mono font-semibold tabular-nums [overflow-wrap:anywhere]">
        {activeDatum.amountLabel}
      </p>
      <p className="mt-1 text-muted-foreground tabular-nums">
        {activeDatum.count.toLocaleString()} records
      </p>
    </div>
  )
}

function SummaryLegendRow({
  label,
  value,
  count,
  markerColor,
  isActive = false,
}: {
  label: string
  value: string
  count: number
  markerColor: string
  isActive?: boolean
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors data-[active=true]:bg-muted/60"
      data-active={isActive}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: markerColor }}
        />
        <span className="truncate text-muted-foreground">{label}</span>
      </div>
      <div className="text-right">
        <p className="font-medium tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {count.toLocaleString()} records
        </p>
      </div>
    </div>
  )
}
