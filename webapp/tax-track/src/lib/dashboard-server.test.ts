import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  leftJoinCalls: [] as Array<Array<unknown>>,
  listOperationalDocuments: vi.fn(),
  selectRows: [] as Array<Array<unknown>>,
  whereCalls: [] as Array<unknown>,
}))

const createSelectChain = (rows: Array<unknown>) => {
  const chain = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    leftJoin: vi.fn((...args: Array<unknown>) => {
      mocks.leftJoinCalls.push(args)
      return chain
    }),
    limit: vi.fn(() => Promise.resolve(rows)),
    orderBy: vi.fn(() => Promise.resolve(rows)),
    then: (
      resolve: (value: Array<unknown>) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
    where: vi.fn((condition: unknown) => {
      mocks.whereCalls.push(condition)
      return chain
    }),
  }

  return chain
}

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    select: vi.fn(() => {
      const rows = mocks.selectRows.shift()
      if (!rows) {
        throw new Error('Unexpected dashboard select query')
      }

      return createSelectChain(rows)
    }),
  }),
}))

vi.mock('@/lib/documents-server', () => ({
  listOperationalDocuments: mocks.listOperationalDocuments,
}))

import {
  calculateBatchActiveTatMs,
  calculateDashboardSummary,
  getDashboardSummary,
  getAverageBatchTatMs,
  parseDashboardEntityIdInput,
  parseDashboardPeriodInput,
  parseDashboardTrendGroupInput,
} from '@/lib/dashboard-server'

const dialect = new PgDialect()
const renderSql = (query: unknown) => dialect.sqlToQuery(query as never).sql

beforeEach(() => {
  vi.clearAllMocks()
  mocks.leftJoinCalls.length = 0
  mocks.selectRows.length = 0
  mocks.whereCalls.length = 0
  mocks.listOperationalDocuments.mockResolvedValue([])
})

const minutesAfter = (start: Date | string, minutes: number) =>
  new Date(new Date(start).getTime() + minutes * 60_000)

const buildCompleteBatchTatSample = (
  batchId: string,
  start: Date | string = '2026-01-01T00:00:00.000Z',
  offsetMinutes = 0,
) => ({
  batchId,
  intervals: [
    {
      stage: 'upload' as const,
      startedAt: minutesAfter(start, offsetMinutes),
      finishedAt: minutesAfter(start, offsetMinutes + 10),
    },
    {
      stage: 'validation' as const,
      startedAt: minutesAfter(start, offsetMinutes + 5),
      finishedAt: minutesAfter(start, offsetMinutes + 20),
    },
    {
      stage: 'plotting' as const,
      startedAt: minutesAfter(start, offsetMinutes + 60),
      finishedAt: minutesAfter(start, offsetMinutes + 70),
    },
    {
      stage: 'reconciliation' as const,
      startedAt: minutesAfter(start, offsetMinutes + 70),
      finishedAt: minutesAfter(start, offsetMinutes + 80),
    },
    {
      stage: 'signing' as const,
      startedAt: minutesAfter(start, offsetMinutes + 120),
      finishedAt: minutesAfter(start, offsetMinutes + 135),
    },
    {
      stage: 'merge' as const,
      startedAt: minutesAfter(start, offsetMinutes + 180),
      finishedAt: minutesAfter(start, offsetMinutes + 200),
    },
    {
      stage: 'download' as const,
      startedAt: minutesAfter(start, offsetMinutes + 200),
      finishedAt: minutesAfter(start, offsetMinutes + 201),
    },
  ],
})

describe('dashboard period parsing', () => {
  it('builds Manila date ranges for monthly, quarterly, and yearly filters', () => {
    expect(
      parseDashboardPeriodInput({
        periodType: 'monthly',
        period: '2026-02',
      }),
    ).toMatchObject({
      periodType: 'monthly',
      period: '2026-02',
      label: 'February 2026',
      startDate: '2026-01-31T16:00:00.000Z',
      endDate: '2026-02-28T16:00:00.000Z',
    })

    expect(
      parseDashboardPeriodInput({
        periodType: 'quarterly',
        period: '2026-Q2',
      }),
    ).toMatchObject({
      label: 'Q2 2026',
      startDate: '2026-03-31T16:00:00.000Z',
      endDate: '2026-06-30T16:00:00.000Z',
    })

    expect(
      parseDashboardPeriodInput({
        periodType: 'yearly',
        period: '2026',
      }),
    ).toMatchObject({
      label: '2026',
      startDate: '2025-12-31T16:00:00.000Z',
      endDate: '2026-12-31T16:00:00.000Z',
    })
  })

  it('throws for invalid period values in strict mode', () => {
    expect(() =>
      parseDashboardPeriodInput(
        { periodType: 'monthly', period: '2026-13' },
        { mode: 'strict' },
      ),
    ).toThrow('Invalid dashboard period value.')
  })

  it('parses trend grouping with period-aware defaults', () => {
    expect(parseDashboardTrendGroupInput({}, 'yearly')).toBe('monthly')
    expect(parseDashboardTrendGroupInput({}, 'monthly')).toBe('daily')
    expect(
      parseDashboardTrendGroupInput({ trendGroup: 'weekly' }, 'yearly'),
    ).toBe('weekly')
    expect(() =>
      parseDashboardTrendGroupInput({ trendGroup: 'quarterly' }, 'yearly', {
        mode: 'strict',
      }),
    ).toThrow('Invalid dashboard trend group.')
  })

  it('parses optional dashboard entity id filters', () => {
    expect(parseDashboardEntityIdInput({ entityId: null })).toBeNull()
    expect(parseDashboardEntityIdInput({ entityId: '' })).toBeNull()
    expect(parseDashboardEntityIdInput({ entityId: '42' })).toBe(42)
    expect(parseDashboardEntityIdInput({ entityId: 42 })).toBe(42)

    expect(() => parseDashboardEntityIdInput({ entityId: '42x' })).toThrow(
      'Invalid dashboard entity filter.',
    )
    expect(() => parseDashboardEntityIdInput({ entityId: 0 })).toThrow(
      'Invalid dashboard entity filter.',
    )
  })
})

describe('dashboard analytics calculations', () => {
  const period = parseDashboardPeriodInput({
    periodType: 'monthly',
    period: '2026-01',
  })

  it('calculates counts, percentages, uncollected amount, TAT, and age', () => {
    const uploadDate = new Date('2026-01-01T00:00:00.000Z')
    const resultDate = new Date('2026-01-01T00:05:00.000Z')
    const calculated = calculateDashboardSummary({
      period,
      uploads: [
        {
          id: 'upload-1',
          batchId: 'batch-1',
          fileName: 'BIR2307_A.pdf',
          uploadDate,
          uploadStatus: 'uploaded',
          queueStatus: 'queued',
          processingStatus: 'success',
          batchName: 'January batch',
          batchStatus: 'closed',
          batchLastActivityAt: resultDate,
          batchCreatedAt: uploadDate,
          ownerName: 'Revenue Ops',
          ownerEmail: 'revenue@example.com',
        },
        {
          id: 'upload-2',
          batchId: 'batch-1',
          fileName: 'BIR2307_B.pdf',
          uploadDate,
          uploadStatus: 'uploaded',
          queueStatus: 'queued',
          processingStatus: 'duplicate',
          batchName: 'January batch',
          batchStatus: 'closed',
          batchLastActivityAt: resultDate,
          batchCreatedAt: uploadDate,
          ownerName: 'Revenue Ops',
          ownerEmail: 'revenue@example.com',
        },
      ],
      results: [
        {
          id: 10,
          status: 'success',
          batchId: 'batch-1',
          uploadId: 'upload-1',
          uploadDate,
          createdAt: resultDate,
        },
        {
          id: 11,
          status: 'duplicate',
          batchId: 'batch-1',
          uploadId: 'upload-2',
          uploadDate,
          createdAt: resultDate,
        },
      ],
      reconciliationRows: [
        {
          id: 1,
          uploadBatchId: 'batch-1',
          matchedTaxRecordId: 10,
          prepaidCWT: -1000,
          taxWithheld: 600,
          accountingDate: '2026-01-01',
          createdAt: resultDate,
          matchedAt: new Date('2026-01-05T00:00:00.000Z'),
          emailSentAt: new Date('2025-12-01T00:00:00.000Z'),
          effectiveDate: uploadDate,
        },
        {
          id: 2,
          uploadBatchId: 'batch-1',
          matchedTaxRecordId: null,
          prepaidCWT: -200,
          taxWithheld: null,
          accountingDate: null,
          createdAt: new Date('2026-01-05T00:00:00.000Z'),
          matchedAt: null,
          emailSentAt: new Date('2025-12-25T00:00:00.000Z'),
          effectiveDate: new Date('2026-01-05T00:00:00.000Z'),
        },
      ],
      batchTatSamples: [buildCompleteBatchTatSample('batch-1', uploadDate)],
      now: new Date('2026-01-11T00:00:00.000Z'),
    })

    expect(
      calculated.metrics.find((metric) => metric.id === 'totalUploaded'),
    ).toMatchObject({ value: '2' })
    expect(calculated.processedTotal).toBe(2)
    expect(
      calculated.metrics.find((metric) => metric.id === 'totalProcessed'),
    ).toMatchObject({ value: '2' })
    expect(
      calculated.metrics.find((metric) => metric.id === 'totalCollected'),
    ).toMatchObject({ value: '1' })
    expect(
      calculated.metrics.find((metric) => metric.id === 'totalUncollected')
        ?.value,
    ).toContain('600.00')
    expect(
      calculated.metrics.find((metric) => metric.id === 'good2307'),
    ).toMatchObject({ value: '50%' })
    expect(
      calculated.metrics.find((metric) => metric.id === 'bad2307'),
    ).toMatchObject({ value: '50%' })
    expect(
      calculated.metrics.find((metric) => metric.id === 'averageTat'),
    ).toMatchObject({
      label: 'Ave. Batch TAT',
      value: '1h 16m',
      detail: 'Active time to final download',
    })
    expect(
      calculated.metrics.find((metric) => metric.id === 'daysUncollected'),
    ).toMatchObject({ value: '3 days' })
    expect(calculated.metricGroups.map((group) => group.label)).toEqual([
      'Volume',
      'Collection',
      'Quality',
      'Timing',
    ])
    expect(calculated.collectionSummary).toMatchObject({
      collectedCount: 1,
      uncollectedCount: 2,
      collectionRate: 50,
    })
    expect(calculated.recentBatches).toHaveLength(1)
    expect(calculated.recentBatches[0]).toMatchObject({
      status: 'Needs review',
      good: 1,
      bad: 1,
    })
    expect(calculated.trend.some((point) => point.uploaded > 0)).toBe(true)
    expect(calculated.trend.some((point) => point.processed > 0)).toBe(true)
    expect(calculated.trend.some((point) => point.collected > 0)).toBe(true)
  })

  it('groups processing trend by daily, weekly, and monthly buckets', () => {
    const firstUploadDate = new Date('2026-01-01T00:00:00.000Z')
    const secondUploadDate = new Date('2026-01-08T00:00:00.000Z')
    const input = {
      period,
      uploads: [
        {
          id: 'upload-daily-1',
          batchId: 'batch-trend',
          fileName: 'BIR2307_Trend_A.pdf',
          uploadDate: firstUploadDate,
          uploadStatus: 'uploaded',
          queueStatus: 'queued',
          processingStatus: 'success',
          batchName: 'Trend batch',
          batchStatus: 'closed',
          batchLastActivityAt: secondUploadDate,
          batchCreatedAt: firstUploadDate,
          ownerName: 'Revenue Ops',
          ownerEmail: 'revenue@example.com',
        },
        {
          id: 'upload-daily-2',
          batchId: 'batch-trend',
          fileName: 'BIR2307_Trend_B.pdf',
          uploadDate: secondUploadDate,
          uploadStatus: 'uploaded',
          queueStatus: 'queued',
          processingStatus: 'success',
          batchName: 'Trend batch',
          batchStatus: 'closed',
          batchLastActivityAt: secondUploadDate,
          batchCreatedAt: firstUploadDate,
          ownerName: 'Revenue Ops',
          ownerEmail: 'revenue@example.com',
        },
      ],
      results: [
        {
          id: 30,
          status: 'success',
          batchId: 'batch-trend',
          uploadId: 'upload-daily-1',
          uploadDate: firstUploadDate,
          createdAt: firstUploadDate,
        },
        {
          id: 31,
          status: 'error',
          batchId: 'batch-trend',
          uploadId: 'upload-daily-2',
          uploadDate: secondUploadDate,
          createdAt: secondUploadDate,
        },
      ],
      reconciliationRows: [],
      batchTatSamples: [],
    }

    const daily = calculateDashboardSummary({ ...input, trendGroup: 'daily' })
    expect(daily.trend).toHaveLength(31)
    expect(
      daily.trend.find((point) => point.bucket === '2026-01-01'),
    ).toMatchObject({
      label: '01/01',
      uploaded: 1,
      processed: 1,
      good: 1,
    })

    const weekly = calculateDashboardSummary({ ...input, trendGroup: 'weekly' })
    expect(weekly.trend).toHaveLength(5)
    expect(
      weekly.trend
        .filter((point) => point.uploaded > 0)
        .map((point) => point.bucket),
    ).toEqual(['2025-12-29', '2026-01-05'])

    const monthly = calculateDashboardSummary({
      ...input,
      trendGroup: 'monthly',
    })
    expect(monthly.trend).toEqual([
      expect.objectContaining({
        bucket: '2026-01',
        label: 'January',
        uploaded: 2,
        processed: 2,
        good: 1,
        bad: 1,
      }),
    ])
  })

  it('uses zero percentages when there are no terminal results', () => {
    const calculated = calculateDashboardSummary({
      period,
      uploads: [],
      results: [],
      reconciliationRows: [],
      batchTatSamples: [],
      now: new Date('2026-01-11T00:00:00.000Z'),
    })

    expect(
      calculated.metrics.find((metric) => metric.id === 'good2307'),
    ).toMatchObject({ value: '0%' })
    expect(
      calculated.metrics.find((metric) => metric.id === 'bad2307'),
    ).toMatchObject({ value: '0%' })
    expect(
      calculated.metrics.find((metric) => metric.id === 'averageTat'),
    ).toMatchObject({ value: 'No completed batches' })
    expect(calculated.collectionSummary).toMatchObject({
      collectedCount: 0,
      uncollectedCount: 0,
      totalAmount: 0,
      collectionRate: 0,
      collectionRateLabel: '0%',
    })
  })

  it('tolerates timestamp strings returned by raw database date expressions', () => {
    const uploadDate = '2026-01-02T00:00:00.000Z'
    const calculated = calculateDashboardSummary({
      period,
      uploads: [
        {
          id: 'upload-string-date',
          batchId: 'batch-string-date',
          fileName: 'BIR2307_string_date.pdf',
          uploadDate,
          uploadStatus: 'uploaded',
          queueStatus: 'queued',
          processingStatus: 'success',
          batchName: 'String date batch',
          batchStatus: 'closed',
          batchLastActivityAt: '2026-01-02T00:10:00.000Z',
          batchCreatedAt: uploadDate,
          ownerName: 'Revenue Ops',
          ownerEmail: 'revenue@example.com',
        },
      ],
      results: [
        {
          id: 20,
          status: 'success',
          batchId: 'batch-string-date',
          uploadId: 'upload-string-date',
          uploadDate,
          createdAt: '2026-01-02T00:05:00.000Z',
        },
      ],
      reconciliationRows: [
        {
          id: 3,
          uploadBatchId: 'batch-string-date',
          matchedTaxRecordId: 20,
          prepaidCWT: -500,
          taxWithheld: 500,
          accountingDate: '2026-01-02',
          createdAt: '2026-01-02T00:05:00.000Z',
          matchedAt: '2026-01-02T00:00:00.000Z',
          emailSentAt: null,
          effectiveDate: uploadDate,
        },
      ],
      batchTatSamples: [
        buildCompleteBatchTatSample('batch-string-date', uploadDate),
      ],
      now: new Date('2026-01-11T00:00:00.000Z'),
    })

    expect(calculated.recentBatches).toHaveLength(1)
    expect(calculated.recentBatches[0]).toMatchObject({
      status: 'Validated',
    })
    expect(calculated.trend.some((point) => point.uploaded === 1)).toBe(true)
    expect(
      calculated.metrics.find((metric) => metric.id === 'averageTat'),
    ).toMatchObject({ value: '1h 16m' })
  })

  it('averages active batch TAT and excludes batches with missing measured stages', () => {
    const shortSample = buildCompleteBatchTatSample(
      'batch-short',
      '2026-01-01T00:00:00.000Z',
    )
    shortSample.intervals = shortSample.intervals.map((interval, index) => ({
      ...interval,
      startedAt: minutesAfter('2026-01-01T00:00:00.000Z', index * 10),
      finishedAt: minutesAfter('2026-01-01T00:00:00.000Z', index * 10 + 10),
    }))

    const longSample = buildCompleteBatchTatSample(
      'batch-long',
      '2026-01-02T00:00:00.000Z',
    )
    longSample.intervals = longSample.intervals.map((interval, index) => ({
      ...interval,
      startedAt: minutesAfter('2026-01-02T00:00:00.000Z', index * 30),
      finishedAt: minutesAfter('2026-01-02T00:00:00.000Z', index * 30 + 30),
    }))

    const missingStageSample = {
      ...buildCompleteBatchTatSample('batch-missing'),
      intervals: buildCompleteBatchTatSample('batch-missing').intervals.filter(
        (interval) => interval.stage !== 'download',
      ),
    }

    expect(
      getAverageBatchTatMs([shortSample, longSample, missingStageSample]),
    ).toBe(140 * 60_000)
  })

  it('unions overlapping active intervals and excludes idle gaps', () => {
    expect(
      calculateBatchActiveTatMs(buildCompleteBatchTatSample('batch-1')),
    ).toBe(76 * 60_000)
  })
})

describe('dashboard reconciliation query filters', () => {
  it('excludes archived, deleted-batch, and removed-certificate rows at the query layer', async () => {
    mocks.selectRows.push([], [], [], [])

    const summary = await getDashboardSummary({
      periodType: 'monthly',
      period: '2026-01',
    })

    const reconciliationWhere =
      mocks.whereCalls
        .map(renderSql)
        .find((query) =>
          query.includes('"reconciliation_results"."archived_at"'),
        ) ?? ''
    const joinConditions = mocks.leftJoinCalls.map(([, condition]) =>
      renderSql(condition),
    )

    expect(reconciliationWhere).toContain(
      '"reconciliation_results"."archived_at" is null',
    )
    expect(reconciliationWhere).toContain(
      '"reconciliation_results"."upload_batch_id" is null',
    )
    expect(reconciliationWhere).toContain('"intake_batches"."id" is not null')
    expect(reconciliationWhere).toContain(
      '"intake_batches"."deleted_at" is null',
    )
    expect(reconciliationWhere).toContain(
      '"reconciliation_results"."matched_upload_batch_id" is null',
    )
    expect(reconciliationWhere).toContain(
      '"matched_intake_batches"."id" is not null',
    )
    expect(reconciliationWhere).toContain(
      '"matched_intake_batches"."deleted_at" is null',
    )
    expect(reconciliationWhere).toContain(
      '"reconciliation_results"."matched_tax_record_id" is null',
    )
    expect(reconciliationWhere).toContain(
      '"document_results"."id" is not null',
    )
    expect(reconciliationWhere).toContain(
      '"intake_files"."removed_from_batch_at" is null',
    )
    expect(joinConditions).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          '"matched_intake_batches"."id" = "reconciliation_results"."matched_upload_batch_id"',
        ),
      ]),
    )
    expect(summary.collectionSummary).toMatchObject({
      collectedCount: 0,
      uncollectedCount: 0,
      totalAmount: 0,
    })
  })
})
