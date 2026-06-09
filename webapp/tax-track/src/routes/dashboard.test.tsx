import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { ValidatedFilterSelections } from '@/lib/validated-filters'
import type { ValidatedRouteSearch } from '@/lib/validated-search-state'
import { filterValidatedRows } from '@/lib/validated-filters'
import { decodeCsv, parseValidatedSearch } from '@/lib/validated-search-state'
import { sortValidatedRows } from '@/lib/validated-sorters'
import { toValidatedTableRows } from '@/lib/validated-table-model'
import {
  buildDashboardSummaryQueryParams,
  parseDashboardSearch,
} from '@/lib/dashboard-period'

const dashboardValidatedDocuments = [
  {
    id: 'VAL-001',
    fileName: 'BIR2307_A_SOLARIS_12252025_001.pdf',
    payee: 'Solaris Grid',
    payorName: 'Aboitiz Energy Solutions, Inc.',
    period: 'December 2025',
    atc: 'WC160',
    taxBase: '10,000.00',
    taxWithheld: '200.00',
    confidence: '0.96',
    status: 'Ready',
  },
  {
    id: 'VAL-002',
    fileName: 'BIR2307_A_METRO_12252025_002.pdf',
    payee: 'MetroLine Energy',
    payorName: 'FG Bukidnon Power Corporation',
    period: 'December 2025',
    atc: 'WC158',
    taxBase: '20,000.00',
    taxWithheld: '400.00',
    confidence: '0.94',
    status: 'Ready',
  },
  {
    id: 'VAL-003',
    fileName: 'BIR2307_A_HARBOR_10252025_003.pdf',
    payee: 'Harbor Utilities',
    payorName: 'Visayan Electric Company',
    period: 'October 2025',
    atc: 'WC160',
    taxBase: '15,000.00',
    taxWithheld: '300.00',
    confidence: '0.91',
    status: 'Ready',
  },
]

const toFilterSelections = (
  search: ValidatedRouteSearch,
): ValidatedFilterSelections => ({
  q: search.q,
  year: search.year,
  month: search.month,
  quarter: decodeCsv(search.quarter),
  entity: search.entity,
  customerType: decodeCsv(search.customerType),
  customerName: search.customerName,
  errorType: decodeCsv(search.errorType),
  atc: decodeCsv(search.atc),
})

const getRowsFromSearch = (search: ValidatedRouteSearch) => {
  const tableRows = toValidatedTableRows(dashboardValidatedDocuments)
  const filtered = filterValidatedRows(tableRows, toFilterSelections(search))
  return sortValidatedRows(filtered, {
    sortBy: search.sortBy,
    sortDir: search.sortDir,
  })
}

describe('/dashboard route behavior', () => {
  it('wires the dashboard product tour into the header and page sections', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/routes/dashboard.tsx'),
      'utf8',
    )
    const sidebarSource = readFileSync(
      join(process.cwd(), 'src/components/app-sidebar.tsx'),
      'utf8',
    )

    expect(source).toContain('DashboardTour')
    expect(source).toContain('tourStartSignal')
    expect(source).toContain('Guide me through the dashboard')
    expect(source).toContain('DASHBOARD_TOUR_TARGETS.sidebarTrigger')
    expect(source).toContain('DASHBOARD_TOUR_TARGETS.reportingPeriod')
    expect(source).toContain('DASHBOARD_TOUR_TARGETS.metrics')
    expect(source).toContain('DASHBOARD_TOUR_TARGETS.trend')
    expect(source).toContain('DASHBOARD_TOUR_TARGETS.collection')
    expect(source).toContain('DASHBOARD_TOUR_TARGETS.recentBatches')
    expect(source).toContain('DASHBOARD_TOUR_TARGETS.validatedDocuments')
    expect(source).toContain('AppSidebar')
    expect(sidebarSource).toContain('DASHBOARD_TOUR_TARGETS.navUser')
    expect(sidebarSource).toContain("title: 'Upload'")
    expect(sidebarSource).toContain("title: 'Issues'")
    expect(sidebarSource).toContain("title: 'Validated Results'")
    expect(sidebarSource).toContain("title: 'PDF Merge'")
    expect(sidebarSource).toContain("title: 'Override Requests'")
    expect(sidebarSource).toContain("title: 'Audit Log'")
    expect(sidebarSource).toContain('label="Exports"')
    expect(sidebarSource).toContain('label="Admin"')
    expect(sidebarSource).not.toContain("title: 'Upload Intake'")
    expect(sidebarSource).not.toContain("title: 'Issues Queue'")
    expect(sidebarSource).not.toContain("title: 'Validated Docs'")
    expect(sidebarSource).not.toContain("title: 'Merge PDFs'")
    expect(sidebarSource).not.toContain("title: 'Overrides'")
    expect(sidebarSource).not.toContain("title: 'Audit Trail'")
    expect(sidebarSource).not.toContain('label="Outputs"')
    expect(sidebarSource).not.toContain('label="Governance"')
  })

  it('hydrates URL search into selected filters and sorter', () => {
    const search = parseValidatedSearch({
      customerName: 'aboitiz',
      year: '2025-12',
      month: '2025-12',
      sortBy: 'customer',
      sortDir: 'asc',
    })

    const rows = getRowsFromSearch(search)

    expect(search.customerName).toBe('aboitiz')
    expect(search.year).toBe('2025-12')
    expect(search.month).toBe('2025-12')
    expect(search.sortBy).toBe('customer')
    expect(search.sortDir).toBe('asc')
    expect(rows).toHaveLength(1)
    expect(rows[0].customerName).toBe('Aboitiz Energy Solutions, Inc.')
  })

  it('updates URL facet value and row set when a filter chip is removed', () => {
    const initial = parseValidatedSearch({
      customerName: 'Aboitiz Energy Solutions, Inc.',
      sortBy: 'amount',
      sortDir: 'desc',
    })

    const initialRows = getRowsFromSearch(initial)
    expect(initialRows).toHaveLength(1)

    const updated = parseValidatedSearch({
      ...initial,
      customerName: '',
    })

    const updatedRows = getRowsFromSearch(updated)

    expect(updated.customerName).toBe('')
    expect(updatedRows).toHaveLength(3)
  })

  it('resets filters and sorter to defaults with clear-all behavior', () => {
    const filtered = parseValidatedSearch({
      customerName: 'bukidnon',
      year: '2025-12',
      month: '2025-12',
      sortBy: 'customer',
      sortDir: 'asc',
    })

    expect(getRowsFromSearch(filtered)).toHaveLength(1)

    const cleared = parseValidatedSearch({
      ...filtered,
      q: '',
      year: '',
      month: '',
      quarter: '',
      entity: '',
      customerType: '',
      customerName: '',
      errorType: '',
      atc: '',
      sortBy: 'amount',
      sortDir: 'desc',
    })

    const clearedRows = getRowsFromSearch(cleared)

    expect(cleared.customerName).toBe('')
    expect(cleared.sortBy).toBe('amount')
    expect(cleared.sortDir).toBe('desc')
    expect(clearedRows).toHaveLength(3)
  })

  it('hydrates processing trend grouping from URL search', () => {
    expect(
      parseDashboardSearch({
        periodType: 'yearly',
        period: '2026',
        entityId: '42',
      }),
    ).toMatchObject({
      periodType: 'yearly',
      period: '2026',
      trendGroup: 'monthly',
      entityId: '42',
    })
    expect(
      parseDashboardSearch({
        periodType: 'yearly',
        period: '2026',
        trendGroup: 'weekly',
        entityId: 'bad-value',
      }),
    ).toMatchObject({
      trendGroup: 'weekly',
      entityId: '',
    })
  })

  it('includes entity id when building dashboard summary query params', () => {
    expect(
      buildDashboardSummaryQueryParams({
        periodType: 'monthly',
        period: '2026-05',
        trendGroup: 'daily',
        entityId: '7',
      }).toString(),
    ).toBe('periodType=monthly&period=2026-05&trendGroup=daily&entityId=7')
  })
})
