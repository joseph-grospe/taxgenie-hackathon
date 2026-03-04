import { describe, expect, it } from 'vitest'

import type { ValidatedTableRow } from '@/lib/validated-table-model'
import type { ValidatedFilterSelections } from '@/lib/validated-filters'
import { filterValidatedRows } from '@/lib/validated-filters'

const rows: Array<ValidatedTableRow> = [
  {
    docId: 'VAL-1',
    fileName: 'file-1.pdf',
    customerName: 'Solaris Grid',
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

  it('supports date-range and free-text filters together', () => {
    const filtered = filterValidatedRows(rows, {
      ...emptyFilters,
      q: '2025-12 to 2025-12',
      customerName: 'solaris',
    })

    expect(filtered).toHaveLength(1)
    expect(filtered[0].customerName).toBe('Solaris Grid')
  })

  it('returns all rows when filters are empty', () => {
    const filtered = filterValidatedRows(rows, emptyFilters)
    expect(filtered).toHaveLength(2)
  })
})
