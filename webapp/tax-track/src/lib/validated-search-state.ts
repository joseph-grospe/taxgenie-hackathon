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

export type ValidatedRouteSearch = {
  q: string
  year: string
  month: string
  quarter: string
  entity: string
  customerType: string
  customerName: string
  errorType: string
  atc: string
  sortBy: ValidatedSortBy
  sortDir: ValidatedSortDir
}

export const defaultValidatedRouteSearch: ValidatedRouteSearch = {
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
}

const csvFields: Array<
  keyof Pick<
    ValidatedRouteSearch,
    | 'quarter'
    | 'customerType'
    | 'errorType'
    | 'atc'
  >
> = [
  'quarter',
  'customerType',
  'errorType',
  'atc',
]

const isValidatedSortBy = (value: string): value is ValidatedSortBy =>
  validatedSortByValues.includes(value as ValidatedSortBy)

const isValidatedSortDir = (value: string): value is ValidatedSortDir =>
  value === 'asc' || value === 'desc'

const toTrimmedString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

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
    customerName: toTrimmedString(search.customerName),
    sortBy: isValidatedSortBy(sortByCandidate)
      ? sortByCandidate
      : defaultValidatedRouteSearch.sortBy,
    sortDir: isValidatedSortDir(sortDirCandidate)
      ? sortDirCandidate
      : defaultValidatedRouteSearch.sortDir,
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
  if (search.entity.length > 0) return true
  if (search.customerName.length > 0) return true

  return csvFields.some((field) => decodeCsv(search[field]).length > 0)
}
