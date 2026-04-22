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

export const filterReconciliationRows = (
  rows: Array<ReconciliationRowView>,
  searchTerm: string,
  filterValue: ReconciliationTableFilterValue,
) => {
  const normalizedSearch = searchTerm.trim().toLowerCase()

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
