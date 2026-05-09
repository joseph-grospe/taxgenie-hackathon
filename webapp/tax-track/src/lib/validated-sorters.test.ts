import { describe, expect, it } from 'vitest'

import type { ValidatedTableRow } from '@/lib/validated-table-model'
import { sortValidatedRows } from '@/lib/validated-sorters'

const rows: Array<ValidatedTableRow> = [
  {
    docId: 'VAL-3',
    fileName: 'file-3.pdf',
    customerName: 'Harbor Utilities',
    payee: 'Harbor Utilities',
    atc: 'WC158',
    taxBase: '48,200.00',
    taxBaseNumber: 48200,
    taxWithheld: '482.00',
    taxWithheldNumber: 482,
    period: 'Q4 2025',
    confidence: '0.84',
    status: 'Ready',
    year: '2025',
    month: 'November',
    quarter: 'Q4',
    entity: 'AESI',
    customerType: 'Non-Trade',
    errorTypes: ['None'],
  },
  {
    docId: 'VAL-1',
    fileName: 'file-1.pdf',
    customerName: 'Solaris Grid',
    payee: 'Solaris Grid',
    atc: 'WC051',
    taxBase: '11,500.00',
    taxBaseNumber: 11500,
    taxWithheld: '1,725.00',
    taxWithheldNumber: 1725,
    period: 'Q4 2025',
    confidence: '0.93',
    status: 'Ready',
    year: '2025',
    month: 'January',
    quarter: 'Q4',
    entity: 'AESI',
    customerType: 'Regular',
    errorTypes: ['None'],
  },
  {
    docId: 'VAL-2',
    fileName: 'file-2.pdf',
    customerName: 'MetroLine Energy',
    payee: 'MetroLine Energy',
    atc: 'WC160',
    taxBase: '27,340.00',
    taxBaseNumber: 27340,
    taxWithheld: '546.80',
    taxWithheldNumber: 546.8,
    period: 'Q1 2024',
    confidence: '0.89',
    status: 'Ready',
    year: '2024',
    month: 'December',
    quarter: 'Q1',
    entity: 'IEMOP',
    customerType: 'IEMOP',
    errorTypes: ['Missing TIN'],
  },
]

describe('validated-sorters', () => {
  it('sorts by amount descending and ascending', () => {
    const desc = sortValidatedRows(rows, { sortBy: 'amount', sortDir: 'desc' })
    expect(desc.map((row) => row.docId)).toEqual(['VAL-1', 'VAL-2', 'VAL-3'])

    const asc = sortValidatedRows(rows, { sortBy: 'amount', sortDir: 'asc' })
    expect(asc.map((row) => row.docId)).toEqual(['VAL-3', 'VAL-2', 'VAL-1'])
  })

  it('sorts months in calendar order', () => {
    const sorted = sortValidatedRows(rows, { sortBy: 'month', sortDir: 'asc' })
    expect(sorted.map((row) => row.month)).toEqual([
      'January',
      'November',
      'December',
    ])
  })

  it('sorts quarter by year then quarter number and remains stable with tie-breaker', () => {
    const sorted = sortValidatedRows(rows, {
      sortBy: 'quarter',
      sortDir: 'asc',
    })
    expect(sorted.map((row) => row.docId)).toEqual(['VAL-2', 'VAL-1', 'VAL-3'])
  })
})
