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
  period: new Date(2025, 7, 31),
  payeeName: 'THERMA LUZON, INC.',
  payeeTin: '266-567-164-0000',
  payeeHasAddress: 'Yes',
  payeeHasZip: 'No',
  payorName: 'GREEN FUTURE INNOVATIONS, INC.',
  payorTin: '006-922-063-000',
  payorHasAddress: 'Yes',
  payorHasZip: 'Yes',
  hasPrintedName: 'Yes',
  hasSignature: 'Yes',
  atcCode: 'WC160',
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
    documentKind: 'certificate',
    pageNumber: 1,
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
        taxWithheld: 1.71,
      },
    },
    validation: {},
    artifactKey: null,
    createdAt: new Date('2026-04-29T00:00:00.000Z'),
    ...overrides,
  }) as typeof documentResults.$inferSelect

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
        documentKind: 'upload',
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
                payorName: 'Duplicate Payor',
                payorTin: ' 333 444 ',
                signatureText: 'signed',
                atcCode: 'WC160',
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
        payeeName: 'Payee A',
        payeeTin: '111-222-333-000',
        payeeHasAddress: 'Yes',
        payeeHasZip: 'No',
        payorTin: '444555666000',
        duplicateStatus: 'UNIQUE',
        condition: 'GOOD',
      }),
    ])
    expect(duplicateRows).toEqual([
      expect.objectContaining({
        payeeName: 'Duplicate Payee',
        payeeTin: '111-222',
        payeeHasZip: 'No',
        payorTin: '333444',
        payorHasZip: 'No',
        hasSignature: 'Yes',
        taxWithheld: 2.5,
        duplicateStatus: 'DUPLICATE',
        condition: 'GOOD',
      }),
    ])
    expect(errorRows).toEqual([
      expect.objectContaining({
        duplicateStatus: 'UNIQUE',
        condition: 'ERROR',
      }),
    ])
  })

  it('builds the template workbook with cleared sample rows and exported data', async () => {
    const rows = [
      buildExportRow(),
      buildExportRow({
        payeeTin: ' 266 - 567 - 164 - 0000 ',
        payorTin: '006 922 063 000',
        period: new Date(2025, 8, 30),
        payeeName: 'Duplicate Payee',
        payeeHasAddress: null,
        payeeHasZip: null,
        taxWithheld: 2.5,
        duplicateStatus: 'DUPLICATE',
      }),
      buildExportRow({
        period: null,
        payeeName: 'Error Payee',
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
    expect(worksheet?.getCell('M3').value).toBe('Tax Withheld')
    expect(worksheet?.getCell('A4').value).toBeInstanceOf(Date)
    expect(worksheet?.getCell('B4').value).toBe('THERMA LUZON, INC.')
    expect(worksheet?.getCell('C4').value).toBe('266-567-164-0000')
    expect(worksheet?.getCell('G4').value).toBe('006-922-063-000')
    expect(worksheet?.getCell('D4').value).toBe('Yes')
    expect(worksheet?.getCell('E4').value).toBe('No')
    expect(worksheet?.getCell('M4').value).toBe(1.71)
    expect(worksheet?.getCell('N4').value).toBe('UNIQUE')
    expect(worksheet?.getCell('O4').value).toBe('GOOD')
    expect(worksheet?.getCell('C5').value).toBe('266-567-164-0000')
    expect(worksheet?.getCell('E5').value).toBe('No')
    expect(worksheet?.getCell('G5').value).toBe('006922063000')
    expect(worksheet?.getCell('I5').value).toBe('Yes')
    expect(worksheet?.getCell('N5').value).toBe('DUPLICATE')
    expect(worksheet?.getCell('O5').value).toBe('GOOD')
    expect(worksheet?.getCell('O6').value).toBe('ERROR')
    expect(worksheet?.getCell('B7').value).toBeNull()
    expect(worksheet?.getCell('N14').value).toBeNull()
    expect(worksheet?.getCell('A4').numFmt).toBe('mm-dd-yy')
    expect(worksheet?.getCell('M4').numFmt).toBe('#,##0.00')
    expect(worksheet?.getCell('B4').fill).toMatchObject({
      type: 'pattern',
      pattern: 'none',
    })
    expect(worksheet?.getCell('O4').fill).toMatchObject({
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFC6EFCE' },
    })
    expect(worksheet?.getCell('O6').fill).toMatchObject({
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
    expect(worksheet?.getCell('M6').value).toBeNull()
    expect(worksheet?.getCell('M6').border).toMatchObject({
      top: { style: 'thin' },
    })
    expect(worksheet?.getCell('B7').border).toEqual({})
    expect(worksheet?.getCell('N14').border).toEqual({})
  })
})
