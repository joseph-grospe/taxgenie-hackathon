import { describe, expect, it } from 'vitest'

import {
  calculateDashboardSummary,
  parseDashboardPeriodInput,
  parseDashboardTrendGroupInput,
  selectEarliestTatSamplesByResult,
} from '@/lib/dashboard-server'

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
          effectiveDate: new Date('2026-01-05T00:00:00.000Z'),
        },
      ],
      tatSamples: [
        {
          documentResultId: 10,
          uploadDate,
          downloadedAt: new Date('2026-01-03T00:00:00.000Z'),
        },
      ],
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
    ).toMatchObject({ value: '2d 0h' })
    expect(
      calculated.metrics.find((metric) => metric.id === 'daysUncollected'),
    ).toMatchObject({ value: '8 days' })
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
      tatSamples: [],
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
      tatSamples: [],
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
    ).toMatchObject({ value: 'No downloads' })
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
          effectiveDate: uploadDate,
        },
      ],
      tatSamples: [
        {
          documentResultId: 20,
          uploadDate,
          downloadedAt: '2026-01-03T00:00:00.000Z',
        },
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
    ).toMatchObject({ value: '1d 0h' })
  })

  it('uses the earliest first download when a certificate has multiple download sources', () => {
    const uploadDate = new Date('2026-01-01T00:00:00.000Z')
    const samples = selectEarliestTatSamplesByResult([
      {
        documentResultId: 20,
        uploadDate,
        downloadedAt: new Date('2026-01-04T00:00:00.000Z'),
      },
      {
        documentResultId: 20,
        uploadDate,
        downloadedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
      {
        documentResultId: 21,
        uploadDate,
        downloadedAt: new Date('2026-01-03T00:00:00.000Z'),
      },
    ])

    expect(samples).toHaveLength(2)
    expect(
      samples.find((sample) => sample.documentResultId === 20),
    ).toMatchObject({
      downloadedAt: new Date('2026-01-02T00:00:00.000Z'),
    })
  })
})
