import { describe, expect, it } from 'vitest'

import type { ValidatedFilterSelections } from '@/lib/validated-filters'
import type { ValidatedRouteSearch } from '@/lib/validated-search-state'
import { validatedDocuments } from '@/data/mock-data'
import { filterValidatedRows } from '@/lib/validated-filters'
import {
  decodeCsv,
  parseValidatedSearch,
} from '@/lib/validated-search-state'
import { sortValidatedRows } from '@/lib/validated-sorters'
import { toValidatedTableRows } from '@/lib/validated-table-model'

const toFilterSelections = (
  search: ValidatedRouteSearch,
): ValidatedFilterSelections => ({
  q: search.q,
  year: search.year,
  month: search.month,
  quarter: decodeCsv(search.quarter),
  entity: search.entity,
  customerType: decodeCsv(search.customerType),
  customerName: search.customerName,
  errorType: decodeCsv(search.errorType),
  atc: decodeCsv(search.atc),
})

const getRowsFromSearch = (search: ValidatedRouteSearch) => {
  const tableRows = toValidatedTableRows(validatedDocuments)
  const filtered = filterValidatedRows(tableRows, toFilterSelections(search))
  return sortValidatedRows(filtered, {
    sortBy: search.sortBy,
    sortDir: search.sortDir,
  })
}

describe('/validated route behavior', () => {
  it('hydrates URL search into selected filters and sorter', () => {
    const search = parseValidatedSearch({
      customerName: 'solaris',
      year: '2025-12',
      month: '2025-12',
      sortBy: 'customer',
      sortDir: 'asc',
    })

    const rows = getRowsFromSearch(search)

    expect(search.customerName).toBe('solaris')
    expect(search.year).toBe('2025-12')
    expect(search.month).toBe('2025-12')
    expect(search.sortBy).toBe('customer')
    expect(search.sortDir).toBe('asc')
    expect(rows).toHaveLength(1)
    expect(rows[0].customerName).toBe('Solaris Grid')
  })

  it('updates URL facet value and row set when a filter chip is removed', () => {
    const initial = parseValidatedSearch({
      customerName: 'Solaris Grid',
      sortBy: 'amount',
      sortDir: 'desc',
    })

    const initialRows = getRowsFromSearch(initial)
    expect(initialRows).toHaveLength(1)

    const updated = parseValidatedSearch({
      ...initial,
      customerName: '',
    })

    const updatedRows = getRowsFromSearch(updated)

    expect(updated.customerName).toBe('')
    expect(updatedRows).toHaveLength(3)
  })

  it('resets filters and sorter to defaults with clear-all behavior', () => {
    const filtered = parseValidatedSearch({
      customerName: 'metro',
      year: '2025-12',
      month: '2025-12',
      sortBy: 'customer',
      sortDir: 'asc',
    })

    expect(getRowsFromSearch(filtered)).toHaveLength(1)

    const cleared = parseValidatedSearch({
      ...filtered,
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
    })

    const clearedRows = getRowsFromSearch(cleared)

    expect(cleared.customerName).toBe('')
    expect(cleared.sortBy).toBe('amount')
    expect(cleared.sortDir).toBe('desc')
    expect(clearedRows).toHaveLength(3)
  })
})
