import type { ValidatedTableRow } from '@/lib/validated-table-model'

export type ValidatedFilterSelections = {
  q: string
  year: Array<string>
  month: Array<string>
  quarter: Array<string>
  entity: Array<string>
  customerType: Array<string>
  customerName: Array<string>
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

const matchesText = (query: string, row: ValidatedTableRow): boolean => {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true

  const haystack = [
    row.docId,
    row.fileName,
    row.customerName,
    row.entity,
    row.customerType,
    row.atc,
    row.year,
    row.month,
    row.quarter,
    ...row.errorTypes,
  ]
    .join(' ')
    .toLowerCase()

  return haystack.includes(normalized)
}

export function filterValidatedRows(
  rows: Array<ValidatedTableRow>,
  filters: ValidatedFilterSelections,
): Array<ValidatedTableRow> {
  return rows.filter((row) => {
    if (!matchesText(filters.q, row)) return false
    if (!hasFacetValue(filters.year, row.year)) return false
    if (!hasFacetValue(filters.month, row.month)) return false
    if (!hasFacetValue(filters.quarter, row.quarter)) return false
    if (!hasFacetValue(filters.entity, row.entity)) return false
    if (!hasFacetValue(filters.customerType, row.customerType)) return false
    if (!hasFacetValue(filters.customerName, row.customerName)) return false
    if (!hasFacetValue(filters.atc, row.atc)) return false
    if (!hasErrorType(filters.errorType, row.errorTypes)) return false

    return true
  })
}
