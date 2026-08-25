import { describe, expect, it } from 'vitest'

import type { OperationalDocumentView } from '@/lib/documents-types'
import {
  classifyErrorType,
  deriveMonthFromFileName,
  parseAmount,
  parsePeriod,
  toValidatedTableRows,
  toValidatedTableRowsFromOperationalDocuments,
} from '@/lib/validated-table-model'

describe('validated-table-model', () => {
  it('classifies missing extracted source values for issue filters', () => {
    expect(classifyErrorType('Payor name is missing')).toBe('Missing Name')
    expect(classifyErrorType('Period covered is missing')).toBe(
      'Incomplete Period',
    )
    expect(classifyErrorType('Period information is incomplete.')).toBe(
      'Incomplete Period',
    )
    expect(classifyErrorType('Tax base is missing')).toBe('Missing Tax Data')
  })

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
        payorName: 'Payor Corp',
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

  it('uses payor name as the validated customer value for static rows', () => {
    const rows = toValidatedTableRows([
      {
        id: 'VAL-9002',
        fileName: 'manual_upload.pdf',
        payee: 'Payee Corp',
        payorName: 'Payor Corp',
        period: 'Q2 2025',
        atc: 'WC160',
        taxBase: '10,000.00',
        taxWithheld: '200.00',
        confidence: '0.91',
        status: 'Ready',
      },
    ])

    expect(rows[0].customerName).toBe('Payor Corp')
  })

  it('uses payor name as the validated customer value for operational documents', () => {
    const document: OperationalDocumentView = {
      id: '123',
      kind: 'certificate',
      uploadId: 'upload-123',
      fileName: 'manual_upload.pdf',
      status: 'Ready',
      stage: 'Validated',
      nextStep: 'Review or export',
      payee: 'Payee Corp',
      payorName: 'Payor Corp',
      period: 'Q2 2025',
      atc: 'WC160',
      atcCodes: ['WC160'],
      taxRows: [],
      taxBase: '10,000.00',
      taxWithheld: '200.00',
      confidence: '0.91',
      year: '2025',
      month: 'June',
      quarter: 'Q2',
      entity: 'Manual Upload',
      customerType: 'BIR 2307',
      errorTypes: ['None'],
      issueReason: 'Processed certificate.',
      severity: 'Low',
      owner: 'Tax Desk',
      updatedAt: 'Apr 23, 2026, 08:27 PM',
      trail: [],
      logs: [],
      errors: [],
      validationChecks: [],
      reviewFields: [],
      canSign: false,
      signingStatus: 'unsigned',
      hasSavedTemplatePlacement: false,
    }

    const rows = toValidatedTableRowsFromOperationalDocuments([document])

    expect(rows[0].customerName).toBe('Payor Corp')
  })
})
