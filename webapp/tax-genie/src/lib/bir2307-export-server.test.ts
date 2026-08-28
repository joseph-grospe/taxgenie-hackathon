import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'

import type { Bir2307ExportRow } from '@/lib/bir2307-export-server'
import type { certificateResults, certificateTaxRows } from '@/lib/schema'
import {
  buildBir2307AtcDetailRows,
  buildBir2307ExportRows,
  buildBir2307ExportWorkbook,
  mapCertificateResultToBir2307Row,
  parseBir2307Period,
} from '@/lib/bir2307-export-server'

type CertificateResultRecord = typeof certificateResults.$inferSelect
type CertificateTaxRowRecord = typeof certificateTaxRows.$inferSelect

const buildCertificateRecord = (
  overrides: Partial<CertificateResultRecord> = {},
) =>
  ({
    id: 42,
    documentResultId: 7,
    jobId: 'job-1',
    eventId: 'event-1',
    batchId: '11111111-1111-4111-8111-111111111111',
    entityId: 1,
    entityShortName: 'TLI',
    uploadId: '22222222-2222-4222-8222-222222222222',
    sourceFileId: 'source-1',
    revision: 'v1',
    documentStatus: 'accepted',
    documentType: 'BIR_2307',
    pageCount: 2,
    certificateCount: 1,
    documentReasonCodes: [],
    immutablePayload: {},
    ordinal: 1,
    certificateKey: 'certificate-1',
    pageNumbers: [1, 2],
    status: 'accepted',
    periodStart: '2025-08-01',
    periodEnd: '2025-08-31',
    monthOfQuarter: 'second',
    payeeName: 'THERMA LUZON, INC.',
    payeeTin: '2665671640000',
    payeeAddress: '10 Quezon Avenue, Quezon City',
    payeeZip: null,
    payeeShortName: 'TLI',
    payorName: 'GREEN FUTURE INNOVATIONS, INC.',
    payorTin: '006922063000',
    payorAddress: '20 Ayala Avenue, Makati City',
    payorZip: '1226',
    payorShortName: 'GFI',
    primaryAtcCode: 'WC160',
    totalTaxBase: '1000.25',
    totalTaxWithheld: '20.01',
    signerPrintedName: 'JUAN DELA CRUZ',
    signerTitle: 'Finance Manager',
    signerTin: null,
    signerCompanyName: null,
    signaturePresent: true,
    signatureConfidence: '0.9300',
    signaturePageNumber: 2,
    signatureSource: 'gemini',
    validationStatus: 'valid',
    reasonCodes: [],
    validationSummary: {},
    masterlistResolution: {},
    confidenceSummary: {},
    fingerprint: 'a'.repeat(64),
    immutableExtraction: {},
    artifactKey: 'results/certificate.pdf',
    originalFileName: 'upload.pdf',
    createdAt: new Date('2026-04-29T00:00:00.000Z'),
    updatedAt: new Date('2026-04-29T00:00:00.000Z'),
    ...overrides,
  }) as CertificateResultRecord

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
  taxWithheld: 20.01,
  duplicateStatus: 'UNIQUE',
  condition: 'GOOD',
  ...overrides,
})

const buildTaxRow = (
  overrides: Partial<CertificateTaxRowRecord> = {},
): CertificateTaxRowRecord =>
  ({
    id: 1,
    certificateId: 42,
    lineNumber: 1,
    pageNumber: 1,
    atcCode: 'WC157',
    description: 'Income payments made by government offices',
    firstMonthAmount: '28030.86',
    secondMonthAmount: null,
    thirdMonthAmount: null,
    taxBase: '28030.86',
    taxRate: '0.020000',
    taxWithheld: '560.62',
    evidence: null,
    createdAt: new Date('2026-04-29T00:00:00.000Z'),
    updatedAt: new Date('2026-04-29T00:00:00.000Z'),
    ...overrides,
  }) as CertificateTaxRowRecord

describe('bir2307-export-server', () => {
  it('parses ISO period dates and the last date in a range', () => {
    expect(parseBir2307Period('2025-08-31')?.getMonth()).toBe(7)
    expect(parseBir2307Period('2025-08-01 to 2025-08-31')?.getDate()).toBe(31)
  })

  it('maps one relational certificate projection to one export row', () => {
    expect(mapCertificateResultToBir2307Row(buildCertificateRecord())).toEqual(
      buildExportRow(),
    )

    expect(
      mapCertificateResultToBir2307Row(
        buildCertificateRecord({
          id: 43,
          ordinal: 2,
          status: 'duplicate',
          signaturePresent: false,
        }),
      ),
    ).toMatchObject({
      duplicateStatus: 'DUPLICATE',
      hasSignature: 'No',
      condition: 'GOOD',
    })

    expect(
      mapCertificateResultToBir2307Row(
        buildCertificateRecord({
          id: 44,
          ordinal: 3,
          status: 'error',
          reasonCodes: ['variance_exceeded'],
          totalTaxBase: '611504.51',
          totalTaxWithheld: '10919.72',
        }),
      ),
    ).toMatchObject({
      condition: 'ERROR',
      duplicateStatus: 'UNIQUE',
      payorName: 'GREEN FUTURE INNOVATIONS, INC.',
      taxBase: 611504.51,
      taxWithheld: 10919.72,
    })
  })

  it('keeps multi-certificate children independent and adds failed-upload rows', () => {
    const rows = buildBir2307ExportRows(
      [
        buildCertificateRecord({ id: 42, ordinal: 1, payorName: 'PAYOR A' }),
        buildCertificateRecord({ id: 43, ordinal: 2, payorName: 'PAYOR B' }),
      ],
      1,
    )

    expect(rows).toHaveLength(3)
    expect(rows[0]?.payorName).toBe('PAYOR A')
    expect(rows[1]?.payorName).toBe('PAYOR B')
    expect(rows[2]).toMatchObject({
      payorName: null,
      condition: 'ERROR',
      duplicateStatus: 'UNIQUE',
    })
  })

  it('builds the template workbook with relational certificate data', async () => {
    const certificate = buildCertificateRecord({
      primaryAtcCode: 'WC157',
      totalTaxBase: '28030.86',
      totalTaxWithheld: '560.62',
    })
    const taxRows = [
      buildTaxRow(),
      buildTaxRow({
        id: 2,
        lineNumber: 2,
        atcCode: 'WV020',
        description: 'Final withholding on government payments',
        taxRate: '0.050000',
        taxWithheld: '1401.54',
      }),
    ]
    const summaryRows = buildBir2307ExportRows([certificate], 0, taxRows)
    const detailRows = buildBir2307AtcDetailRows([certificate], taxRows)
    const workbookBuffer = await buildBir2307ExportWorkbook(
      summaryRows,
      detailRows,
    )
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(workbookBuffer as never)
    const worksheet = workbook.getWorksheet('Sheet1')
    const detailWorksheet = workbook.getWorksheet('ATC Details')

    expect(worksheet?.getCell('A1').value).toBe('2307 DETAILS')
    expect(worksheet?.getCell('D3').value).toBe('Address')
    expect(worksheet?.getCell('N3').value).toBe('ATC(s)')
    expect(worksheet?.getCell('O3').value).toBe('EWT/CWT Tax Base')
    expect(worksheet?.getCell('P3').value).toBe('EWT/CWT Tax Withheld')
    expect(worksheet?.getCell('Q3').value).toBe('Duplicate or Unique?')
    expect(worksheet?.getCell('B4').value).toBe('THERMA LUZON, INC.')
    expect(worksheet?.getCell('N4').value).toBe('WC157, WV020')
    expect(worksheet?.getCell('O4').value).toBe(28030.86)
    expect(worksheet?.getCell('P4').value).toBe(560.62)
    expect(worksheet?.getCell('B5').value).toBeNull()
    expect(detailWorksheet?.rowCount).toBe(3)
    expect(detailWorksheet?.getCell('K2').value).toBe('WC157')
    expect(detailWorksheet?.getCell('Q2').value).toBe(0.02)
    expect(detailWorksheet?.getCell('R2').value).toBe(560.62)
    expect(detailWorksheet?.getCell('K3').value).toBe('WV020')
    expect(detailWorksheet?.getCell('Q3').value).toBe(0.05)
    expect(detailWorksheet?.getCell('R3').value).toBe(1401.54)
  })
})
