import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from 'drizzle-orm'

import type {
  DashboardBatchRow,
  DashboardCollectionSummary,
  DashboardMetric,
  DashboardMetricGroup,
  DashboardPeriod,
  DashboardPeriodType,
  DashboardSummary,
  DashboardTrendGroup,
  DashboardTrendPoint,
} from '@/lib/dashboard-types'
import { isDashboardTrendGroup } from '@/lib/dashboard-types'
import { calculateDaysUncollected } from '@/lib/reconciliation-aging'
import { getDb } from '@/lib/db'
import { listOperationalDocuments } from '@/lib/documents-server'
import {
  authUserTable,
  batchStageTimings,
  certificateMergeJobInputs,
  certificateMergeJobOutputs,
  documentResults,
  intakeBatches,
  intakeFiles,
  reconciliationResults,
  workerJobs,
} from '@/lib/schema'

const MANILA_UTC_OFFSET_MS = 8 * 60 * 60 * 1000
const MS_PER_DAY = 24 * 60 * 60 * 1000
const RECENT_BATCH_LIMIT = 10
const VALIDATED_DOCUMENT_LIMIT = 200

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US')
const PERCENT_FORMATTER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
})
const MONEY_FORMATTER = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 2,
})
const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Manila',
})
const SHORT_MONTH_DAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: '2-digit',
  timeZone: 'Asia/Manila',
})

type DashboardPeriodRange = DashboardPeriod & {
  start: Date
  end: Date
  year: number
  month?: number
  quarter?: number
}

type DashboardPeriodInput = {
  periodType?: unknown
  period?: unknown
  trendGroup?: unknown
}

type DashboardPeriodParseMode = 'lenient' | 'strict'
type DashboardDateValue = Date | string | number | null | undefined
const DASHBOARD_TAT_STAGES = [
  'upload',
  'validation',
  'plotting',
  'reconciliation',
  'signing',
  'merge',
  'download',
] as const

type DashboardTatStage = (typeof DASHBOARD_TAT_STAGES)[number]

type DashboardUploadRow = {
  id: string
  batchId: string
  fileName: string
  uploadDate: DashboardDateValue
  uploadStatus: string
  queueStatus: string
  processingStatus: string
  batchName: string | null
  batchStatus: string | null
  batchLastActivityAt: DashboardDateValue
  batchCreatedAt: DashboardDateValue
  ownerName: string | null
  ownerEmail: string | null
}

type DashboardResultRow = {
  id: number
  status: string
  batchId: string
  uploadId: string
  uploadDate: DashboardDateValue
  createdAt: DashboardDateValue
}

type DashboardReconciliationRow = {
  id: number
  uploadBatchId: string
  matchedTaxRecordId: number | null
  prepaidCWT: number
  taxWithheld: number | null
  accountingDate: string | null
  createdAt: DashboardDateValue
  matchedAt: DashboardDateValue
  emailSentAt: DashboardDateValue
  effectiveDate: DashboardDateValue
}

export type DashboardBatchTatInterval = {
  stage: DashboardTatStage
  startedAt: DashboardDateValue
  finishedAt: DashboardDateValue
}

export type DashboardBatchTatSample = {
  batchId: string
  intervals: Array<DashboardBatchTatInterval>
}

type DashboardCalculationInput = {
  period: DashboardPeriodRange
  trendGroup?: DashboardTrendGroup
  uploads: Array<DashboardUploadRow>
  results: Array<DashboardResultRow>
  reconciliationRows: Array<DashboardReconciliationRow>
  batchTatSamples: Array<DashboardBatchTatSample>
  now?: Date
}

const resolveDashboardUploadStatus = (upload: DashboardUploadRow) => {
  if (upload.processingStatus === 'success') return 'success'
  if (upload.processingStatus === 'duplicate') return 'duplicate'
  if (upload.processingStatus === 'error') return 'error'
  if (upload.processingStatus === 'processing') return 'processing'
  if (upload.queueStatus === 'failed') return 'error'
  if (upload.queueStatus === 'queued' || upload.queueStatus === 'sending') {
    return 'queued'
  }
  if (upload.uploadStatus === 'uploaded') return 'uploaded'
  return 'pending'
}

const isDashboardPeriodType = (value: unknown): value is DashboardPeriodType =>
  value === 'monthly' || value === 'quarterly' || value === 'yearly'

const toManilaBoundary = (year: number, monthIndex: number, day: number) =>
  new Date(Date.UTC(year, monthIndex, day) - MANILA_UTC_OFFSET_MS)

const getManilaParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const valueByType = new Map(parts.map((part) => [part.type, part.value]))

  return {
    year: valueByType.get('year') ?? '0000',
    month: valueByType.get('month') ?? '01',
    day: valueByType.get('day') ?? '01',
  }
}

const getCurrentManilaYear = (now = new Date()) =>
  Number.parseInt(getManilaParts(now).year, 10)

const toIsoDate = (date: Date) => date.toISOString()

const toValidDate = (value: DashboardDateValue) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = new Date(trimmed)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  if (typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  return null
}

const formatDashboardDate = (value: DashboardDateValue) => {
  const date = toValidDate(value)
  return date ? DATE_FORMATTER.format(date) : 'Unknown'
}

const toMonthLabel = (year: number, month: number) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  }).format(toManilaBoundary(year, month - 1, 1))

const toQuarterLabel = (year: number, quarter: number) => `Q${quarter} ${year}`

export const getDefaultDashboardPeriod = (
  periodType: DashboardPeriodType = 'yearly',
  now = new Date(),
) => {
  const year = getCurrentManilaYear(now)
  if (periodType === 'monthly') {
    const { month } = getManilaParts(now)
    return `${year}-${month}`
  }

  if (periodType === 'quarterly') {
    const month = Number.parseInt(getManilaParts(now).month, 10)
    return `${year}-Q${Math.floor((month - 1) / 3) + 1}`
  }

  return String(year)
}

const getDefaultDashboardTrendGroup = (
  periodType: DashboardPeriodType = 'yearly',
): DashboardTrendGroup => (periodType === 'yearly' ? 'monthly' : 'daily')

const toPeriodRange = (
  periodType: DashboardPeriodType,
  period: string,
): DashboardPeriodRange | null => {
  if (periodType === 'monthly') {
    const match = period.match(/^(\d{4})-(\d{2})$/u)
    if (!match) return null

    const year = Number.parseInt(match[1], 10)
    const month = Number.parseInt(match[2], 10)
    if (month < 1 || month > 12) return null

    const start = toManilaBoundary(year, month - 1, 1)
    const end = toManilaBoundary(year, month, 1)

    return {
      periodType,
      period,
      label: toMonthLabel(year, month),
      start,
      end,
      startDate: toIsoDate(start),
      endDate: toIsoDate(end),
      year,
      month,
    }
  }

  if (periodType === 'quarterly') {
    const match = period.match(/^(\d{4})-Q([1-4])$/u)
    if (!match) return null

    const year = Number.parseInt(match[1], 10)
    const quarter = Number.parseInt(match[2], 10)
    const startMonthIndex = (quarter - 1) * 3
    const start = toManilaBoundary(year, startMonthIndex, 1)
    const end = toManilaBoundary(year, startMonthIndex + 3, 1)

    return {
      periodType,
      period,
      label: toQuarterLabel(year, quarter),
      start,
      end,
      startDate: toIsoDate(start),
      endDate: toIsoDate(end),
      year,
      quarter,
    }
  }

  const match = period.match(/^(\d{4})$/u)
  if (!match) return null

  const year = Number.parseInt(match[1], 10)
  const start = toManilaBoundary(year, 0, 1)
  const end = toManilaBoundary(year + 1, 0, 1)

  return {
    periodType,
    period,
    label: String(year),
    start,
    end,
    startDate: toIsoDate(start),
    endDate: toIsoDate(end),
    year,
  }
}

export const parseDashboardPeriodInput = (
  input: DashboardPeriodInput,
  options: { mode?: DashboardPeriodParseMode; now?: Date } = {},
) => {
  const mode = options.mode ?? 'lenient'
  const rawPeriodType =
    typeof input.periodType === 'string' ? input.periodType : undefined
  const periodType = isDashboardPeriodType(rawPeriodType)
    ? rawPeriodType
    : 'yearly'

  if (
    mode === 'strict' &&
    rawPeriodType &&
    !isDashboardPeriodType(rawPeriodType)
  ) {
    throw new Error('Invalid dashboard period type.')
  }

  const rawPeriod = typeof input.period === 'string' ? input.period.trim() : ''
  const period = rawPeriod || getDefaultDashboardPeriod(periodType, options.now)
  const parsed = toPeriodRange(periodType, period)

  if (parsed) {
    return parsed
  }

  if (mode === 'strict') {
    throw new Error('Invalid dashboard period value.')
  }

  return toPeriodRange(
    periodType,
    getDefaultDashboardPeriod(periodType, options.now),
  )!
}

export const parseDashboardTrendGroupInput = (
  input: Pick<DashboardPeriodInput, 'trendGroup'>,
  periodType: DashboardPeriodType,
  options: { mode?: DashboardPeriodParseMode } = {},
) => {
  const mode = options.mode ?? 'lenient'
  const rawTrendGroup =
    typeof input.trendGroup === 'string' ? input.trendGroup : undefined

  if (isDashboardTrendGroup(rawTrendGroup)) {
    return rawTrendGroup
  }

  if (mode === 'strict' && rawTrendGroup) {
    throw new Error('Invalid dashboard trend group.')
  }

  return getDefaultDashboardTrendGroup(periodType)
}

const roundMoney = (value: number) => Math.round(value * 100) / 100

const formatNumber = (value: number) => NUMBER_FORMATTER.format(value)

const formatMoney = (value: number) => MONEY_FORMATTER.format(value)

const formatPercent = (value: number) => `${PERCENT_FORMATTER.format(value)}%`

const formatDuration = (milliseconds: number | null) => {
  if (milliseconds === null) return 'No completed batches'

  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000))
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${totalSeconds}s`
}

const formatOptionalDays = (days: number | null) =>
  days === null ? 'No open items' : `${formatNumber(days)} days`

const toSafePercentage = (numerator: number, denominator: number) =>
  denominator === 0 ? 0 : (numerator / denominator) * 100

const toManilaDateKey = (date: Date) => {
  const parts = getManilaParts(date)
  return `${parts.year}-${parts.month}-${parts.day}`
}

const toManilaMonthKey = (date: Date) => {
  const parts = getManilaParts(date)
  return `${parts.year}-${parts.month}`
}

const createEmptyTrendPoint = (
  bucket: string,
  label: string,
): DashboardTrendPoint => ({
  bucket,
  label,
  uploaded: 0,
  processed: 0,
  collected: 0,
  good: 0,
  bad: 0,
  collectedAmount: 0,
  uncollectedAmount: 0,
})

const startOfManilaWeek = (date: Date) => {
  const parts = getManilaParts(date)
  const year = Number.parseInt(parts.year, 10)
  const month = Number.parseInt(parts.month, 10)
  const day = Number.parseInt(parts.day, 10)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  const daysSinceMonday = (weekday + 6) % 7

  return toManilaBoundary(year, month - 1, day - daysSinceMonday)
}

const formatWeekLabel = (weekStart: Date) => {
  const weekEnd = new Date(weekStart.getTime() + 6 * MS_PER_DAY)
  return `${SHORT_MONTH_DAY_FORMATTER.format(
    weekStart,
  )} - ${SHORT_MONTH_DAY_FORMATTER.format(weekEnd)}`
}

const getTrendBucketKey = (
  value: DashboardDateValue,
  trendGroup: DashboardTrendGroup,
) => {
  const date = toValidDate(value)
  if (!date) return null

  if (trendGroup === 'monthly') {
    return toManilaMonthKey(date)
  }

  if (trendGroup === 'weekly') {
    return toManilaDateKey(startOfManilaWeek(date))
  }

  return toManilaDateKey(date)
}

const createTrendBuckets = (
  period: DashboardPeriodRange,
  trendGroup: DashboardTrendGroup,
): Array<DashboardTrendPoint> => {
  if (trendGroup === 'monthly') {
    const buckets: Array<DashboardTrendPoint> = []
    let cursor = period.start

    while (cursor.getTime() < period.end.getTime()) {
      const parts = getManilaParts(cursor)
      const year = Number.parseInt(parts.year, 10)
      const month = Number.parseInt(parts.month, 10)
      const key = `${parts.year}-${parts.month}`

      buckets.push(
        createEmptyTrendPoint(
          key,
          toMonthLabel(year, month).replace(` ${year}`, ''),
        ),
      )
      cursor = toManilaBoundary(year, month, 1)
    }

    return buckets
  }

  if (trendGroup === 'weekly') {
    const buckets: Array<DashboardTrendPoint> = []
    let cursor = startOfManilaWeek(period.start)

    while (cursor.getTime() < period.end.getTime()) {
      buckets.push(
        createEmptyTrendPoint(toManilaDateKey(cursor), formatWeekLabel(cursor)),
      )
      cursor = new Date(cursor.getTime() + 7 * MS_PER_DAY)
    }

    return buckets
  }

  const buckets: Array<DashboardTrendPoint> = []
  let cursor = period.start

  while (cursor.getTime() < period.end.getTime()) {
    const parts = getManilaParts(cursor)
    buckets.push(
      createEmptyTrendPoint(
        toManilaDateKey(cursor),
        `${parts.month}/${parts.day}`,
      ),
    )
    cursor = new Date(cursor.getTime() + MS_PER_DAY)
  }

  return buckets
}

const getUncollectedAmount = (
  row: Pick<DashboardReconciliationRow, 'prepaidCWT' | 'taxWithheld'>,
) => Math.max(0, Math.abs(row.prepaidCWT) - (row.taxWithheld ?? 0))

const getAverageDaysUncollected = (
  rows: Array<DashboardReconciliationRow>,
  now: Date,
) => {
  const dayValues = rows.flatMap((row) => {
    if (row.matchedTaxRecordId !== null && !toValidDate(row.matchedAt)) {
      return []
    }

    const daysUncollected = calculateDaysUncollected(
      {
        emailSentAt: row.emailSentAt,
        matchedAt: row.matchedAt,
      },
      { now },
    )

    return daysUncollected === null ? [] : [daysUncollected]
  })

  if (dayValues.length === 0) return null

  return Math.round(
    dayValues.reduce((total, value) => total + value, 0) / dayValues.length,
  )
}

const isDashboardTatStage = (value: string): value is DashboardTatStage =>
  DASHBOARD_TAT_STAGES.includes(value as DashboardTatStage)

export const calculateBatchActiveTatMs = (
  sample: DashboardBatchTatSample,
) => {
  const measuredStages = new Set<DashboardTatStage>()
  const validIntervals: Array<{ startedAt: number; finishedAt: number }> = []

  for (const interval of sample.intervals) {
    const startedAt = toValidDate(interval.startedAt)
    const finishedAt = toValidDate(interval.finishedAt)
    if (!startedAt || !finishedAt) continue

    const startedMs = startedAt.getTime()
    const finishedMs = finishedAt.getTime()
    if (finishedMs < startedMs) continue

    measuredStages.add(interval.stage)
    validIntervals.push({ startedAt: startedMs, finishedAt: finishedMs })
  }

  if (!DASHBOARD_TAT_STAGES.every((stage) => measuredStages.has(stage))) {
    return null
  }

  if (validIntervals.length === 0) return null

  validIntervals.sort((left, right) => left.startedAt - right.startedAt)

  let totalDurationMs = 0
  let currentStart = validIntervals[0].startedAt
  let currentEnd = validIntervals[0].finishedAt

  for (const interval of validIntervals.slice(1)) {
    if (interval.startedAt <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.finishedAt)
      continue
    }

    totalDurationMs += currentEnd - currentStart
    currentStart = interval.startedAt
    currentEnd = interval.finishedAt
  }

  totalDurationMs += currentEnd - currentStart
  return totalDurationMs
}

export const getAverageBatchTatMs = (
  samples: Array<DashboardBatchTatSample>,
) => {
  const validDurations = samples.flatMap((sample) => {
    const duration = calculateBatchActiveTatMs(sample)
    return duration === null ? [] : [duration]
  })

  if (validDurations.length === 0) return null

  return Math.round(
    validDurations.reduce((total, duration) => total + duration, 0) /
      validDurations.length,
  )
}

const getProcessedTotal = (results: Array<DashboardResultRow>) =>
  results.filter((result) =>
    ['success', 'duplicate', 'error'].includes(result.status),
  ).length

const getCollectionSummary = (
  reconciliationRows: Array<DashboardReconciliationRow>,
): DashboardCollectionSummary => {
  const matchedCertificateIds = new Set(
    reconciliationRows
      .map((row) => row.matchedTaxRecordId)
      .filter((value): value is number => value !== null),
  )
  const collectedAmount = roundMoney(
    reconciliationRows.reduce(
      (total, row) =>
        row.matchedTaxRecordId === null
          ? total
          : total + (row.taxWithheld ?? 0),
      0,
    ),
  )
  const uncollectedRows = reconciliationRows.filter(
    (row) => getUncollectedAmount(row) > 0,
  )
  const uncollectedAmount = roundMoney(
    uncollectedRows.reduce(
      (total, row) => total + getUncollectedAmount(row),
      0,
    ),
  )
  const totalAmount = roundMoney(collectedAmount + uncollectedAmount)
  const collectionRate = toSafePercentage(collectedAmount, totalAmount)

  return {
    collectedCount: matchedCertificateIds.size,
    collectedAmount,
    collectedAmountLabel: formatMoney(collectedAmount),
    uncollectedCount: uncollectedRows.length,
    uncollectedAmount,
    uncollectedAmountLabel: formatMoney(uncollectedAmount),
    totalAmount,
    totalAmountLabel: formatMoney(totalAmount),
    collectionRate,
    collectionRateLabel: formatPercent(collectionRate),
  }
}

const buildMetrics = ({
  uploads,
  results,
  reconciliationRows,
  batchTatSamples,
  now = new Date(),
}: DashboardCalculationInput): Array<DashboardMetric> => {
  const goodCount = results.filter(
    (result) => result.status === 'success',
  ).length
  const badCount = results.filter((result) =>
    ['duplicate', 'error'].includes(result.status),
  ).length
  const terminalCount = getProcessedTotal(results)
  const collectionSummary = getCollectionSummary(reconciliationRows)
  const averageTatMs = getAverageBatchTatMs(batchTatSamples)
  const averageDaysUncollected = getAverageDaysUncollected(
    reconciliationRows,
    now,
  )

  return [
    {
      id: 'totalUploaded',
      label: 'Total Uploaded 2307',
      value: formatNumber(uploads.length),
      detail: 'Certificates uploaded',
      description: 'BIR 2307 uploads in the selected period.',
    },
    {
      id: 'totalProcessed',
      label: 'Total Processed',
      value: formatNumber(terminalCount),
      detail: 'Terminal results',
      description: 'Successful, duplicate, and error outcomes.',
    },
    {
      id: 'totalCollected',
      label: 'Total Collected 2307',
      value: formatNumber(collectionSummary.collectedCount),
      detail: collectionSummary.collectedAmountLabel,
      description: 'Matched certificates and collected withholding.',
    },
    {
      id: 'totalUncollected',
      label: 'Total Uncollected',
      value: collectionSummary.uncollectedAmountLabel,
      detail: 'From reconciliation differences',
      description: 'Outstanding withholding from reconciliation rows.',
    },
    {
      id: 'good2307',
      label: '% of Good 2307',
      value: formatPercent(toSafePercentage(goodCount, terminalCount)),
      detail: `${formatNumber(goodCount)} without errors`,
      description: 'Processed without errors or duplicates.',
    },
    {
      id: 'bad2307',
      label: '% of Bad 2307',
      value: formatPercent(toSafePercentage(badCount, terminalCount)),
      detail: `${formatNumber(badCount)} with issues`,
      description: 'Processed with errors or duplicate outcomes.',
    },
    {
      id: 'averageTat',
      label: 'Ave. Batch TAT',
      value: formatDuration(averageTatMs),
      detail:
        averageTatMs === null
          ? 'No completed batches'
          : 'Active time to final download',
      description: 'Average active batch processing time.',
    },
    {
      id: 'daysUncollected',
      label: 'No. of Day Uncollected',
      value: formatOptionalDays(averageDaysUncollected),
      detail: 'After email grace period',
      description:
        'Average days after the 30-day email grace period until match or today.',
    },
  ]
}

const buildMetricGroups = (
  metrics: Array<DashboardMetric>,
): Array<DashboardMetricGroup> => {
  const metricById = new Map(metrics.map((metric) => [metric.id, metric]))
  const getMetric = (id: DashboardMetric['id']) => metricById.get(id)!

  return [
    {
      id: 'volume',
      label: 'Volume',
      metrics: [getMetric('totalUploaded'), getMetric('totalProcessed')],
    },
    {
      id: 'collection',
      label: 'Collection',
      metrics: [getMetric('totalCollected'), getMetric('totalUncollected')],
    },
    {
      id: 'quality',
      label: 'Quality',
      metrics: [getMetric('good2307'), getMetric('bad2307')],
    },
    {
      id: 'timing',
      label: 'Timing',
      metrics: [getMetric('averageTat'), getMetric('daysUncollected')],
    },
  ]
}

const buildTrend = ({
  period,
  trendGroup = getDefaultDashboardTrendGroup(period.periodType),
  uploads,
  results,
  reconciliationRows,
}: DashboardCalculationInput): Array<DashboardTrendPoint> => {
  const buckets = createTrendBuckets(period, trendGroup)
  const bucketByKey = new Map(buckets.map((bucket) => [bucket.bucket, bucket]))

  for (const upload of uploads) {
    const bucketKey = getTrendBucketKey(upload.uploadDate, trendGroup)
    if (!bucketKey) continue

    const bucket = bucketByKey.get(bucketKey)
    if (bucket) bucket.uploaded += 1
  }

  for (const result of results) {
    const bucketKey = getTrendBucketKey(result.uploadDate, trendGroup)
    if (!bucketKey) continue

    const bucket = bucketByKey.get(bucketKey)
    if (!bucket) continue

    bucket.processed += 1
    if (result.status === 'success') {
      bucket.good += 1
    } else if (['duplicate', 'error'].includes(result.status)) {
      bucket.bad += 1
    }
  }

  for (const row of reconciliationRows) {
    const bucketKey = getTrendBucketKey(row.effectiveDate, trendGroup)
    if (!bucketKey) continue

    const bucket = bucketByKey.get(bucketKey)
    if (!bucket) continue

    if (row.matchedTaxRecordId !== null) {
      bucket.collected += 1
      bucket.collectedAmount = roundMoney(
        bucket.collectedAmount + (row.taxWithheld ?? 0),
      )
    }
    bucket.uncollectedAmount = roundMoney(
      bucket.uncollectedAmount + getUncollectedAmount(row),
    )
  }

  return buckets
}

const buildRecentBatches = (
  uploads: Array<DashboardUploadRow>,
  results: Array<DashboardResultRow>,
  period: DashboardPeriodRange,
): Array<DashboardBatchRow> => {
  const resultsByBatchId = new Map<
    string,
    { good: number; bad: number; resultIds: Set<number> }
  >()

  for (const result of results) {
    const current = resultsByBatchId.get(result.batchId) ?? {
      good: 0,
      bad: 0,
      resultIds: new Set<number>(),
    }

    if (!current.resultIds.has(result.id)) {
      current.resultIds.add(result.id)
      if (result.status === 'success') current.good += 1
      if (['duplicate', 'error'].includes(result.status)) current.bad += 1
    }

    resultsByBatchId.set(result.batchId, current)
  }

  const batchMap = new Map<
    string,
    DashboardBatchRow & { sortDate: Date; hasProcessing: boolean }
  >()

  for (const upload of uploads) {
    const existing = batchMap.get(upload.batchId)
    const resultSummary = resultsByBatchId.get(upload.batchId)
    const hasProcessing = [
      'pending',
      'uploaded',
      'queued',
      'processing',
    ].includes(resolveDashboardUploadStatus(upload))
    const uploadDate = toValidDate(upload.uploadDate)
    const lastActivityAt = toValidDate(upload.batchLastActivityAt) ?? uploadDate
    if (!lastActivityAt) continue

    const owner = upload.ownerName || upload.ownerEmail || 'Unknown uploader'

    if (!existing) {
      batchMap.set(upload.batchId, {
        id: upload.batchId,
        name: upload.batchName || upload.batchId.slice(0, 8),
        periodLabel: period.label,
        status: upload.batchStatus === 'open' ? 'Open' : 'Uploaded',
        uploaded: 1,
        good: resultSummary?.good ?? 0,
        bad: resultSummary?.bad ?? 0,
        owner,
        lastActivityAt: formatDashboardDate(lastActivityAt),
        sortDate: lastActivityAt,
        hasProcessing,
      })
      continue
    }

    existing.uploaded += 1
    existing.hasProcessing ||= hasProcessing
    if (lastActivityAt.getTime() > existing.sortDate.getTime()) {
      existing.sortDate = lastActivityAt
      existing.lastActivityAt = formatDashboardDate(lastActivityAt)
    }
  }

  return Array.from(batchMap.values())
    .map((batch) => {
      const resultSummary = resultsByBatchId.get(batch.id)
      const good = resultSummary?.good ?? 0
      const bad = resultSummary?.bad ?? 0
      const status =
        batch.status === 'Open'
          ? 'Open'
          : batch.hasProcessing
            ? 'Processing'
            : bad > 0
              ? 'Needs review'
              : good > 0
                ? 'Validated'
                : 'Uploaded'

      return {
        ...batch,
        status,
        good,
        bad,
      }
    })
    .sort((left, right) => right.sortDate.getTime() - left.sortDate.getTime())
    .slice(0, RECENT_BATCH_LIMIT)
    .map(
      ({ sortDate: _sortDate, hasProcessing: _hasProcessing, ...batch }) =>
        batch,
    )
}

export const calculateDashboardSummary = (
  input: DashboardCalculationInput,
): Pick<
  DashboardSummary,
  | 'trendGroup'
  | 'processedTotal'
  | 'metricGroups'
  | 'collectionSummary'
  | 'metrics'
  | 'trend'
  | 'recentBatches'
> => {
  const metrics = buildMetrics(input)
  const trendGroup =
    input.trendGroup ?? getDefaultDashboardTrendGroup(input.period.periodType)

  return {
    trendGroup,
    processedTotal: getProcessedTotal(input.results),
    metricGroups: buildMetricGroups(metrics),
    collectionSummary: getCollectionSummary(input.reconciliationRows),
    metrics,
    trend: buildTrend({ ...input, trendGroup }),
    recentBatches: buildRecentBatches(
      input.uploads,
      input.results,
      input.period,
    ),
  }
}

const uploadDateExpr = sql<Date>`coalesce(${intakeFiles.uploadedAt}, ${intakeFiles.createdAt})`

const bir2307UploadFilter = () =>
  or(
    eq(intakeFiles.certificateDocumentType, 'BIR2307'),
    ilike(intakeFiles.originalFileName, 'BIR2307%'),
  )

const uploadPeriodFilter = (period: DashboardPeriodRange) =>
  and(gte(uploadDateExpr, period.start), lt(uploadDateExpr, period.end))

const fetchUploads = async (
  period: DashboardPeriodRange,
): Promise<Array<DashboardUploadRow>> => {
  const db = getDb()
  const rows = await db
    .select({
      id: intakeFiles.id,
      batchId: intakeFiles.batchId,
      fileName: intakeFiles.originalFileName,
      uploadDate: uploadDateExpr,
      uploadStatus: intakeFiles.uploadStatus,
      queueStatus: intakeFiles.queueStatus,
      processingStatus: intakeFiles.processingStatus,
      batchName: intakeBatches.name,
      batchStatus: intakeBatches.status,
      batchLastActivityAt: intakeBatches.lastActivityAt,
      batchCreatedAt: intakeBatches.createdAt,
      ownerName: authUserTable.name,
      ownerEmail: authUserTable.email,
    })
    .from(intakeFiles)
    .leftJoin(intakeBatches, eq(intakeBatches.id, intakeFiles.batchId))
    .leftJoin(
      authUserTable,
      eq(authUserTable.id, intakeBatches.createdByUserId),
    )
    .where(
      and(
        isNull(intakeFiles.removedFromBatchAt),
        bir2307UploadFilter(),
        uploadPeriodFilter(period),
      ),
    )
    .orderBy(desc(uploadDateExpr))

  return rows.map((row) => ({
    ...row,
    batchLastActivityAt: row.batchLastActivityAt ?? row.batchCreatedAt,
  }))
}

const fetchResults = async (
  period: DashboardPeriodRange,
): Promise<Array<DashboardResultRow>> => {
  const db = getDb()
  const rows = await db
    .select({
      id: documentResults.id,
      status: documentResults.status,
      batchId: documentResults.batchId,
      uploadId: documentResults.uploadId,
      uploadDate: uploadDateExpr,
      createdAt: documentResults.createdAt,
    })
    .from(documentResults)
    .innerJoin(intakeFiles, eq(intakeFiles.id, documentResults.uploadId))
    .where(
      and(
        isNull(intakeFiles.removedFromBatchAt),
        bir2307UploadFilter(),
        uploadPeriodFilter(period),
        inArray(documentResults.status, ['success', 'duplicate', 'error']),
      ),
    )

  return rows
}

const reconciliationEffectiveDateExpr = sql<Date>`case
  when ${reconciliationResults.matchedTaxRecordId} is not null
    then coalesce(${reconciliationResults.matchedAt}, ${intakeFiles.uploadedAt}, ${intakeFiles.createdAt})
  else ${reconciliationResults.createdAt}
end`

const fetchReconciliationRows = async (
  period: DashboardPeriodRange,
): Promise<Array<DashboardReconciliationRow>> => {
  const db = getDb()
  const rows = await db
    .select({
      id: reconciliationResults.id,
      uploadBatchId: reconciliationResults.uploadBatchId,
      matchedTaxRecordId: reconciliationResults.matchedTaxRecordId,
      prepaidCWT: reconciliationResults.prepaidCWT,
      taxWithheld: reconciliationResults.taxWithheld,
      accountingDate: reconciliationResults.accountingDate,
      createdAt: reconciliationResults.createdAt,
      matchedAt: reconciliationResults.matchedAt,
      emailSentAt: reconciliationResults.emailSentAt,
      effectiveDate: reconciliationEffectiveDateExpr,
    })
    .from(reconciliationResults)
    .leftJoin(
      documentResults,
      eq(documentResults.id, reconciliationResults.matchedTaxRecordId),
    )
    .leftJoin(intakeFiles, eq(intakeFiles.id, documentResults.uploadId))
    .where(
      and(
        gte(reconciliationEffectiveDateExpr, period.start),
        lt(reconciliationEffectiveDateExpr, period.end),
      ),
    )

  return rows.map((row) => ({
    ...row,
    effectiveDate: row.effectiveDate,
  }))
}

const fetchBatchTatSamples = async (
  period: DashboardPeriodRange,
): Promise<Array<DashboardBatchTatSample>> => {
  const db = getDb()
  const uploadBatchRows = await db
    .select({ batchId: intakeFiles.batchId })
    .from(intakeFiles)
    .where(
      and(
        isNull(intakeFiles.removedFromBatchAt),
        bir2307UploadFilter(),
        uploadPeriodFilter(period),
      ),
    )

  const uploadBatchIds = Array.from(
    new Set(uploadBatchRows.map((row) => row.batchId)),
  )
  if (uploadBatchIds.length === 0) return []

  const successRows = await db
    .select({
      documentResultId: documentResults.id,
      batchId: documentResults.batchId,
    })
    .from(documentResults)
    .innerJoin(intakeFiles, eq(intakeFiles.id, documentResults.uploadId))
    .where(
      and(
        inArray(documentResults.batchId, uploadBatchIds),
        isNull(intakeFiles.removedFromBatchAt),
        bir2307UploadFilter(),
        uploadPeriodFilter(period),
        eq(documentResults.status, 'success'),
      ),
    )
  if (successRows.length === 0) return []

  const successIdsByBatchId = new Map<string, Set<number>>()
  for (const row of successRows) {
    const resultIds = successIdsByBatchId.get(row.batchId) ?? new Set<number>()
    resultIds.add(row.documentResultId)
    successIdsByBatchId.set(row.batchId, resultIds)
  }

  const successResultIds = successRows.map((row) => row.documentResultId)
  const downloadedRows = await db
    .select({ documentResultId: certificateMergeJobInputs.documentResultId })
    .from(certificateMergeJobInputs)
    .innerJoin(
      certificateMergeJobOutputs,
      and(
        eq(
          certificateMergeJobOutputs.mergeJobId,
          certificateMergeJobInputs.mergeJobId,
        ),
        eq(
          certificateMergeJobOutputs.partNumber,
          certificateMergeJobInputs.outputPartNumber,
        ),
      ),
    )
    .where(
      and(
        inArray(certificateMergeJobInputs.documentResultId, successResultIds),
        isNotNull(certificateMergeJobOutputs.firstDownloadedAt),
      ),
    )
  const downloadedResultIds = new Set(
    downloadedRows.map((row) => row.documentResultId),
  )
  const completedBatchIds = Array.from(successIdsByBatchId.entries()).flatMap(
    ([batchId, resultIds]) =>
      Array.from(resultIds).every((resultId) =>
        downloadedResultIds.has(resultId),
      )
        ? [batchId]
        : [],
  )
  if (completedBatchIds.length === 0) return []

  const [stageRows, validationRows] = await Promise.all([
    db
      .select({
        batchId: batchStageTimings.batchId,
        stage: batchStageTimings.stage,
        startedAt: batchStageTimings.startedAt,
        finishedAt: batchStageTimings.finishedAt,
      })
      .from(batchStageTimings)
      .where(inArray(batchStageTimings.batchId, completedBatchIds)),
    db
      .select({
        batchId: workerJobs.batchId,
        startedAt: workerJobs.startedAt,
        finishedAt: workerJobs.finishedAt,
      })
      .from(workerJobs)
      .where(
        and(
          inArray(workerJobs.batchId, completedBatchIds),
          isNotNull(workerJobs.startedAt),
          isNotNull(workerJobs.finishedAt),
        ),
      ),
  ])

  const intervalsByBatchId = new Map<
    string,
    Array<DashboardBatchTatInterval>
  >()
  const addInterval = (
    batchId: string,
    interval: DashboardBatchTatInterval,
  ) => {
    const intervals = intervalsByBatchId.get(batchId) ?? []
    intervals.push(interval)
    intervalsByBatchId.set(batchId, intervals)
  }

  for (const row of stageRows) {
    if (!isDashboardTatStage(row.stage)) continue
    addInterval(row.batchId, {
      stage: row.stage,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
    })
  }

  for (const row of validationRows) {
    addInterval(row.batchId, {
      stage: 'validation',
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
    })
  }

  return completedBatchIds.map((batchId) => ({
    batchId,
    intervals: intervalsByBatchId.get(batchId) ?? [],
  }))
}

export const getDashboardSummary = async (
  input: DashboardPeriodInput,
): Promise<DashboardSummary> => {
  const period = parseDashboardPeriodInput(input, { mode: 'strict' })
  const trendGroup = parseDashboardTrendGroupInput(input, period.periodType, {
    mode: 'strict',
  })
  const [
    uploads,
    results,
    reconciliationRows,
    batchTatSamples,
    validatedDocuments,
  ] = await Promise.all([
      fetchUploads(period),
      fetchResults(period),
      fetchReconciliationRows(period),
      fetchBatchTatSamples(period),
      listOperationalDocuments('all', {
        limit: VALIDATED_DOCUMENT_LIMIT,
        uploadDateRange: { start: period.start, end: period.end },
      }),
    ])

  const calculated = calculateDashboardSummary({
    period,
    trendGroup,
    uploads,
    results,
    reconciliationRows,
    batchTatSamples,
  })

  return {
    generatedAt: new Date().toISOString(),
    period,
    ...calculated,
    validatedDocuments,
  }
}
