import type {
  ValidatedSortBy,
  ValidatedSortDir,
} from '@/lib/validated-search-state'
import type { ValidatedTableRow } from '@/lib/validated-table-model'
import { getMonthSortIndex } from '@/lib/validated-table-model'

export type ValidatedSortState = {
  sortBy: ValidatedSortBy
  sortDir: ValidatedSortDir
}

const sortDirectionMultiplier = (sortDir: ValidatedSortDir) =>
  sortDir === 'asc' ? 1 : -1

const compareText = (left: string, right: string): number =>
  left.localeCompare(right, undefined, { sensitivity: 'base' })

const quarterToNumber = (quarter: string): number => {
  const match = quarter.match(/^Q([1-4])$/i)
  if (!match) return -1
  return Number.parseInt(match[1], 10)
}

const compareBySorter = (
  left: ValidatedTableRow,
  right: ValidatedTableRow,
  sortBy: ValidatedSortBy,
): number => {
  if (sortBy === 'amount') {
    return left.taxWithheldNumber - right.taxWithheldNumber
  }

  if (sortBy === 'customer' || sortBy === 'customerName') {
    return compareText(left.customerName, right.customerName)
  }

  if (sortBy === 'year') {
    return Number.parseInt(left.year, 10) - Number.parseInt(right.year, 10)
  }

  if (sortBy === 'month') {
    return getMonthSortIndex(left.month) - getMonthSortIndex(right.month)
  }

  if (sortBy === 'quarter') {
    const yearDelta =
      Number.parseInt(left.year, 10) - Number.parseInt(right.year, 10)
    if (yearDelta !== 0) return yearDelta
    return quarterToNumber(left.quarter) - quarterToNumber(right.quarter)
  }

  if (sortBy === 'entity') {
    return compareText(left.entity, right.entity)
  }

  if (sortBy === 'customerType') {
    return compareText(left.customerType, right.customerType)
  }

  if (sortBy === 'errorType') {
    return compareText(left.errorTypes.join(', '), right.errorTypes.join(', '))
  }

  return compareText(left.atc, right.atc)
}

export function sortValidatedRows(
  rows: Array<ValidatedTableRow>,
  sort: ValidatedSortState,
): Array<ValidatedTableRow> {
  const multiplier = sortDirectionMultiplier(sort.sortDir)

  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const comparison = compareBySorter(left.row, right.row, sort.sortBy)
      if (comparison !== 0) return comparison * multiplier

      const idComparison = compareText(left.row.docId, right.row.docId)
      if (idComparison !== 0) return idComparison

      return left.index - right.index
    })
    .map((item) => item.row)
}
