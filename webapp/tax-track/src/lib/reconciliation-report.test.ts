import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'

import {
  buildQuarterKey,
  filterRowsForExportPeriod,
  formatBillingPeriod,
  getMonthlyExportOptions,
  getQuarterlyExportOptions,
} from '@/lib/reconciliation-report'
import { buildReconciliationWorkbook } from '@/lib/reconciliation-report-server'
import type { ReconciliationRowView } from '@/lib/reconciliation-types'

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
  emailSentAt: null,
  createdAt: '2026-04-21T00:00:00.000Z',
  updatedAt: '2026-04-21T00:00:00.000Z',
})

describe('reconciliation-report', () => {
  it('formats billing months as readable labels', () => {
    expect(formatBillingPeriod('0825')).toBe('August 2025')
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

  it('filters rows by monthly and quarterly export period', () => {
    const rows = [
      createRow(1, '0725'),
      createRow(2, '0825'),
      createRow(3, '1125'),
    ]

    expect(
      filterRowsForExportPeriod(rows, 'monthly', '0825').map((row) => row.id),
    ).toEqual([2])
    expect(
      filterRowsForExportPeriod(rows, 'quarterly', '2025-Q3').map(
        (row) => row.id,
      ),
    ).toEqual([1, 2])
    expect(buildQuarterKey('0825')).toBe('2025-Q3')
  })

  it('builds large workbooks without shared-formula clone errors', async () => {
    const rows = Array.from({ length: 520 }, (_, index) =>
      createRow(index + 1, '0925'),
    )

    const workbookBuffer = await buildReconciliationWorkbook(rows)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(workbookBuffer)

    const worksheet = workbook.getWorksheet('Sample 2307 Recon Format')

    expect(worksheet).toBeDefined()
    expect(worksheet?.getCell('C4').value).toBe('1')
    expect(worksheet?.getCell('I508').value).toBe(rows[504]?.prepaidCWT)
    expect(worksheet?.getCell('M523').value).toBe(
      rows[519]?.taxWithheldDifference,
    )
  })
})
