import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import {
  assertSalesReportFileNameMatchesEntity,
  buildSalesReportRowSearchCondition,
} from '@/lib/sales-report-server'

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
