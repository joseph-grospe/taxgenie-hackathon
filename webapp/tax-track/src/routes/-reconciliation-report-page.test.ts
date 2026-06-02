import { describe, expect, it } from 'vitest'

import {
  buildSalesReportDetailQueryParams,
  defaultSalesReportDetailSearch,
  parseSalesReportDetailSearch,
} from '@/lib/sales-report-detail-search-state'
import { shouldShowSalesReportVersionStatus } from '@/routes/reconciliation.reports.$reportId'

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
