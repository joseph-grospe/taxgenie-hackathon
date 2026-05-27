import { describe, expect, it } from 'vitest'

import { assertSalesReportFileNameMatchesEntity } from '@/lib/sales-report-server'

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
