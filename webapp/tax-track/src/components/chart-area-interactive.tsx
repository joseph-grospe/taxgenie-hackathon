'use client'

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'

import type { ChartConfig } from '@/components/ui/chart'
import type {
  DashboardPeriod,
  DashboardTrendGroup,
  DashboardTrendPoint,
} from '@/lib/dashboard-types'
import { isDashboardTrendGroup } from '@/lib/dashboard-types'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export const description = 'Processing throughput chart'

const chartConfig = {
  uploaded: {
    label: 'Uploaded',
    color: 'var(--chart-1)',
  },
  processed: {
    label: 'Processed',
    color: 'var(--chart-2)',
  },
  collected: {
    label: 'Collected',
    color: 'var(--chart-3)',
  },
} satisfies ChartConfig

export function ChartAreaInteractive({
  data,
  period,
  trendGroup = 'daily',
  onTrendGroupChange,
  loading = false,
}: {
  data: Array<DashboardTrendPoint>
  period?: DashboardPeriod
  trendGroup?: DashboardTrendGroup
  onTrendGroupChange?: (trendGroup: DashboardTrendGroup) => void
  loading?: boolean
}) {
  return (
    <Card
      size="sm"
      className="@container/card h-full gap-3 py-3 shadow-none ring-0"
    >
      <CardHeader className="gap-0.5 border-b border-border/60 group-data-[size=sm]/card:[.border-b]:pb-3">
        <CardTitle className="text-sm">Processing Trend</CardTitle>
        <CardDescription className="text-xs">
          <span className="hidden @[540px]/card:block">
            Uploaded, processed, and collected certificates for{' '}
            {period?.label ?? 'the selected period'}
          </span>
          <span className="@[540px]/card:hidden">Processing volume</span>
        </CardDescription>
        <CardAction>
          <ToggleGroup
            aria-label="Processing trend grouping"
            value={[trendGroup]}
            onValueChange={(values) => {
              const value = values.at(-1)
              if (isDashboardTrendGroup(value)) {
                onTrendGroupChange?.(value)
              }
            }}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="daily">Daily</ToggleGroupItem>
            <ToggleGroupItem value="weekly">Weekly</ToggleGroupItem>
            <ToggleGroupItem value="monthly">Monthly</ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[240px] w-full rounded-lg" />
        ) : (
          <ChartContainer config={chartConfig} className="h-[240px] w-full">
            <LineChart
              accessibilityLayer
              data={data}
              margin={{
                left: 4,
                right: 16,
                top: 12,
                bottom: 4,
              }}
            >
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                textAnchor="middle"
              />
              <YAxis
                width={42}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <ChartTooltip
                cursor={{ stroke: 'var(--border)', strokeDasharray: '4 4' }}
                content={<ChartTooltipContent indicator="dot" />}
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Line
                dataKey="uploaded"
                type="monotone"
                stroke="var(--color-uploaded)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                dataKey="processed"
                type="monotone"
                stroke="var(--color-processed)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                dataKey="collected"
                type="monotone"
                stroke="var(--color-collected)"
                strokeDasharray="4 4"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
