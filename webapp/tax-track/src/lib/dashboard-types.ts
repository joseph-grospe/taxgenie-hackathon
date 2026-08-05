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

export type DashboardEntityOption = {
  id: number
  label: string
  shortName: string | null
  companyName: string | null
  tin: string | null
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
  matchedResultCount: number
  pendingVarianceResultCount: number
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

export const DASHBOARD_RECENT_BATCH_STATUS_FILTER_OPTIONS = [
  'Open',
  'Uploaded',
  'Processing',
  'Error',
  'Duplicate',
  'Validated',
] as const

export const DASHBOARD_VALIDATED_DOCUMENT_STATUS_FILTER_OPTIONS = [
  'Ready',
  'Duplicate',
  'Error',
] as const

export type DashboardRecentBatchesFilterOptions = {
  statuses: Array<string>
}

export type DashboardValidatedDocumentsFilterOptions = {
  statuses: Array<string>
  atc: Array<string>
}

export type DashboardFilterOptions = {
  recentBatches: DashboardRecentBatchesFilterOptions
  validatedDocuments: DashboardValidatedDocumentsFilterOptions
}

const uniqueSortedDashboardOptions = (values: Array<string>) =>
  Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )

export const buildDashboardFilterOptions = (
  options: { atc?: Array<string> } = {},
): DashboardFilterOptions => ({
  recentBatches: {
    statuses: [...DASHBOARD_RECENT_BATCH_STATUS_FILTER_OPTIONS],
  },
  validatedDocuments: {
    statuses: [...DASHBOARD_VALIDATED_DOCUMENT_STATUS_FILTER_OPTIONS],
    atc: uniqueSortedDashboardOptions(options.atc ?? []),
  },
})

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
  filterOptions: DashboardFilterOptions
}
