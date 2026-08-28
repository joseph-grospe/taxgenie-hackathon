import type { ReconciliationTableFilterValue } from '@/lib/reconciliation-table-state'

import {
  reconciliationPageSizeOptions,
  reconciliationTableFilterOptions,
} from '@/lib/reconciliation-table-state'

export type SalesReportDetailRouteSearch = {
  q: string
  filter: ReconciliationTableFilterValue
  page: number
  pageSize: number
  rowsQ: string
  rowsPage: number
  rowsPageSize: number
}

export const defaultSalesReportDetailSearch: SalesReportDetailRouteSearch = {
  q: '',
  filter: 'all',
  page: 1,
  pageSize: 25,
  rowsQ: '',
  rowsPage: 1,
  rowsPageSize: 25,
}

const parseText = (value: unknown) =>
  typeof value === 'string' ? value.trim() : ''

const parsePositiveInteger = (value: unknown, fallback: number) => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return fallback
  }

  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const isReconciliationFilter = (
  value: string,
): value is ReconciliationTableFilterValue =>
  reconciliationTableFilterOptions.some((option) => option.value === value)

const parsePageSize = (value: unknown) => {
  const parsed = parsePositiveInteger(
    value,
    defaultSalesReportDetailSearch.pageSize,
  )

  return reconciliationPageSizeOptions.includes(
    String(parsed) as (typeof reconciliationPageSizeOptions)[number],
  )
    ? parsed
    : defaultSalesReportDetailSearch.pageSize
}

export const parseSalesReportDetailSearch = (
  search: Record<string, unknown>,
): SalesReportDetailRouteSearch => {
  const filter = parseText(search.filter)

  return {
    q: parseText(search.q),
    filter: isReconciliationFilter(filter) ? filter : 'all',
    page: Math.max(1, parsePositiveInteger(search.page, 1)),
    pageSize: parsePageSize(search.pageSize),
    rowsQ: parseText(search.rowsQ),
    rowsPage: Math.max(1, parsePositiveInteger(search.rowsPage, 1)),
    rowsPageSize: parsePageSize(search.rowsPageSize),
  }
}

export const buildSalesReportDetailQueryParams = (
  search: SalesReportDetailRouteSearch,
) => {
  const params = new URLSearchParams()

  if (search.rowsQ) params.set('rowsQ', search.rowsQ)
  params.set('rowsPage', String(search.rowsPage))
  params.set('rowsPageSize', String(search.rowsPageSize))

  if (search.q) params.set('q', search.q)
  if (search.filter !== 'all') params.set('filter', search.filter)
  params.set('page', String(search.page))
  params.set('pageSize', String(search.pageSize))

  return params
}
