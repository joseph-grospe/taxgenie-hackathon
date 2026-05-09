import { normalizeTinDigits } from '@taxtrack/shared/utils/tin'

import type { ReconciliationRowView } from '@/lib/reconciliation-types'

export const reconciliationTableFilterOptions = [
  { label: 'All Rows', value: 'all' },
  { label: 'Matched', value: 'matched' },
  { label: 'Unmatched', value: 'unmatched' },
  { label: 'Has Difference', value: 'difference' },
] as const

export const reconciliationPageSizeOptions = ['10', '25', '50', '100'] as const

export type ReconciliationTableFilterValue =
  (typeof reconciliationTableFilterOptions)[number]['value']

export const sortReconciliationRowsByCustomerName = (
  rows: Array<ReconciliationRowView>,
) =>
  rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const comparison = left.row.customerName.localeCompare(
        right.row.customerName,
        undefined,
        { sensitivity: 'base' },
      )

      return comparison === 0 ? left.index - right.index : comparison
    })
    .map((item) => item.row)

export const filterReconciliationRows = (
  rows: Array<ReconciliationRowView>,
  searchTerm: string,
  filterValue: ReconciliationTableFilterValue,
) => {
  const normalizedSearch = searchTerm.trim().toLowerCase()
  const normalizedTinSearch = normalizeTinDigits(searchTerm)

  return rows.filter((row) => {
    if (filterValue === 'matched' && row.matchStatus !== 'matched') {
      return false
    }

    if (filterValue === 'unmatched' && row.matchStatus !== 'unmatched') {
      return false
    }

    if (filterValue === 'difference' && !row.hasDifference) {
      return false
    }

    if (!normalizedSearch) {
      return true
    }

    const normalizedRowTin = normalizeTinDigits(row.tin)
    if (
      normalizedTinSearch &&
      normalizedRowTin?.includes(normalizedTinSearch)
    ) {
      return true
    }

    const searchableFields = [
      row.customerName,
      row.tin,
      row.invoiceNumber,
      row.accountingDate ?? '',
      row.transactionLineDescription,
      row.issuerShortnameUsedForMatch,
      row.derivedBillingMonthMMYY,
      row.matchStatus,
    ]

    return searchableFields.some((field) =>
      field.toLowerCase().includes(normalizedSearch),
    )
  })
}

export const paginateReconciliationRows = (
  rows: Array<ReconciliationRowView>,
  page: number,
  pageSize: number,
) => {
  const start = (page - 1) * pageSize
  return rows.slice(start, start + pageSize)
}
