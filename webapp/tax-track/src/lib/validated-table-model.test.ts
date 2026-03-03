import { describe, expect, it } from 'vitest'

import {
  deriveMonthFromFileName,
  parseAmount,
  parsePeriod,
  toValidatedTableRows,
} from '@/lib/validated-table-model'

describe('validated-table-model', () => {
  it('parses amounts with commas', () => {
    expect(parseAmount('27,340.00')).toBe(27340)
    expect(parseAmount('0.00')).toBe(0)
  })

  it('parses quarter periods', () => {
    expect(parsePeriod('Q1 2025')).toEqual({
      year: '2025',
      month: 'March',
      quarter: 'Q1',
    })
    expect(parsePeriod('Q3 2025')).toEqual({
      year: '2025',
      month: 'September',
      quarter: 'Q3',
    })
  })

  it('derives month from filename and falls back to period when filename is not parseable', () => {
    expect(deriveMonthFromFileName('AESI_201115150_12312025_008.pdf')).toBe(
      'December',
    )

    const rows = toValidatedTableRows([
      {
        id: 'VAL-9001',
        fileName: 'manual_upload.pdf',
        payee: 'Fallback Corp',
        period: 'Q2 2025',
        atc: 'WC160',
        taxBase: '10,000.00',
        taxWithheld: '200.00',
        confidence: '0.91',
        status: 'Ready',
      },
    ])

    expect(rows[0].month).toBe('June')
    expect(rows[0].quarter).toBe('Q2')
  })
})
