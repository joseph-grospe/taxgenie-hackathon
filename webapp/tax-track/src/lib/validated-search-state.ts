import { parseEntityScopeId } from '@/lib/entity-scope'

export const validatedSortByValues = [
  'amount',
  'customer',
  'year',
  'month',
  'quarter',
  'entity',
  'customerType',
  'customerName',
  'errorType',
  'atc',
] as const

export type ValidatedSortBy = (typeof validatedSortByValues)[number]
export type ValidatedSortDir = 'asc' | 'desc'

export const VALIDATED_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const
export const DEFAULT_VALIDATED_PAGE_SIZE = 25

export type ValidatedRouteSearch = {
  q: string
  year: string
  month: string
  quarter: string
  entity: string
  entityId: string
  customerType: string
  customerName: string
  errorType: string
  atc: string
  sortBy: ValidatedSortBy
  sortDir: ValidatedSortDir
  page: number
  pageSize: number
}

export const defaultValidatedRouteSearch: ValidatedRouteSearch = {
  q: '',
  year: '',
  month: '',
  quarter: '',
  entity: '',
  entityId: '',
  customerType: '',
  customerName: '',
  errorType: '',
  atc: '',
  sortBy: 'amount',
  sortDir: 'desc',
  page: 1,
  pageSize: DEFAULT_VALIDATED_PAGE_SIZE,
}

const csvFields: Array<
  keyof Pick<
    ValidatedRouteSearch,
    'quarter' | 'customerType' | 'errorType' | 'atc'
  >
> = ['quarter', 'customerType', 'errorType', 'atc']

const isValidatedSortBy = (value: string): value is ValidatedSortBy =>
  validatedSortByValues.includes(value as ValidatedSortBy)

const isValidatedSortDir = (value: string): value is ValidatedSortDir =>
  value === 'asc' || value === 'desc'

const toTrimmedString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

const parsePositiveInteger = (value: unknown, fallback: number) => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return fallback
  }

  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const parseValidatedPageSize = (value: unknown) => {
  const parsed = parsePositiveInteger(value, DEFAULT_VALIDATED_PAGE_SIZE)
  return VALIDATED_PAGE_SIZE_OPTIONS.includes(
    parsed as (typeof VALIDATED_PAGE_SIZE_OPTIONS)[number],
  )
    ? parsed
    : DEFAULT_VALIDATED_PAGE_SIZE
}

export function decodeCsv(values: string): Array<string> {
  if (!values) return []

  return Array.from(
    new Set(
      values
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  )
}

export function encodeCsv(values: Array<string>): string {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  ).join(',')
}

export function toggleCsvValue(csv: string, value: string): string {
  const normalizedValue = value.trim()
  if (!normalizedValue) return csv

  const parsed = decodeCsv(csv)
  const hasValue = parsed.includes(normalizedValue)
  const nextValues = hasValue
    ? parsed.filter((item) => item !== normalizedValue)
    : [...parsed, normalizedValue]

  return encodeCsv(nextValues)
}

export function parseValidatedSearch(
  search: Record<string, unknown>,
): ValidatedRouteSearch {
  const sortByCandidate = toTrimmedString(search.sortBy)
  const sortDirCandidate = toTrimmedString(search.sortDir)

  const normalized: ValidatedRouteSearch = {
    ...defaultValidatedRouteSearch,
    q: toTrimmedString(search.q),
    year: toTrimmedString(search.year),
    month: toTrimmedString(search.month),
    entity: toTrimmedString(search.entity),
    entityId: parseEntityScopeId(search.entityId),
    customerName: toTrimmedString(search.customerName),
    sortBy: isValidatedSortBy(sortByCandidate)
      ? sortByCandidate
      : defaultValidatedRouteSearch.sortBy,
    sortDir: isValidatedSortDir(sortDirCandidate)
      ? sortDirCandidate
      : defaultValidatedRouteSearch.sortDir,
    page: Math.max(1, parsePositiveInteger(search.page, 1)),
    pageSize: parseValidatedPageSize(search.pageSize),
  }

  for (const field of csvFields) {
    normalized[field] = encodeCsv(decodeCsv(toTrimmedString(search[field])))
  }

  return normalized
}

export function hasActiveValidatedFilters(
  search: ValidatedRouteSearch,
): boolean {
  if (search.q.length > 0) return true
  if (search.year.length > 0) return true
  if (search.month.length > 0) return true
  if (search.customerName.length > 0) return true

  return csvFields.some((field) => decodeCsv(search[field]).length > 0)
}

export const buildValidatedDocumentsQueryParams = (
  search: ValidatedRouteSearch,
) => {
  const params = new URLSearchParams()

  if (search.q) params.set('q', search.q)
  if (search.year) params.set('year', search.year)
  if (search.month) params.set('month', search.month)
  if (search.quarter) params.set('quarter', search.quarter)
  if (search.entityId) {
    params.set('entityId', search.entityId)
  } else if (search.entity) {
    params.set('entity', search.entity)
  }
  if (search.customerType) params.set('customerType', search.customerType)
  if (search.customerName) params.set('customerName', search.customerName)
  if (search.errorType) params.set('errorType', search.errorType)
  if (search.atc) params.set('atc', search.atc)

  params.set('sortBy', search.sortBy)
  params.set('sortDir', search.sortDir)
  params.set('page', String(search.page))
  params.set('pageSize', String(search.pageSize))

  return params
}
