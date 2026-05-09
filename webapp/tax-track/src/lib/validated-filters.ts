import type { ValidatedTableRow } from '@/lib/validated-table-model'
import { getMonthSortIndex } from '@/lib/validated-table-model'

export type ValidatedFilterSelections = {
  q: string
  year: string
  month: string
  quarter: Array<string>
  entity: string
  customerType: Array<string>
  customerName: string
  errorType: Array<string>
  atc: Array<string>
}

const hasFacetValue = (selected: Array<string>, actual: string): boolean => {
  if (selected.length === 0) return true
  return selected.includes(actual)
}

const hasErrorType = (
  selected: Array<string>,
  actual: Array<string>,
): boolean => {
  if (selected.length === 0) return true
  return actual.some((value) => selected.includes(value))
}

const normalizeText = (value: string): string => value.trim().toLowerCase()

const matchesText = (query: string, actual: string): boolean => {
  const normalized = normalizeText(query)
  if (!normalized) return true

  return normalizeText(actual).includes(normalized)
}

const matchesExactText = (query: string, actual: string): boolean => {
  const normalized = normalizeText(query)
  if (!normalized) return true

  return normalizeText(actual) === normalized
}

const toDateKey = (year: number, monthIndex: number, day: number): number =>
  new Date(year, monthIndex, day).getTime()

const getMonthLastDay = (year: number, monthIndex: number): number =>
  new Date(year, monthIndex + 1, 0).getDate()

const parseDateToken = (
  value: string,
  boundary: 'start' | 'end',
): number | null => {
  const trimmed = value.trim()
  if (!trimmed) return null

  const fullDateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (fullDateMatch) {
    const year = Number.parseInt(fullDateMatch[1], 10)
    const month = Number.parseInt(fullDateMatch[2], 10) - 1
    const day = Number.parseInt(fullDateMatch[3], 10)
    if (
      !Number.isFinite(year) ||
      month < 0 ||
      month > 11 ||
      day < 1 ||
      day > 31
    ) {
      return null
    }
    return toDateKey(year, month, day)
  }

  const monthMatch = trimmed.match(/^(\d{4})-(\d{2})$/)
  if (!monthMatch) return null

  const year = Number.parseInt(monthMatch[1], 10)
  const month = Number.parseInt(monthMatch[2], 10) - 1
  if (!Number.isFinite(year) || month < 0 || month > 11) return null

  const day = boundary === 'start' ? 1 : getMonthLastDay(year, month)
  return toDateKey(year, month, day)
}

const isDateToken = (value: string, boundary: 'start' | 'end'): boolean =>
  parseDateToken(value, boundary) !== null

const parseDateRangeQuery = (
  value: string,
): { from: number | null; to: number | null } => {
  const trimmed = value.trim()
  if (!trimmed) return { from: null, to: null }

  const normalized = trimmed.replace(/\s+to\s+/i, '..')
  const [fromRaw, toRaw] = normalized.split('..')
  if (!fromRaw || !toRaw) return { from: null, to: null }

  return {
    from: parseDateToken(fromRaw, 'start'),
    to: parseDateToken(toRaw, 'end'),
  }
}

const toRowDateRange = (
  row: ValidatedTableRow,
): { start: number; end: number } | null => {
  const year = Number.parseInt(row.year, 10)
  const month = getMonthSortIndex(row.month)

  if (!Number.isFinite(year) || month < 0) return null
  return {
    start: toDateKey(year, month, 1),
    end: toDateKey(year, month, getMonthLastDay(year, month)),
  }
}

const withinDateRange = (
  row: ValidatedTableRow,
  filters: Pick<ValidatedFilterSelections, 'q' | 'year' | 'month'>,
): boolean => {
  const explicitFromKey = parseDateToken(filters.year, 'start')
  const explicitToKey = parseDateToken(filters.month, 'end')
  const hasExplicitDateRange =
    explicitFromKey !== null || explicitToKey !== null
  const parsedQueryRange = hasExplicitDateRange
    ? { from: null, to: null }
    : parseDateRangeQuery(filters.q)
  const queryRange =
    parsedQueryRange.from !== null && parsedQueryRange.to !== null
      ? parsedQueryRange
      : { from: null, to: null }
  const fromKey = explicitFromKey ?? queryRange.from
  const toKey = explicitToKey ?? queryRange.to

  if (fromKey === null && toKey === null) return true

  const rowRange = toRowDateRange(row)
  if (!rowRange) return false

  const normalizedFrom = fromKey ?? Number.NEGATIVE_INFINITY
  const normalizedTo = toKey ?? Number.POSITIVE_INFINITY
  const lower = Math.min(normalizedFrom, normalizedTo)
  const upper = Math.max(normalizedFrom, normalizedTo)

  return rowRange.end >= lower && rowRange.start <= upper
}

const isLegacyDateRangeSearch = (
  filters: Pick<ValidatedFilterSelections, 'q' | 'year' | 'month'>,
): boolean => {
  if (filters.year || filters.month) return false

  const queryRange = parseDateRangeQuery(filters.q)
  return queryRange.from !== null && queryRange.to !== null
}

const matchesTableSearch = (row: ValidatedTableRow, query: string): boolean => {
  const normalized = normalizeText(query)
  if (!normalized) return true

  return [
    row.fileName,
    row.customerName,
    row.payee,
    row.entity,
    row.atc,
    row.period,
    row.status,
    row.customerType,
    ...row.errorTypes,
  ].some((value) => normalizeText(value).includes(normalized))
}

export function filterValidatedRows(
  rows: Array<ValidatedTableRow>,
  filters: ValidatedFilterSelections,
): Array<ValidatedTableRow> {
  return rows.filter((row) => {
    if (!withinDateRange(row, filters)) return false
    if (
      filters.year &&
      !isDateToken(filters.year, 'start') &&
      !matchesExactText(filters.year, row.year)
    ) {
      return false
    }
    if (
      filters.month &&
      !isDateToken(filters.month, 'end') &&
      !matchesExactText(filters.month, row.month)
    ) {
      return false
    }
    if (
      !isLegacyDateRangeSearch(filters) &&
      !matchesTableSearch(row, filters.q)
    ) {
      return false
    }
    if (!hasFacetValue(filters.quarter, row.quarter)) return false
    if (!matchesExactText(filters.entity, row.entity)) return false
    if (!hasFacetValue(filters.customerType, row.customerType)) return false
    if (!matchesText(filters.customerName, row.customerName)) return false
    if (!hasFacetValue(filters.atc, row.atc)) return false
    if (!hasErrorType(filters.errorType, row.errorTypes)) return false

    return true
  })
}
