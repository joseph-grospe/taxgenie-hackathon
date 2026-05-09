import { describe, expect, it } from 'vitest'

import type { ValidatedTableRow } from '@/lib/validated-table-model'
import type { ValidatedFilterSelections } from '@/lib/validated-filters'
import { filterValidatedRows } from '@/lib/validated-filters'

const rows: Array<ValidatedTableRow> = [
  {
    docId: 'VAL-1',
    fileName: 'file-1.pdf',
    customerName: 'Solaris Grid',
    payee: 'Therma Luzon',
    atc: 'WC051',
    taxBase: '11,500.00',
    taxBaseNumber: 11500,
    taxWithheld: '1,725.00',
    taxWithheldNumber: 1725,
    period: 'Q4 2025',
    confidence: '0.93',
    status: 'Ready',
    year: '2025',
    month: 'December',
    quarter: 'Q4',
    entity: 'AESI',
    customerType: 'Regular',
    errorTypes: ['None'],
  },
  {
    docId: 'VAL-2',
    fileName: 'file-2.pdf',
    customerName: 'MetroLine Energy',
    payee: 'Northshore Power',
    atc: 'WC160',
    taxBase: '27,340.00',
    taxBaseNumber: 27340,
    taxWithheld: '546.80',
    taxWithheldNumber: 546.8,
    period: 'Q4 2025',
    confidence: '0.89',
    status: 'Ready',
    year: '2025',
    month: 'December',
    quarter: 'Q4',
    entity: 'IEMOP',
    customerType: 'IEMOP',
    errorTypes: ['Missing TIN'],
  },
  {
    docId: 'VAL-3',
    fileName: 'file-3.pdf',
    customerName: 'Aurora Storage',
    payee: 'Central Luzon Hydro',
    atc: 'WC158',
    taxBase: '18,000.00',
    taxBaseNumber: 18000,
    taxWithheld: '900.00',
    taxWithheldNumber: 900,
    period: 'January 2024',
    confidence: '0.91',
    status: 'Ready',
    year: '2024',
    month: 'January',
    quarter: 'Q1',
    entity: 'AES',
    customerType: 'Regular',
    errorTypes: ['None'],
  },
]

const emptyFilters: ValidatedFilterSelections = {
  q: '',
  year: '',
  month: '',
  quarter: [],
  entity: '',
  customerType: [],
  customerName: '',
  errorType: [],
  atc: [],
}

describe('validated-filters', () => {
  it('applies OR within facet and AND across facets', () => {
    const filtered = filterValidatedRows(rows, {
      ...emptyFilters,
      atc: ['WC051', 'WC160'],
      customerType: ['IEMOP'],
    })

    expect(filtered).toHaveLength(1)
    expect(filtered[0].docId).toBe('VAL-2')
  })

  it('matches table-wide search across validated document fields', () => {
    const filtered = filterValidatedRows(rows, {
      ...emptyFilters,
      q: 'northshore',
    })

    expect(filtered).toHaveLength(1)
    expect(filtered[0].docId).toBe('VAL-2')
  })

  it('supports explicit date range and table-wide search together', () => {
    const filtered = filterValidatedRows(rows, {
      ...emptyFilters,
      q: 'solaris',
      year: '2025-12-01',
      month: '2025-12-31',
    })

    expect(filtered).toHaveLength(1)
    expect(filtered[0].customerName).toBe('Solaris Grid')
  })

  it('supports exact year, month, and quarter filters', () => {
    const filtered = filterValidatedRows(rows, {
      ...emptyFilters,
      year: '2024',
      month: 'January',
      quarter: ['Q1'],
    })

    expect(filtered).toHaveLength(1)
    expect(filtered[0].docId).toBe('VAL-3')
  })

  it('keeps legacy date-range search tokens working without explicit dates', () => {
    const filtered = filterValidatedRows(rows, {
      ...emptyFilters,
      q: '2025-12 to 2025-12',
    })

    expect(filtered.map((row) => row.docId)).toEqual(['VAL-1', 'VAL-2'])
  })

  it('returns all rows when filters are empty', () => {
    const filtered = filterValidatedRows(rows, emptyFilters)
    expect(filtered).toHaveLength(3)
  })
})
