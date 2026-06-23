import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'

import type { Bir2307ExportRow } from '@/lib/bir2307-export-server'
import type { documentResults } from '@/lib/schema'
import {
  buildBir2307ExportWorkbook,
  mapDocumentResultToBir2307Rows,
  parseBir2307Period,
} from '@/lib/bir2307-export-server'

const buildExportRow = (
  overrides: Partial<Bir2307ExportRow> = {},
): Bir2307ExportRow => ({
  period: 'August 2025',
  payeeName: 'THERMA LUZON, INC.',
  payeeTin: '266-567-164-0000',
  payeeAddress: '10 Quezon Avenue, Quezon City',
  payeeHasAddress: 'Yes',
  payeeHasZip: 'No',
  payorName: 'GREEN FUTURE INNOVATIONS, INC.',
  payorTin: '006-922-063-000',
  payorAddress: '20 Ayala Avenue, Makati City',
  payorHasAddress: 'Yes',
  payorHasZip: 'Yes',
  hasPrintedName: 'Yes',
  hasSignature: 'Yes',
  atcCode: 'WC160',
  taxBase: 1000.25,
  taxWithheld: 1.71,
  duplicateStatus: 'UNIQUE',
  condition: 'GOOD',
  ...overrides,
})

const buildDocumentRecord = (
  overrides: Partial<typeof documentResults.$inferSelect> = {},
) =>
  ({
    id: 1,
    jobId: 'job-1',
    eventId: 'event-1',
    batchId: '11111111-1111-1111-1111-111111111111',
    uploadId: '22222222-2222-2222-2222-222222222222',
    sourceFileId: 'source-1',
    revision: 'v1',
    outcome: 'Done',
    status: 'success',
    finalKey: null,
    originalFileName: 'certificate.pdf',
    sourceHash: null,
    dataFingerprint: null,
    reasonCodes: [],
    payload: {
      normalized: {
        periodEnd: '08-31-2025',
        payeeName: 'Payee A',
        payeeTin: '111 - 222 - 333 - 000',
        payeeAddress: '1 Main St.',
        payeeZip: '',
        payorName: 'Payor A',
        payorTin: '444 555 666 000',
        payorAddress: '2 Main St.',
        payorZip: '1226',
        printedName: 'Juan Dela Cruz',
        signaturePresent: true,
        atcCode: 'WC160',
        taxBase: 1000.25,
        taxWithheld: 1.71,
      },
    },
    validation: {},
    artifactKey: null,
    createdAt: new Date('2026-04-29T00:00:00.000Z'),
    ...overrides,
  }) as typeof documentResults.$inferSelect

const expectBlankErrorRow = (row: Bir2307ExportRow | undefined) => {
  expect(row).toEqual({
    period: null,
    payeeName: null,
    payeeTin: null,
    payeeAddress: null,
    payeeHasAddress: null,
    payeeHasZip: null,
    payorName: null,
    payorTin: null,
    payorAddress: null,
    payorHasAddress: null,
    payorHasZip: null,
    hasPrintedName: null,
    hasSignature: null,
    atcCode: null,
    taxBase: null,
    taxWithheld: null,
    duplicateStatus: 'UNIQUE',
    condition: 'ERROR',
  })
}

describe('bir2307-export-server', () => {
  it('parses period end dates and falls back to the last date in a range', () => {
    const periodEnd = parseBir2307Period('08-31-2025')
    const rangeEnd = parseBir2307Period('08-01-2025 to 08-31-2025')

    expect(periodEnd?.getFullYear()).toBe(2025)
    expect(periodEnd?.getMonth()).toBe(7)
    expect(periodEnd?.getDate()).toBe(31)
    expect(rangeEnd?.getFullYear()).toBe(2025)
    expect(rangeEnd?.getMonth()).toBe(7)
    expect(rangeEnd?.getDate()).toBe(31)
  })

  it('maps success, duplicate, and validation-error document payloads', () => {
    const successRows = mapDocumentResultToBir2307Rows(buildDocumentRecord())
    const duplicateRows = mapDocumentResultToBir2307Rows(
      buildDocumentRecord({
        outcome: 'Duplicate',
        status: 'duplicate',
        reasonCodes: ['duplicate_identical_data'],
        payload: {
          pages: [
            {
              classification: 'certificate',
              normalized: {
                periodCovered: '08-01-2025 to 08-31-2025',
                payeeName: 'Duplicate Payee',
                payeeTin: ' 111 - 222 ',
                payeeAddress: 'Duplicate Payee Address',
                payorName: 'Duplicate Payor',
                payorTin: ' 333 444 ',
                payorAddress: 'Duplicate Payor Address',
                signaturePresent: true,
                atcCode: 'WC160',
                taxBase: '200.50',
                taxWithheld: '2.50',
              },
            },
          ],
        },
      }),
    )
    const errorRows = mapDocumentResultToBir2307Rows(
      buildDocumentRecord({
        outcome: 'Error',
        status: 'error',
      }),
    )

    expect(successRows).toEqual([
      expect.objectContaining({
        period: 'August 2025',
        payeeName: 'Payee A',
        payeeTin: '111-222-333-000',
        payeeAddress: '1 Main St.',
        payeeHasAddress: 'Yes',
        payeeHasZip: 'No',
        payorTin: '444-555-666-000',
        payorAddress: '2 Main St.',
        payorHasAddress: 'Yes',
        taxBase: 1000.25,
        taxWithheld: 1.71,
        duplicateStatus: 'UNIQUE',
        condition: 'GOOD',
      }),
    ])
    expect(duplicateRows).toEqual([
      expect.objectContaining({
        payeeName: 'Duplicate Payee',
        payeeTin: '111-222',
        payeeAddress: 'Duplicate Payee Address',
        payeeHasAddress: 'Yes',
        payeeHasZip: 'No',
        payorTin: '333-444',
        payorAddress: 'Duplicate Payor Address',
        payorHasAddress: 'Yes',
        payorHasZip: 'No',
        hasSignature: 'Yes',
        taxBase: 200.5,
        taxWithheld: 2.5,
        duplicateStatus: 'DUPLICATE',
        condition: 'GOOD',
      }),
    ])
    expect(errorRows).toEqual([
      expect.objectContaining({
        period: 'August 2025',
        taxBase: 1000.25,
        taxWithheld: 1.71,
        duplicateStatus: 'UNIQUE',
        condition: 'ERROR',
      }),
    ])
  })

  it('maps period labels from month of quarter and falls back to period end', () => {
    const monthOfQuarterRows = mapDocumentResultToBir2307Rows(
      buildDocumentRecord({
        payload: {
          normalized: {
            periodEnd: '09-30-2026',
            monthOfQuarter: 'third',
            payeeName: 'Payee A',
          },
        },
      }),
    )
    const invalidMonthRows = mapDocumentResultToBir2307Rows(
      buildDocumentRecord({
        payload: {
          normalized: {
            periodEnd: '09-30-2026',
            monthOfQuarter: 'fourth',
            payeeName: 'Payee A',
          },
        },
      }),
    )
    const missingPeriodRows = mapDocumentResultToBir2307Rows(
      buildDocumentRecord({
        payload: {
          normalized: {
            periodEnd: 'not a date',
            monthOfQuarter: 'first',
            payeeName: 'Payee A',
          },
        },
      }),
    )

    expect(monthOfQuarterRows[0]?.period).toBe('September 2026')
    expect(invalidMonthRows[0]?.period).toBe('September 2026')
    expect(missingPeriodRows[0]?.period).toBeNull()
  })

  it('exports one first-page row for multiple-certificate error payloads', () => {
    const rows = mapDocumentResultToBir2307Rows(
      buildDocumentRecord({
        outcome: 'Error',
        status: 'error',
        reasonCodes: ['multiple_certificate_pages_detected'],
        payload: {
          pages: [
            {
              pageNumber: 1,
              classification: 'certificate',
              normalized: {
                periodCovered: '08-01-2025 to 08-31-2025',
                payeeName: 'First Page Payee',
                payeeTin: '111-222-333-000',
                payeeAddress: 'First Page Payee Address',
                payorName: 'First Page Payor',
                payorTin: '444-555-666-000',
                payorAddress: 'First Page Payor Address',
                signaturePresent: false,
                atcCode: 'WC160',
                taxBase: '1250.75',
                taxWithheld: '2.50',
              },
            },
            {
              pageNumber: 2,
              classification: 'non_certificate',
            },
            {
              pageNumber: 3,
              classification: 'certificate',
            },
          ],
          normalized: {
            payeeName: 'Fallback Payee',
          },
        },
      }),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(
      expect.objectContaining({
        payeeName: 'First Page Payee',
        payeeTin: '111-222-333-000',
        payeeAddress: 'First Page Payee Address',
        payorName: 'First Page Payor',
        payorTin: '444-555-666-000',
        payorAddress: 'First Page Payor Address',
        hasSignature: 'No',
        taxBase: 1250.75,
        taxWithheld: 2.5,
        duplicateStatus: 'UNIQUE',
        condition: 'ERROR',
      }),
    )
  })

  it('exports one blank error row when no certificate pages are detected', () => {
    const rows = mapDocumentResultToBir2307Rows(
      buildDocumentRecord({
        outcome: 'Error',
        status: 'error',
        reasonCodes: ['no_certificate_pages_detected'],
        payload: {
          pages: [
            {
              pageNumber: 1,
              classification: 'non_certificate',
            },
          ],
          validation: {
            reasons: ['no_certificate_pages_detected'],
          },
        },
      }),
    )

    expect(rows).toHaveLength(1)
    expectBlankErrorRow(rows[0])
  })

  it('exports one blank error row when multiple-certificate payloads lack normalized fields', () => {
    const rows = mapDocumentResultToBir2307Rows(
      buildDocumentRecord({
        outcome: 'Error',
        status: 'error',
        reasonCodes: ['multiple_certificate_pages_detected'],
        payload: {
          pages: [
            {
              pageNumber: 1,
              classification: 'certificate',
            },
            {
              pageNumber: 2,
              classification: 'certificate',
            },
          ],
          validation: {
            reasons: ['multiple_certificate_pages_detected'],
          },
        },
      }),
    )

    expect(rows).toHaveLength(1)
    expectBlankErrorRow(rows[0])
  })

  it('builds the template workbook with cleared sample rows and exported data', async () => {
    const rows = [
      buildExportRow(),
      buildExportRow({
        payeeTin: ' 266 - 567 - 164 - 0000 ',
        payorTin: '006 922 063 000',
        period: 'September 2025',
        payeeName: 'Duplicate Payee',
        payeeAddress: null,
        payeeHasAddress: null,
        payeeHasZip: null,
        taxWithheld: 2.5,
        duplicateStatus: 'DUPLICATE',
      }),
      buildExportRow({
        period: null,
        payeeName: 'Error Payee',
        taxBase: null,
        taxWithheld: null,
        condition: 'ERROR',
      }),
    ]

    const workbookBuffer = await buildBir2307ExportWorkbook(rows)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(workbookBuffer as never)
    const worksheet = workbook.getWorksheet('Sheet1')

    expect(worksheet?.getCell('A1').value).toBe('2307 DETAILS')
    expect(worksheet?.getCell('A3').value).toBe('Period')
    expect(worksheet?.getCell('D3').value).toBe('Address')
    expect(worksheet?.getCell('I3').value).toBe('Address')
    expect(worksheet?.getCell('N3').value).toBe('ATC')
    expect(worksheet?.getCell('O3').value).toBe('Tax Base')
    expect(worksheet?.getCell('P3').value).toBe('Tax Withheld')
    expect(worksheet?.getCell('Q3').value).toBe('Duplicate or Unique?')
    expect(worksheet?.getCell('R3').value).toBe('Condition')
    expect(
      (
        worksheet as unknown as {
          model: { merges: Array<string> }
        }
      ).model.merges,
    ).toEqual(
      expect.arrayContaining(['A1:R1', 'B2:F2', 'G2:P2', 'Q2:Q3', 'R2:R3']),
    )
    expect(worksheet?.getCell('A4').value).toBe('August 2025')
    expect(worksheet?.getCell('B4').value).toBe('THERMA LUZON, INC.')
    expect(worksheet?.getCell('C4').value).toBe('266-567-164-0000')
    expect(worksheet?.getCell('D4').value).toBe('10 Quezon Avenue, Quezon City')
    expect(worksheet?.getCell('E4').value).toBe('Yes')
    expect(worksheet?.getCell('F4').value).toBe('No')
    expect(worksheet?.getCell('H4').value).toBe('006-922-063-000')
    expect(worksheet?.getCell('I4').value).toBe('20 Ayala Avenue, Makati City')
    expect(worksheet?.getCell('J4').value).toBe('Yes')
    expect(worksheet?.getCell('K4').value).toBe('Yes')
    expect(worksheet?.getCell('O4').value).toBe(1000.25)
    expect(worksheet?.getCell('P4').value).toBe(1.71)
    expect(worksheet?.getCell('Q4').value).toBe('UNIQUE')
    expect(worksheet?.getCell('R4').value).toBe('GOOD')
    expect(worksheet?.getCell('C5').value).toBe('266-567-164-0000')
    expect(worksheet?.getCell('D5').value).toBeNull()
    expect(worksheet?.getCell('F5').value).toBe('No')
    expect(worksheet?.getCell('H5').value).toBe('006-922-063-000')
    expect(worksheet?.getCell('K5').value).toBe('Yes')
    expect(worksheet?.getCell('Q5').value).toBe('DUPLICATE')
    expect(worksheet?.getCell('R5').value).toBe('GOOD')
    expect(worksheet?.getCell('R6').value).toBe('ERROR')
    expect(worksheet?.getCell('B7').value).toBeNull()
    expect(worksheet?.getCell('R14').value).toBeNull()
    expect(worksheet?.getCell('A4').numFmt).toBe('@')
    expect(worksheet?.getCell('O4').numFmt).toBe('#,##0.00')
    expect(worksheet?.getCell('P4').numFmt).toBe('#,##0.00')
    expect(worksheet?.getCell('B4').fill).toMatchObject({
      type: 'pattern',
      pattern: 'none',
    })
    expect(worksheet?.getCell('R4').fill).toMatchObject({
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFC6EFCE' },
    })
    expect(worksheet?.getCell('R6').fill).toMatchObject({
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFC7CE' },
    })
    expect(worksheet?.getCell('B4').border).toMatchObject({
      top: { style: 'thin' },
    })
    expect(worksheet?.getCell('D5').value).toBeNull()
    expect(worksheet?.getCell('D5').border).toMatchObject({
      top: { style: 'thin' },
    })
    expect(worksheet?.getCell('A6').value).toBeNull()
    expect(worksheet?.getCell('A6').border).toMatchObject({
      top: { style: 'thin' },
    })
    expect(worksheet?.getCell('O6').value).toBeNull()
    expect(worksheet?.getCell('O6').border).toMatchObject({
      top: { style: 'thin' },
    })
    expect(worksheet?.getCell('P6').value).toBeNull()
    expect(worksheet?.getCell('P6').border).toMatchObject({
      top: { style: 'thin' },
    })
    expect(worksheet?.getCell('B7').border).toEqual({})
    expect(worksheet?.getCell('R14').border ?? {}).toEqual({})
  })
})
