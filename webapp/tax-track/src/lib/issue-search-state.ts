import { parseEntityScopeId } from '@/lib/entity-scope'

export const issueStatusFilterValues = ['all', 'error', 'duplicate'] as const
export const ISSUE_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const
export const DEFAULT_ISSUE_PAGE_SIZE = 25

export type IssueStatusFilter = (typeof issueStatusFilterValues)[number]

export type IssueRouteSearch = {
  status: IssueStatusFilter
  q: string
  severity: string
  owner: string
  entity: string
  entityId: string
  year: string
  month: string
  quarter: string
  dateFrom: string
  dateTo: string
  page: number
  pageSize: number
}

export const defaultIssueSearch: IssueRouteSearch = {
  status: 'all',
  q: '',
  severity: '',
  owner: '',
  entity: '',
  entityId: '',
  year: '',
  month: '',
  quarter: '',
  dateFrom: '',
  dateTo: '',
  page: 1,
  pageSize: DEFAULT_ISSUE_PAGE_SIZE,
}

const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const parseText = (value: unknown) =>
  typeof value === 'string' ? value.trim() : ''

const parsePositiveInteger = (value: unknown, fallback: number) => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return fallback
  }

  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const isIssueStatusFilter = (value: string): value is IssueStatusFilter =>
  issueStatusFilterValues.includes(value as IssueStatusFilter)

export const parseIssuePageSize = (value: unknown) => {
  const parsed = parsePositiveInteger(value, DEFAULT_ISSUE_PAGE_SIZE)
  return ISSUE_PAGE_SIZE_OPTIONS.includes(
    parsed as (typeof ISSUE_PAGE_SIZE_OPTIONS)[number],
  )
    ? parsed
    : DEFAULT_ISSUE_PAGE_SIZE
}

export const parseIssueSearch = (
  search: Record<string, unknown>,
): IssueRouteSearch => {
  const status = parseText(search.status).toLowerCase()
  const dateFrom = parseText(search.dateFrom)
  const dateTo = parseText(search.dateTo)

  return {
    status: isIssueStatusFilter(status) ? status : 'all',
    q: parseText(search.q),
    severity: parseText(search.severity),
    owner: parseText(search.owner),
    entity: parseText(search.entity),
    entityId: parseEntityScopeId(search.entityId),
    year: parseText(search.year),
    month: parseText(search.month),
    quarter: parseText(search.quarter),
    dateFrom: DATE_INPUT_PATTERN.test(dateFrom) ? dateFrom : '',
    dateTo: DATE_INPUT_PATTERN.test(dateTo) ? dateTo : '',
    page: Math.max(1, parsePositiveInteger(search.page, 1)),
    pageSize: parseIssuePageSize(search.pageSize),
  }
}

export const hasActiveIssueFilters = (search: IssueRouteSearch): boolean =>
  search.q.length > 0 ||
  search.severity.length > 0 ||
  search.owner.length > 0 ||
  search.year.length > 0 ||
  search.month.length > 0 ||
  search.quarter.length > 0 ||
  search.dateFrom.length > 0 ||
  search.dateTo.length > 0

export const buildIssueDocumentsQueryParams = (search: IssueRouteSearch) => {
  const params = new URLSearchParams()

  if (search.status !== 'all') params.set('status', search.status)
  if (search.q) params.set('q', search.q)
  if (search.severity) params.set('severity', search.severity)
  if (search.owner) params.set('owner', search.owner)
  if (search.entityId) {
    params.set('entityId', search.entityId)
  } else if (search.entity) {
    params.set('entity', search.entity)
  }
  if (search.year) params.set('year', search.year)
  if (search.month) params.set('month', search.month)
  if (search.quarter) params.set('quarter', search.quarter)
  if (search.dateFrom) params.set('dateFrom', search.dateFrom)
  if (search.dateTo) params.set('dateTo', search.dateTo)

  params.set('page', String(search.page))
  params.set('pageSize', String(search.pageSize))

  return params
}
