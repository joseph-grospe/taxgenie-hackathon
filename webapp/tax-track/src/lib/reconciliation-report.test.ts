import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'

import type { ReconciliationRowView } from '@/lib/reconciliation-types'
import type {
  CollectedTaxRecordExportCandidate,
  ReconciliationWorkbookRow,
} from '@/lib/reconciliation-report-server'
import {
  buildAnnualKey,
  buildAnnualReconciliationExportPeriod,
  buildMonthlyReconciliationExportPeriod,
  buildQuarterKey,
  buildQuarterlyReconciliationExportPeriod,
  buildReconciliationExportYearOptions,
  filterRowsForExportPeriod,
  formatBillingPeriod,
  getAnnualExportOptions,
  getMonthlyExportOptions,
  getQuarterlyExportOptions,
  isSupportedReconciliationExportYear,
} from '@/lib/reconciliation-report'
import {
  buildCollectedTaxRecordExportCandidate,
  buildReconciliationExportFileName,
  buildReconciliationWorkbook,
  buildReconciliationWorkbookFromRows,
  filterCollectedOnlyTaxRecordCandidates,
  isValidReconciliationExportPeriod,
} from '@/lib/reconciliation-report-server'

const createRow = (
  id: number,
  billingMonth: string,
): ReconciliationRowView => ({
  id,
  uploadBatchId: 'batch-1',
  requestingEntityShortName: 'TMO',
  customerName: `Customer ${id}`,
  tin: `TIN-${id}`,
  invoiceNumber: `INV-${id}`,
  accountingDate: '2025-09-30',
  transactionLineDescription: '2025.07.26-2025.08.25 billing date',
  taxableSales: 100,
  outputVAT: 12,
  prepaidCWT: -2,
  issuerShortnameUsedForMatch: `CUSTOMER${id}`,
  derivedBillingMonthMMYY: billingMonth,
  matchedTaxRecordId: id,
  taxBase: 100,
  taxWithheld: 2,
  taxBaseDifference: 0,
  taxWithheldDifference: 0,
  hasDifference: false,
  matchStatus: 'matched',
  matchedAt: '2026-04-21T00:30:00.000Z',
  emailSentAt: null,
  daysUncollected: null,
  createdAt: '2026-04-21T00:00:00.000Z',
  updatedAt: '2026-04-21T00:00:00.000Z',
})

const createCollectedCandidate = (
  id: number,
  overrides: Partial<CollectedTaxRecordExportCandidate> = {},
): CollectedTaxRecordExportCandidate => ({
  taxRecordId: id,
  batchId: 'batch-1',
  sourceFileId: `source-${id}`,
  fileName: `BIR2307_ACME_TMO_${id}_0825_20250831.pdf`,
  resultCreatedAt: new Date('2026-04-21T00:00:00.000Z'),
  taxBase: 100,
  taxWithheld: 2,
  metadata: {
    documentType: 'BIR2307',
    issuerShortname: 'ACME',
    normalizedIssuerShortname: 'ACME',
    recipientShortname: 'TMO',
    settlementReferenceNumber: String(id),
    billingMonthMMYY: '0825',
    dateUploaded: '20250831',
  },
  payeeName: 'Test Merchant Operator',
  payorName: 'Acme Solar',
  ...overrides,
})

describe('reconciliation-report', () => {
  it('formats billing months as readable labels', () => {
    expect(formatBillingPeriod('0825')).toBe('August 2025')
  })

  it('builds arbitrary reconciliation export period values', () => {
    expect(buildMonthlyReconciliationExportPeriod(6, 2026)).toBe('0626')
    expect(buildMonthlyReconciliationExportPeriod('12', '2099')).toBe('1299')
    expect(buildQuarterlyReconciliationExportPeriod(2, 2026)).toBe('2026-Q2')
    expect(buildQuarterlyReconciliationExportPeriod('4', '2099')).toBe(
      '2099-Q4',
    )
    expect(buildAnnualReconciliationExportPeriod(2026)).toBe('2026')
    expect(buildAnnualReconciliationExportPeriod('2099')).toBe('2099')
  })

  it('rejects unsupported reconciliation export periods', () => {
    expect(isSupportedReconciliationExportYear(1999)).toBe(false)
    expect(isSupportedReconciliationExportYear(2100)).toBe(false)
    expect(isSupportedReconciliationExportYear('202')).toBe(false)
    expect(buildMonthlyReconciliationExportPeriod(0, 2026)).toBeNull()
    expect(buildMonthlyReconciliationExportPeriod(13, 2026)).toBeNull()
    expect(buildMonthlyReconciliationExportPeriod(6, 1999)).toBeNull()
    expect(buildQuarterlyReconciliationExportPeriod(0, 2026)).toBeNull()
    expect(buildQuarterlyReconciliationExportPeriod(5, 2026)).toBeNull()
    expect(buildQuarterlyReconciliationExportPeriod(2, 2100)).toBeNull()
    expect(buildAnnualReconciliationExportPeriod(1999)).toBeNull()
  })

  it('builds export year options around the reference year', () => {
    expect(buildReconciliationExportYearOptions(2026)).toEqual([
      { value: '2031', label: '2031' },
      { value: '2030', label: '2030' },
      { value: '2029', label: '2029' },
      { value: '2028', label: '2028' },
      { value: '2027', label: '2027' },
      { value: '2026', label: '2026' },
      { value: '2025', label: '2025' },
      { value: '2024', label: '2024' },
      { value: '2023', label: '2023' },
      { value: '2022', label: '2022' },
      { value: '2021', label: '2021' },
    ])

    expect(buildReconciliationExportYearOptions(2002).at(-1)).toEqual({
      value: '2000',
      label: '2000',
    })
    expect(buildReconciliationExportYearOptions(2098).at(0)).toEqual({
      value: '2099',
      label: '2099',
    })
  })

  it('builds monthly export options in descending order', () => {
    const rows = [
      createRow(1, '0825'),
      createRow(2, '1025'),
      createRow(3, '0825'),
    ]

    expect(getMonthlyExportOptions(rows)).toEqual([
      { value: '1025', label: 'October 2025' },
      { value: '0825', label: 'August 2025' },
    ])
  })

  it('builds quarterly export options in descending order', () => {
    const rows = [
      createRow(1, '0825'),
      createRow(2, '1025'),
      createRow(3, '0925'),
    ]

    expect(getQuarterlyExportOptions(rows)).toEqual([
      { value: '2025-Q4', label: 'Q4 2025' },
      { value: '2025-Q3', label: 'Q3 2025' },
    ])
  })

  it('builds annual export options in descending order', () => {
    const rows = [
      createRow(1, '0825'),
      createRow(2, '1024'),
      createRow(3, '0925'),
    ]

    expect(getAnnualExportOptions(rows)).toEqual([
      { value: '2025', label: '2025' },
      { value: '2024', label: '2024' },
    ])
  })

  it('filters rows by monthly, quarterly, and annual export period', () => {
    const rows = [
      createRow(1, '0725'),
      createRow(2, '0825'),
      createRow(3, '1125'),
      createRow(4, '0124'),
    ]

    expect(
      filterRowsForExportPeriod(rows, 'monthly', '0825').map((row) => row.id),
    ).toEqual([2])
    expect(
      filterRowsForExportPeriod(rows, 'quarterly', '2025-Q3').map(
        (row) => row.id,
      ),
    ).toEqual([1, 2])
    expect(
      filterRowsForExportPeriod(rows, 'annual', '2025').map((row) => row.id),
    ).toEqual([1, 2, 3])
    expect(buildQuarterKey('0825')).toBe('2025-Q3')
    expect(buildAnnualKey('0825')).toBe('2025')
  })

  it('validates annual export periods and filenames', () => {
    expect(isValidReconciliationExportPeriod('annual', '2025')).toBe(true)
    expect(isValidReconciliationExportPeriod('annual', '25')).toBe(false)
    expect(buildReconciliationExportFileName('annual', '2025')).toBe(
      'Reconciliation-Report-Annual-2025.xlsx',
    )
    expect(
      buildReconciliationExportFileName('monthly', '0825', {
        customerName: 'Acme Solar & Storage, Inc.',
      }),
    ).toBe(
      'Reconciliation-Report-Monthly-August-2025-Acme-Solar-Storage-Inc.xlsx',
    )
  })

  it('builds large workbooks without shared-formula clone errors', async () => {
    const rows = Array.from({ length: 520 }, (_, index) =>
      createRow(index + 1, '0925'),
    )

    const workbookBuffer = await buildReconciliationWorkbook(rows)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(workbookBuffer as never)

    const worksheet = workbook.getWorksheet('Sample 2307 Recon Format')

    expect(worksheet).toBeDefined()
    expect(worksheet?.getCell('C4').value).toBe('1')
    expect(worksheet?.getCell('I508').value).toBe(rows[504]?.prepaidCWT)
    expect(worksheet?.getCell('M523').value).toBe(
      rows[519]?.taxWithheldDifference,
    )
  })

  it('builds collected-only workbook rows with blank sales-report amount cells', async () => {
    const row: ReconciliationWorkbookRow = {
      shortName: null,
      tin: null,
      customerName: null,
      invoiceNumber: null,
      billingMonthMMYY: '0825',
      accountingDate: null,
      taxableSales: null,
      prepaidCWT: null,
      collectedTaxBase: 1234.56,
      collectedPrepaidCWT: 24.69,
      taxBaseDifference: 1234.56,
      prepaidCWTDifference: 24.69,
    }

    const workbookBuffer = await buildReconciliationWorkbookFromRows([row])
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(workbookBuffer as never)

    const worksheet = workbook.getWorksheet('Sample 2307 Recon Format')

    expect(worksheet?.getCell('B4').value).toBe('')
    expect(worksheet?.getCell('C4').value).toBe('')
    expect(worksheet?.getCell('D4').value).toBe('')
    expect(worksheet?.getCell('E4').value).toBe('')
    expect(worksheet?.getCell('F4').value).toBe('August 2025')
    expect(worksheet?.getCell('G4').value).toBe('')
    expect(worksheet?.getCell('H4').value).toBe('')
    expect(worksheet?.getCell('I4').value).toBe('')
    expect(worksheet?.getCell('J4').value).toBe(1234.56)
    expect(worksheet?.getCell('K4').value).toBe(24.69)
    expect(worksheet?.getCell('L4').value).toBe(1234.56)
    expect(worksheet?.getCell('M4').value).toBe(24.69)
  })

  it('keeps only collected 2307 candidates not already matched in active reconciliation rows', () => {
    const candidates = [
      createCollectedCandidate(1),
      createCollectedCandidate(2, {
        metadata: {
          ...createCollectedCandidate(2).metadata,
          issuerShortname: 'BETA',
          normalizedIssuerShortname: 'BETA',
        },
        payorName: 'Beta Storage',
      }),
      createCollectedCandidate(3, {
        metadata: {
          ...createCollectedCandidate(3).metadata,
          billingMonthMMYY: '0925',
        },
      }),
    ]

    const filtered = filterCollectedOnlyTaxRecordCandidates(
      candidates,
      new Set([1]),
      {
        billingMonths: ['0825'],
        customerName: 'Beta',
      },
    )

    expect(filtered.map((candidate) => candidate.taxRecordId)).toEqual([2])
  })

  it('keeps collected-only candidates for report-level exports without a collected period filter', () => {
    const filtered = filterCollectedOnlyTaxRecordCandidates(
      [
        createCollectedCandidate(1, {
          metadata: {
            ...createCollectedCandidate(1).metadata,
            billingMonthMMYY: '0126',
          },
        }),
      ],
      new Set(),
      {},
    )

    expect(
      filtered.map((candidate) => candidate.metadata.billingMonthMMYY),
    ).toEqual(['0126'])
  })

  it('builds collected 2307 candidates from document result fields when upload metadata is missing', () => {
    const candidate = buildCollectedTaxRecordExportCandidate({
      taxRecordId: 42,
      batchId: 'batch-1',
      sourceFileId: 'source-42',
      fileName: 'uploaded-certificate.pdf',
      resultOriginalFileName: null,
      resultCreatedAt: new Date('2026-04-21T00:00:00.000Z'),
      payload: {
        normalized: {
          periodEnd: '2025-09-30',
          monthOfQuarter: 'second',
          taxBase: '1,200.50',
          taxWithheld: '24.01',
          payeeName: 'Test Merchant Operator',
          payorName: 'Beta Storage Corporation',
        },
      },
      periodEnd: '2025-09-30',
      payeeName: 'Test Merchant Operator',
      payeeShortName: 'TMO',
      payorName: 'Beta Storage Corporation',
      payorShortName: 'BETA',
      certificateDocumentType: null,
      certificateIssuerShortName: null,
      certificateIssuerShortNameNormalized: null,
      certificateRecipientShortName: null,
      certificateSettlementReferenceNumber: null,
      certificateBillingMonthMMYY: null,
      certificateDateUploaded: null,
    })

    expect(candidate).toMatchObject({
      taxRecordId: 42,
      taxBase: 1200.5,
      taxWithheld: 24.01,
      payeeName: 'Test Merchant Operator',
      payorName: 'Beta Storage Corporation',
      metadata: {
        documentType: 'BIR2307',
        issuerShortname: 'BETA',
        normalizedIssuerShortname: 'BETA',
        recipientShortname: 'TMO',
        billingMonthMMYY: '0825',
      },
    })
  })

  it('accepts collected 2307 metadata with hyphenated document type values', () => {
    const candidate = buildCollectedTaxRecordExportCandidate({
      taxRecordId: 43,
      batchId: 'batch-1',
      sourceFileId: 'source-43',
      fileName: 'uploaded-certificate.pdf',
      resultOriginalFileName: null,
      resultCreatedAt: new Date('2026-04-21T00:00:00.000Z'),
      payload: {
        normalized: {
          taxBase: 100,
          taxWithheld: 2,
        },
      },
      periodEnd: null,
      payeeName: null,
      payeeShortName: null,
      payorName: null,
      payorShortName: null,
      certificateDocumentType: 'bir-2307',
      certificateIssuerShortName: 'ACME',
      certificateIssuerShortNameNormalized: 'ACME',
      certificateRecipientShortName: 'TMO',
      certificateSettlementReferenceNumber: '43',
      certificateBillingMonthMMYY: '0825',
      certificateDateUploaded: '20250831',
    })

    expect(candidate?.metadata.documentType).toBe('bir-2307')
    expect(candidate?.metadata.billingMonthMMYY).toBe('0825')
  })
})
