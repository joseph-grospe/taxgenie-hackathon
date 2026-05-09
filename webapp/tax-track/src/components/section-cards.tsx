import {
  IconAlertTriangle,
  IconChartBar,
  IconCircleCheck,
  IconClockHour4,
  IconDownload,
  IconFileUpload,
  IconReceipt,
} from '@tabler/icons-react'
import type { Icon } from '@tabler/icons-react'

import type { DashboardMetric } from '@/lib/dashboard-types'
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

const metricIcons: Record<DashboardMetric['id'], Icon> = {
  totalUploaded: IconFileUpload,
  totalCollected: IconReceipt,
  totalUncollected: IconAlertTriangle,
  good2307: IconCircleCheck,
  bad2307: IconChartBar,
  averageTat: IconClockHour4,
  daysUncollected: IconDownload,
  totalProcessed: IconChartBar,
}

export function SectionCards({
  metrics,
  loading = false,
}: {
  metrics: Array<DashboardMetric>
  loading?: boolean
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
        {Array.from({ length: 7 }, (_, index) => (
          <Card key={index} className="@container/card">
            <CardHeader>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-4 w-40" />
            </CardHeader>
            <CardFooter>
              <Skeleton className="h-4 w-full" />
            </CardFooter>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      {metrics.map((metric) => {
        const IconComponent = metricIcons[metric.id]

        return (
          <Card key={metric.label} className="@container/card">
            <CardHeader>
              <CardDescription className="flex items-center gap-2">
                <IconComponent />
                {metric.label}
              </CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                {metric.value}
              </CardTitle>
              <CardDescription>{metric.detail}</CardDescription>
            </CardHeader>
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              <div className="text-muted-foreground">{metric.description}</div>
            </CardFooter>
          </Card>
        )
      })}
    </div>
  )
}
