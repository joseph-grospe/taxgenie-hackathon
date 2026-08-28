import { parseEntityScopeId } from '@/lib/entity-scope'

export const SALES_REPORT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const
export const DEFAULT_SALES_REPORT_PAGE_SIZE = 25

export const salesReportStatusFilterValues = [
  'all',
  'uploading',
  'ready',
  'error',
] as const

export type SalesReportStatusFilter =
  (typeof salesReportStatusFilterValues)[number]

export type SalesReportSearch = {
  q: string
  status: SalesReportStatusFilter
  entityId: string
  page: number
  pageSize: number
}

export const defaultSalesReportSearch: SalesReportSearch = {
  q: '',
  status: 'all',
  entityId: '',
  page: 1,
  pageSize: DEFAULT_SALES_REPORT_PAGE_SIZE,
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

const isSalesReportStatusFilter = (
  value: string,
): value is SalesReportStatusFilter =>
  salesReportStatusFilterValues.includes(value as SalesReportStatusFilter)

export const parseSalesReportPageSize = (value: unknown) => {
  const parsed = parsePositiveInteger(value, DEFAULT_SALES_REPORT_PAGE_SIZE)
  return SALES_REPORT_PAGE_SIZE_OPTIONS.includes(
    parsed as (typeof SALES_REPORT_PAGE_SIZE_OPTIONS)[number],
  )
    ? parsed
    : DEFAULT_SALES_REPORT_PAGE_SIZE
}

export const parseSalesReportSearch = (
  search: Record<string, unknown>,
): SalesReportSearch => {
  const status = parseText(search.status)

  return {
    q: parseText(search.q),
    status: isSalesReportStatusFilter(status) ? status : 'all',
    entityId: parseEntityScopeId(search.entityId),
    page: Math.max(1, parsePositiveInteger(search.page, 1)),
    pageSize: parseSalesReportPageSize(search.pageSize),
  }
}

export const buildSalesReportListQueryParams = (search: SalesReportSearch) => {
  const params = new URLSearchParams()

  if (search.q) params.set('q', search.q)
  if (search.status !== 'all') params.set('status', search.status)
  if (search.entityId) params.set('entityId', search.entityId)
  params.set('page', String(search.page))
  params.set('pageSize', String(search.pageSize))

  return params
}
