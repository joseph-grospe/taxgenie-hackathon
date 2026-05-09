import type { OperationalDocumentView } from '@/lib/documents-types'

export const dashboardPeriodTypes = ['monthly', 'quarterly', 'yearly'] as const
export const dashboardTrendGroups = ['daily', 'weekly', 'monthly'] as const

export type DashboardPeriodType = (typeof dashboardPeriodTypes)[number]
export type DashboardTrendGroup = (typeof dashboardTrendGroups)[number]

export const isDashboardTrendGroup = (
  value: unknown,
): value is DashboardTrendGroup =>
  dashboardTrendGroups.includes(value as DashboardTrendGroup)

export type DashboardPeriod = {
  periodType: DashboardPeriodType
  period: string
  label: string
  startDate: string
  endDate: string
}

export type DashboardMetric = {
  id:
    | 'totalUploaded'
    | 'totalProcessed'
    | 'totalCollected'
    | 'totalUncollected'
    | 'good2307'
    | 'bad2307'
    | 'averageTat'
    | 'daysUncollected'
  label: string
  value: string
  detail: string
  description: string
}

export type DashboardMetricGroup = {
  id: 'volume' | 'collection' | 'quality' | 'timing'
  label: string
  metrics: Array<DashboardMetric>
}

export type DashboardCollectionSummary = {
  collectedCount: number
  collectedAmount: number
  collectedAmountLabel: string
  uncollectedCount: number
  uncollectedAmount: number
  uncollectedAmountLabel: string
  totalAmount: number
  totalAmountLabel: string
  collectionRate: number
  collectionRateLabel: string
}

export type DashboardTrendPoint = {
  bucket: string
  label: string
  uploaded: number
  processed: number
  collected: number
  good: number
  bad: number
  collectedAmount: number
  uncollectedAmount: number
}

export type DashboardBatchRow = {
  id: string
  name: string
  periodLabel: string
  status: string
  uploaded: number
  good: number
  bad: number
  owner: string
  lastActivityAt: string
}

export type DashboardSummary = {
  generatedAt: string
  period: DashboardPeriod
  trendGroup: DashboardTrendGroup
  processedTotal: number
  metricGroups: Array<DashboardMetricGroup>
  collectionSummary: DashboardCollectionSummary
  metrics: Array<DashboardMetric>
  trend: Array<DashboardTrendPoint>
  recentBatches: Array<DashboardBatchRow>
  validatedDocuments: Array<OperationalDocumentView>
}
