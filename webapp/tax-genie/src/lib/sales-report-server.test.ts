import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import {
  assertSalesReportFileNameMatchesEntity,
  buildSalesReportRowSearchCondition,
  getConflictingActiveSalesReportBatchIds,
  mergeSalesReportBatchIdsForRun,
  removeSalesReportBatchIdFromRun,
} from '@/lib/sales-report-server'
import { resolveReconciliationMatchState } from '@/lib/reconciliation-progressive-server'

const dialect = new PgDialect()
const renderQuery = (query: unknown) => dialect.sqlToQuery(query as never)

describe('sales-report-server', () => {
  it('accepts sales report filenames without an entity prefix', () => {
    expect(() =>
      assertSalesReportFileNameMatchesEntity('sales-report.xlsx', {
        shortName: 'TMO',
        companyName: 'Tax Monster Operations',
      }),
    ).not.toThrow()
  })

  it('accepts sales report filenames whose prefix matches the selected entity', () => {
    expect(() =>
      assertSalesReportFileNameMatchesEntity('tmo_sales_report_v2.xlsx', {
        shortName: 'TMO',
        companyName: 'Tax Monster Operations',
      }),
    ).not.toThrow()
  })

  it('rejects sales report filenames whose prefix conflicts with the selected entity', () => {
    expect(() =>
      assertSalesReportFileNameMatchesEntity('abc_sales_report.xlsx', {
        shortName: 'TMO',
        companyName: 'Tax Monster Operations',
      }),
    ).toThrow(
      'Sales report filename entity prefix does not match the selected entity.',
    )
  })
})

describe('sales report row search SQL', () => {
  it('covers parsed row fields used by the report detail search', () => {
    const query = renderQuery(buildSalesReportRowSearchCondition('Bravo'))

    expect(query.sql).toContain('"sales_report_rows"."row_number"::text')
    expect(query.sql).toContain('"sales_report_rows"."customer_name"')
    expect(query.sql).toContain('"sales_report_rows"."invoice_number"')
    expect(query.sql).toContain('"sales_report_rows"."accounting_date"')
    expect(query.sql).toContain(
      '"sales_report_rows"."transaction_line_description"',
    )
    expect(query.sql).toContain(
      '"sales_report_rows"."issuer_shortname_used_for_match"',
    )
    expect(query.sql).toContain(
      '"sales_report_rows"."derived_billing_month_mmyy"',
    )
    expect(query.params).toEqual(['%Bravo%'])
  })

  it('adds normalized TIN matching for display-formatted search terms', () => {
    const query = renderQuery(
      buildSalesReportRowSearchCondition('267-090-070-0000'),
    )

    expect(query.sql).toContain('"sales_report_rows"."tin" like')
    expect(query.params).toEqual(['%267-090-070-0000%', '%2670900700000%'])
  })
})

describe('sales report active batch set helpers', () => {
  it('merges newly selected batches into the current active set', () => {
    expect(
      mergeSalesReportBatchIdsForRun({
        activeBatchIds: ['batch-1', 'batch-2'],
        selectedBatchIds: ['batch-2', 'batch-3'],
      }),
    ).toEqual(['batch-1', 'batch-2', 'batch-3'])
  })

  it('detects batches linked to another active sales report', () => {
    expect(
      getConflictingActiveSalesReportBatchIds({
        reportId: 'report-1',
        links: [
          { batchId: 'batch-1', salesReportId: 'report-1' },
          { batchId: 'batch-2', salesReportId: 'report-2' },
          { batchId: 'batch-2', salesReportId: 'report-2' },
        ],
      }),
    ).toEqual(['batch-2'])
  })

  it('removes one batch and returns an empty set when the final batch is removed', () => {
    expect(
      removeSalesReportBatchIdFromRun({
        activeBatchIds: ['batch-1', 'batch-2'],
        removedBatchId: 'batch-1',
      }),
    ).toEqual(['batch-2'])

    expect(
      removeSalesReportBatchIdFromRun({
        activeBatchIds: ['batch-1'],
        removedBatchId: 'batch-1',
      }),
    ).toEqual([])
  })
})

describe('sales report reconciliation status semantics', () => {
  const completedAt = new Date('2026-04-21T00:30:00.000Z')

  it('keeps one partial 2307 attachment unmatched with no matched timestamp', () => {
    expect(
      resolveReconciliationMatchState({
        hasCollections: true,
        hasDifference: true,
        matchedAt: completedAt,
      }),
    ).toEqual({
      matchStatus: 'unmatched',
      matchedAt: null,
    })
  })

  it('marks progressive attachments matched only after variance is cleared', () => {
    expect(
      resolveReconciliationMatchState({
        hasCollections: true,
        hasDifference: false,
        matchedAt: completedAt,
      }),
    ).toEqual({
      matchStatus: 'matched',
      matchedAt: completedAt,
    })
  })

  it('counts partial rows as unmatched in run summaries', () => {
    const states = [
      resolveReconciliationMatchState({
        hasCollections: true,
        hasDifference: true,
        matchedAt: completedAt,
      }),
      resolveReconciliationMatchState({
        hasCollections: true,
        hasDifference: false,
        matchedAt: completedAt,
      }),
      resolveReconciliationMatchState({
        hasCollections: false,
        hasDifference: true,
        matchedAt: completedAt,
      }),
    ]

    expect(
      states.filter((state) => state.matchStatus === 'matched'),
    ).toHaveLength(1)
    expect(
      states.filter((state) => state.matchStatus === 'unmatched'),
    ).toHaveLength(2)
  })
})
