import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import {
  buildDifferenceValues,
  buildMasterlistShortNameLookupFromTinMatches,
  deriveBillingMonthMMYY,
  parseCertificateFileName,
  parseReconciliationWorkbook,
  parseRequestingEntityShortNameFromWorkbookFileName,
  pickBestTaxRecordMatch,
  resolveMasterlistIssuerShortnameByTin,
} from '@/lib/reconciliation-server'

const createWorkbookBuffer = (rows: Array<Array<unknown>>) => {
  const worksheet = XLSX.utils.aoa_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')

  return XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  }) as Buffer
}

describe('reconciliation-server', () => {
  it('parses a valid reconciliation workbook', () => {
    const buffer = createWorkbookBuffer([
      [
        'Customer Name',
        'TIN',
        'Invoice Number',
        'Accounting Date',
        'Transaction Line Description',
        'Taxable Sales',
        'Output VAT',
        'Prepaid CWT',
      ],
      [
        'ACME',
        '123',
        'INV-1',
        '2025-09-30',
        '2025.07.26-2025.08.25 billing date',
        '1000.10',
        120.55,
        '20.25',
      ],
    ])

    const rows = parseReconciliationWorkbook(buffer)

    expect(rows).toEqual([
      expect.objectContaining({
        customerName: 'ACME',
        tin: '123',
        invoiceNumber: 'INV-1',
        accountingDate: '2025-09-30',
        derivedBillingMonthMMYY: '0825',
        taxableSales: 1000.1,
        outputVAT: 120.55,
        prepaidCWT: 20.25,
        issuerShortnameUsedForMatch: 'ACME',
      }),
    ])
  })

  it('stores imported reconciliation TINs as digits only', () => {
    const buffer = createWorkbookBuffer([
      [
        'Customer Name',
        'TIN',
        'Invoice Number',
        'Accounting Date',
        'Transaction Line Description',
        'Taxable Sales',
        'Output VAT',
        'Prepaid CWT',
      ],
      [
        'ACME',
        '2,6,7-0,9,0-0,7,0-0,0,0',
        'INV-1',
        '2025-09-30',
        '2025.07.26-2025.08.25 billing date',
        1000,
        120,
        20,
      ],
      [
        'Bravo',
        '267x090x070x0000',
        'INV-2',
        '2025-09-30',
        '2025.07.26-2025.08.25 billing date',
        1000,
        120,
        20,
      ],
    ])

    const rows = parseReconciliationWorkbook(buffer)

    expect(rows.map((row) => row.tin)).toEqual([
      '267090070000',
      '2670900700000',
    ])
  })

  it('treats junk-only imported reconciliation TINs as missing', () => {
    const buffer = createWorkbookBuffer([
      [
        'Customer Name',
        'TIN',
        'Invoice Number',
        'Accounting Date',
        'Transaction Line Description',
        'Taxable Sales',
        'Output VAT',
        'Prepaid CWT',
      ],
      [
        'ACME',
        '---',
        'INV-1',
        '2025-09-30',
        '2025.07.26-2025.08.25 billing date',
        1000,
        120,
        20,
      ],
    ])

    expect(() => parseReconciliationWorkbook(buffer)).toThrow(
      'Row 2: TIN is required.',
    )
  })

  it('treats blank output VAT as zero', () => {
    const buffer = createWorkbookBuffer([
      [
        'Customer Name',
        'TIN',
        'Invoice Number',
        'Accounting Date',
        'Transaction Line Description',
        'Taxable Sales',
        'Output VAT',
        'Prepaid CWT',
      ],
      [
        'ABOITIZ SOLAR POWER, INC.',
        '422-954-971-000',
        21890,
        '2025-09-10',
        '2025.07.26-2025.08.25 - IEMOP POWER BILL (TS-WF-230F-0045142)',
        4462.21,
        '',
        -89.24,
      ],
    ])

    const rows = parseReconciliationWorkbook(buffer)

    expect(rows[0]).toEqual(
      expect.objectContaining({
        outputVAT: 0,
        prepaidCWT: -89.24,
        derivedBillingMonthMMYY: '0825',
      }),
    )
  })

  it('preserves negative prepaid CWT values', () => {
    const buffer = createWorkbookBuffer([
      [
        'Customer Name',
        'TIN',
        'Invoice Number',
        'Accounting Date',
        'Transaction Line Description',
        'Taxable Sales',
        'Output VAT',
        'Prepaid CWT',
      ],
      [
        'ACME',
        '123',
        'INV-2',
        '2025-09-10',
        '2025.07.26-2025.08.25 billing date',
        1000,
        120,
        -20.5,
      ],
    ])

    const rows = parseReconciliationWorkbook(buffer)

    expect(rows[0]).toEqual(
      expect.objectContaining({
        outputVAT: 120,
        prepaidCWT: -20.5,
      }),
    )
  })

  it('treats blank prepaid CWT as zero', () => {
    const buffer = createWorkbookBuffer([
      [
        'Customer Name',
        'TIN',
        'Invoice Number',
        'Accounting Date',
        'Transaction Line Description',
        'Taxable Sales',
        'Output VAT',
        'Prepaid CWT',
      ],
      [
        'ACME',
        '123',
        'INV-3',
        '2025-09-10',
        '2025.07.26-2025.08.25 billing date',
        1000,
        120,
        '',
      ],
    ])

    const rows = parseReconciliationWorkbook(buffer)

    expect(rows[0]).toEqual(
      expect.objectContaining({
        prepaidCWT: 0,
      }),
    )
  })

  it('rejects missing required headers', () => {
    const buffer = createWorkbookBuffer([
      ['Customer Name', 'TIN'],
      ['ACME', '123'],
    ])

    expect(() => parseReconciliationWorkbook(buffer)).toThrow(
      'Missing required headers: Invoice Number, Accounting Date, Transaction Line Description, Taxable Sales, Output VAT, Prepaid CWT.',
    )
  })

  it('rejects malformed billing date ranges', () => {
    expect(() => deriveBillingMonthMMYY('August billing date')).toThrow(
      'Malformed billing date range.',
    )
  })

  it('derives billing month from month and year descriptions', () => {
    expect(
      deriveBillingMonthMMYY('August 2025 Collection_18439_Default Interest'),
    ).toBe('0825')
  })

  it('derives billing month from single-date descriptions', () => {
    expect(
      deriveBillingMonthMMYY(
        '2025.09.02 SLUDGE OIL (QTY 12MT, ACTUAL QTY 9.6MT WCA 20%)',
      ),
    ).toBe('0925')
  })

  it('parses certificate metadata from the filename', () => {
    expect(
      parseCertificateFileName(
        'BIR2307_ACME_CLIENTABC_SETT123_0825_20250903.pdf',
      ),
    ).toEqual(
      expect.objectContaining({
        documentType: 'BIR2307',
        issuerShortname: 'ACME',
        recipientShortname: 'CLIENTABC',
        settlementReferenceNumber: 'SETT123',
        billingMonthMMYY: '0825',
        dateUploaded: '20250903',
        normalizedIssuerShortname: 'ACME',
      }),
    )

    expect(
      parseCertificateFileName(
        'BIR2307_BILECO_EAUC_0044796_0825_20251003 (1).pdf',
      ),
    ).toEqual(
      expect.objectContaining({
        documentType: 'BIR2307',
        issuerShortname: 'BILECO',
        recipientShortname: 'EAUC',
        settlementReferenceNumber: '0044796',
        billingMonthMMYY: '0825',
        dateUploaded: '20251003',
        normalizedIssuerShortname: 'BILECO',
      }),
    )
  })

  it('parses requesting entity short name from reconciliation workbook filename', () => {
    expect(
      parseRequestingEntityShortNameFromWorkbookFileName(
        'TMO_SALES_REPORT.xlsx',
      ),
    ).toBe('TMO')
    expect(
      parseRequestingEntityShortNameFromWorkbookFileName(
        'TCVI_SALES_REPORT.xls',
      ),
    ).toBe('TCVI')
    expect(
      parseRequestingEntityShortNameFromWorkbookFileName(
        'tqei_sales_report.XLSX',
      ),
    ).toBe('tqei')
    expect(
      parseRequestingEntityShortNameFromWorkbookFileName(
        'tqei_sales_report_v1.xlsx',
      ),
    ).toBe('tqei')
    expect(
      parseRequestingEntityShortNameFromWorkbookFileName(
        'tqei_sales_report_122134123.xls',
      ),
    ).toBe('tqei')
  })

  it('rejects reconciliation workbook filenames without the entity sales-report format', () => {
    expect(() =>
      parseRequestingEntityShortNameFromWorkbookFileName('sales-report.xlsx'),
    ).toThrow(
      'Reconciliation workbook filename must use {{ENTITY_SHORT_NAME}}_SALES_REPORT.xlsx, {{ENTITY_SHORT_NAME}}_SALES_REPORT.xls, or include a suffix like {{ENTITY_SHORT_NAME}}_SALES_REPORT_v1.xlsx.',
    )
  })

  it('picks the latest uploaded matching tax record', () => {
    const match = pickBestTaxRecordMatch(
      {
        issuerShortnameUsedForMatch: 'ACME',
        derivedBillingMonthMMYY: '0825',
      },
      [
        {
          uploadId: 'upload-older',
          batchId: 'batch-1',
          sourceFileId: 'source-older',
          taxRecordId: 10,
          fileName: 'older.pdf',
          uploadedAt: new Date('2025-09-03T00:00:00Z'),
          fileCreatedAt: new Date('2025-09-03T00:00:00Z'),
          resultCreatedAt: new Date('2025-09-03T00:05:00Z'),
          taxBase: 100,
          taxWithheld: 10,
          metadata: {
            documentType: 'BIR2307',
            issuerShortname: 'ACME',
            recipientShortname: 'CLIENT',
            settlementReferenceNumber: 'SETT1',
            billingMonthMMYY: '0825',
            dateUploaded: '20250903',
            normalizedIssuerShortname: 'ACME',
          },
        },
        {
          uploadId: 'upload-newer',
          batchId: 'batch-1',
          sourceFileId: 'source-newer',
          taxRecordId: 11,
          fileName: 'newer.pdf',
          uploadedAt: new Date('2025-09-04T00:00:00Z'),
          fileCreatedAt: new Date('2025-09-04T00:00:00Z'),
          resultCreatedAt: new Date('2025-09-04T00:05:00Z'),
          taxBase: 100,
          taxWithheld: 10,
          metadata: {
            documentType: 'BIR2307',
            issuerShortname: 'ACME',
            recipientShortname: 'CLIENT',
            settlementReferenceNumber: 'SETT2',
            billingMonthMMYY: '0825',
            dateUploaded: '20250904',
            normalizedIssuerShortname: 'ACME',
          },
        },
      ],
    )

    expect(match).toEqual(expect.objectContaining({ taxRecordId: 11 }))
  })

  it('computes differences and hasDifference correctly', () => {
    expect(buildDifferenceValues(100, 10, 100, 5)).toEqual({
      taxBaseDifference: 0,
      taxWithheldDifference: 5,
      hasDifference: true,
    })

    expect(buildDifferenceValues(100, 10, 100, -10)).toEqual({
      taxBaseDifference: 0,
      taxWithheldDifference: 0,
      hasDifference: false,
    })

    expect(buildDifferenceValues(null, null, 0, 0)).toEqual({
      taxBaseDifference: 0,
      taxWithheldDifference: 0,
      hasDifference: false,
    })
  })

  it('builds a masterlist short-name lookup from normalized TIN prefixes', () => {
    const lookup = buildMasterlistShortNameLookupFromTinMatches([
      {
        shortName: 'ACME',
        tin: '123-456-789-000',
      },
      {
        shortName: 'ABC HOLDINGS',
        tin: '987654321000',
      },
    ])

    expect(lookup.get('123456789')).toBe('ACME')
    expect(lookup.get('987654321')).toBe('ABCHOLDINGS')
  })

  it('skips masterlist TIN rows without usable prefixes or short names', () => {
    const lookup = buildMasterlistShortNameLookupFromTinMatches([
      {
        shortName: 'ACME',
        tin: '123-456',
      },
      {
        shortName: '',
        tin: '987654321000',
      },
      {
        shortName: 'JUNK',
        tin: 'TIN',
      },
    ])

    expect(lookup.size).toBe(0)
  })

  it('resolves issuer short name from workbook TIN and ignores customer-name keys', () => {
    const lookup = buildMasterlistShortNameLookupFromTinMatches([
      {
        shortName: 'ACME',
        tin: '123456789000',
      },
    ])

    expect(resolveMasterlistIssuerShortnameByTin('123-456-789-999', lookup)).toBe(
      'ACME',
    )
    expect(resolveMasterlistIssuerShortnameByTin('Acme Corporation', lookup)).toBeNull()
    expect(
      resolveMasterlistIssuerShortnameByTin('987-654-321-000', lookup),
    ).toBeNull()
  })
})
