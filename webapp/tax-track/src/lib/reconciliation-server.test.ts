import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import {
  buildDifferenceValues,
  buildMasterlistShortNameLookup,
  buildMasterlistShortNameLookupFromLikeMatches,
  deriveBillingMonthMMYY,
  parseCertificateFileName,
  parseReconciliationWorkbook,
  parseRequestingEntityShortNameFromWorkbookFileName,
  pickBestTaxRecordMatch,
  resolveMasterlistIssuerShortname,
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
  })

  it('rejects reconciliation workbook filenames without the entity sales-report format', () => {
    expect(() =>
      parseRequestingEntityShortNameFromWorkbookFileName('sales-report.xlsx'),
    ).toThrow(
      'Reconciliation workbook filename must use {{ENTITY_SHORT_NAME}}_SALES_REPORT.xlsx or {{ENTITY_SHORT_NAME}}_SALES_REPORT.xls.',
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

  it('builds a masterlist short-name lookup from short names and customer names', () => {
    const lookup = buildMasterlistShortNameLookup([
      {
        shortName: 'ACME',
        customerName: 'Acme Corporation',
      },
      {
        shortName: 'ABC HOLDINGS',
        customerName: 'ABC Holdings Inc.',
      },
    ])

    expect(lookup.get('ACME')).toBe('ACME')
    expect(lookup.get('ACMECORPORATION')).toBe('ACME')
    expect(lookup.get('ABCHOLDINGSINC')).toBe('ABCHOLDINGS')
  })

  it('builds a masterlist short-name lookup from like-matched customer names', () => {
    const lookup = buildMasterlistShortNameLookupFromLikeMatches(
      ['Acme', 'ABC Holdings'],
      [
        {
          shortName: 'ACME',
          customerName: 'Acme Corporation',
        },
        {
          shortName: 'ABC HOLDINGS',
          customerName: 'ABC Holdings Inc.',
        },
        {
          shortName: 'ABC',
          customerName: 'ABC',
        },
      ],
    )

    expect(lookup.get('ACME')).toBe('ACME')
    expect(lookup.get('ABCHOLDINGS')).toBe('ABCHOLDINGS')
  })

  it('skips customer names without a masterlist short-name match', () => {
    const lookup = buildMasterlistShortNameLookupFromLikeMatches(
      ['Unlisted Customer'],
      [
        {
          shortName: 'ACME',
          customerName: 'Acme Corporation',
        },
      ],
    )

    expect(lookup.size).toBe(0)
  })

  it('resolves issuer short name from masterlist and returns null when no mapping exists', () => {
    const lookup = buildMasterlistShortNameLookup([
      {
        shortName: 'ACME',
        customerName: 'Acme Corporation',
      },
    ])

    expect(resolveMasterlistIssuerShortname('Acme Corporation', lookup)).toBe(
      'ACME',
    )
    expect(resolveMasterlistIssuerShortname('ACME', lookup)).toBe('ACME')
    expect(
      resolveMasterlistIssuerShortname('Unlisted Customer', lookup),
    ).toBeNull()
  })
})
