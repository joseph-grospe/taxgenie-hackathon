/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SalesReportRunBatchView } from '@/lib/sales-report-types'
import {
  buildSalesReportDetailQueryParams,
  defaultSalesReportDetailSearch,
  parseSalesReportDetailSearch,
} from '@/lib/sales-report-detail-search-state'
import {
  ActiveRunBatchList,
  buildEligibleBatchQueryParams,
  resolveSelectAllBatchSelection,
  shouldShowSalesReportVersionStatus,
} from '@/routes/reconciliation.reports.$reportId'

afterEach(() => {
  cleanup()
})

describe('shouldShowSalesReportVersionStatus', () => {
  it('hides the version status when it duplicates the report status label', () => {
    expect(shouldShowSalesReportVersionStatus('ready', 'ready')).toBe(false)
    expect(shouldShowSalesReportVersionStatus('error', 'error')).toBe(false)
  })

  it('shows the version status when it adds different state', () => {
    expect(shouldShowSalesReportVersionStatus('uploading', 'pending')).toBe(
      true,
    )
    expect(shouldShowSalesReportVersionStatus('ready', 'error')).toBe(true)
  })

  it('hides the version status when there is no current version', () => {
    expect(shouldShowSalesReportVersionStatus('ready', null)).toBe(false)
    expect(shouldShowSalesReportVersionStatus('ready', undefined)).toBe(false)
  })
})

describe('eligible batch selection helpers', () => {
  it('builds filtered eligible batch query params', () => {
    const params = buildEligibleBatchQueryParams({
      entityId: 12,
      page: 1,
      pageSize: 100,
      query: '  april ',
    })

    expect(params.toString()).toBe(
      'entityId=12&page=1&pageSize=100&reconciliationEligible=true&q=april',
    )
  })

  it('selects all filtered eligible batches when within the cap', () => {
    expect(
      resolveSelectAllBatchSelection({
        currentBatchIds: ['batch-1'],
        fetchedBatchIds: ['batch-2', 'batch-3', 'batch-2'],
        totalEligibleItems: 2,
        maxSelectedBatches: 3,
      }),
    ).toEqual({
      status: 'selected',
      selectedBatchIds: ['batch-1', 'batch-2', 'batch-3'],
    })
  })

  it('does not partially select when filtered eligible batches exceed the cap', () => {
    expect(
      resolveSelectAllBatchSelection({
        currentBatchIds: ['batch-1'],
        fetchedBatchIds: ['batch-2', 'batch-3'],
        totalEligibleItems: 3,
        maxSelectedBatches: 3,
      }),
    ).toEqual({
      status: 'too_many',
      selectedBatchIds: ['batch-1'],
      remaining: 2,
    })
  })
})

describe('ActiveRunBatchList', () => {
  const batch = {
    batchId: 'batch-1',
    name: 'April certificates',
    entityName: 'AESI',
    totalFiles: 5,
    createdAt: '2026-04-20T09:00:00.000Z',
    closedAt: '2026-04-20T10:00:00.000Z',
  } satisfies SalesReportRunBatchView

  it('renders active run batches and wires removal', () => {
    const onRemove = vi.fn()
    render(
      createElement(ActiveRunBatchList, {
        batches: [batch],
        removingBatchId: null,
        onRemove,
      }),
    )

    expect(screen.getByText('April certificates')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /remove april/i }))
    expect(onRemove).toHaveBeenCalledWith(batch)
  })

  it('renders an empty state when the report has no active batches', () => {
    render(
      createElement(ActiveRunBatchList, {
        batches: [],
        removingBatchId: null,
        onRemove: vi.fn(),
      }),
    )

    expect(
      screen.getByText('No batches currently attached to this report.'),
    ).toBeTruthy()
  })
})

describe('sales report detail search state', () => {
  it('hydrates independent parsed-row and reconciliation-result params', () => {
    const search = parseSalesReportDetailSearch({
      rowsQ: '  acme ',
      rowsPage: '3',
      rowsPageSize: '50',
      q: ' invoice-1 ',
      filter: 'unmatched',
      page: '2',
      pageSize: '100',
    })

    expect(search).toEqual({
      rowsQ: 'acme',
      rowsPage: 3,
      rowsPageSize: 50,
      q: 'invoice-1',
      filter: 'unmatched',
      page: 2,
      pageSize: 100,
    })
  })

  it('normalizes invalid values to safe defaults', () => {
    expect(
      parseSalesReportDetailSearch({
        rowsPage: '-1',
        rowsPageSize: '999',
        filter: 'pending',
        page: '0',
        pageSize: 'abc',
      }),
    ).toEqual(defaultSalesReportDetailSearch)
  })

  it('builds API query params without empty optional filters', () => {
    const params = buildSalesReportDetailQueryParams({
      ...defaultSalesReportDetailSearch,
      rowsQ: '267-090',
      rowsPage: 2,
      filter: 'difference',
      pageSize: 50,
    })

    expect(params.toString()).toBe(
      'rowsQ=267-090&rowsPage=2&rowsPageSize=25&filter=difference&page=1&pageSize=50',
    )
  })
})
