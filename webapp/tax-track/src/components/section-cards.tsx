import { IconTrendingDown, IconTrendingUp } from '@tabler/icons-react'

import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { dashboardMetrics } from '@/data/mock-data'

export function SectionCards() {
  return (
    <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      {dashboardMetrics.map((metric) => {
        const isUp = metric.trend === 'up'
        return (
          <Card key={metric.label} className="@container/card">
            <CardHeader>
              <CardDescription>{metric.label}</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                {metric.value}
              </CardTitle>
              <CardAction>
                <Badge variant="outline">
                  {isUp ? <IconTrendingUp /> : <IconTrendingDown />}
                  {metric.delta}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              <div className="line-clamp-1 flex gap-2 font-medium">
                {isUp ? 'Trending up' : 'Trending down'}{' '}
                {isUp ? (
                  <IconTrendingUp className="size-4" />
                ) : (
                  <IconTrendingDown className="size-4" />
                )}
              </div>
              <div className="text-muted-foreground">{metric.footnote}</div>
            </CardFooter>
          </Card>
        )
      })}
    </div>
  )
}
