import { describe, expect, it } from 'vitest'

import type { ValidatedFilterSelections } from '@/lib/validated-filters'
import type { ValidatedRouteSearch } from '@/lib/validated-search-state'
import { validatedDocuments } from '@/data/mock-data'
import { filterValidatedRows } from '@/lib/validated-filters'
import {
  buildValidatedDocumentsQueryParams,
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
      customerName: 'aboitiz',
      year: '2025-12',
      month: '2025-12',
      sortBy: 'customer',
      sortDir: 'asc',
      page: '2',
      pageSize: '50',
    })

    const rows = getRowsFromSearch(search)

    expect(search.customerName).toBe('aboitiz')
    expect(search.year).toBe('2025-12')
    expect(search.month).toBe('2025-12')
    expect(search.sortBy).toBe('customer')
    expect(search.sortDir).toBe('asc')
    expect(search.page).toBe(2)
    expect(search.pageSize).toBe(50)
    expect(rows).toHaveLength(1)
    expect(rows[0].customerName).toBe('Aboitiz Energy Solutions, Inc.')
  })

  it('builds backend query params with safe pagination defaults', () => {
    const search = parseValidatedSearch({
      entity: 'AESI',
      quarter: 'Q4,Q3',
      sortBy: 'entity',
      sortDir: 'asc',
      page: '-10',
      pageSize: '999',
    })

    const params = buildValidatedDocumentsQueryParams(search)

    expect(search.page).toBe(1)
    expect(search.pageSize).toBe(25)
    expect(params.toString()).toBe(
      'quarter=Q4%2CQ3&entity=AESI&sortBy=entity&sortDir=asc&page=1&pageSize=25',
    )
  })

  it('updates URL facet value and row set when a filter chip is removed', () => {
    const initial = parseValidatedSearch({
      customerName: 'Aboitiz Energy Solutions, Inc.',
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

  it('clears filters while preserving sorter with clear-filters behavior', () => {
    const filtered = parseValidatedSearch({
      customerName: 'bukidnon',
      year: '2025-12',
      month: '2025-12',
      sortBy: 'customer',
      sortDir: 'asc',
      page: '3',
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
      page: 1,
    })

    const clearedRows = getRowsFromSearch(cleared)

    expect(cleared.customerName).toBe('')
    expect(cleared.sortBy).toBe('customer')
    expect(cleared.sortDir).toBe('asc')
    expect(cleared.page).toBe(1)
    expect(clearedRows).toHaveLength(3)
  })
})
