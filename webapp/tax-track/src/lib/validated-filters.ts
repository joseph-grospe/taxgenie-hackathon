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
    if (!Number.isFinite(year) || month < 0 || month > 11 || day < 1 || day > 31) {
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

const toRowDateRange = (row: ValidatedTableRow): { start: number; end: number } | null => {
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
  const queryRange = parseDateRangeQuery(filters.q)
  const fromKey = parseDateToken(filters.year, 'start') ?? queryRange.from
  const toKey = parseDateToken(filters.month, 'end') ?? queryRange.to

  if (fromKey === null && toKey === null) return true

  const rowRange = toRowDateRange(row)
  if (!rowRange) return false

  const normalizedFrom = fromKey ?? Number.NEGATIVE_INFINITY
  const normalizedTo = toKey ?? Number.POSITIVE_INFINITY
  const lower = Math.min(normalizedFrom, normalizedTo)
  const upper = Math.max(normalizedFrom, normalizedTo)

  return rowRange.end >= lower && rowRange.start <= upper
}

export function filterValidatedRows(
  rows: Array<ValidatedTableRow>,
  filters: ValidatedFilterSelections,
): Array<ValidatedTableRow> {
  return rows.filter((row) => {
    if (!withinDateRange(row, filters)) return false
    if (!hasFacetValue(filters.quarter, row.quarter)) return false
    if (!matchesText(filters.entity, row.entity)) return false
    if (!hasFacetValue(filters.customerType, row.customerType)) return false
    if (!matchesText(filters.customerName, row.customerName)) return false
    if (!hasFacetValue(filters.atc, row.atc)) return false
    if (!hasErrorType(filters.errorType, row.errorTypes)) return false

    return true
  })
}
