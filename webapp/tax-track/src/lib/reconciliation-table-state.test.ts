import { describe, expect, it } from 'vitest'

import {
  filterReconciliationRows,
  paginateReconciliationRows,
} from '@/lib/reconciliation-table-state'
import type { ReconciliationRowView } from '@/lib/reconciliation-types'

const createRow = (
  id: number,
  overrides: Partial<ReconciliationRowView> = {},
): ReconciliationRowView => ({
  id,
  uploadBatchId: 'batch-1',
  customerName: `Customer ${id}`,
  tin: `TIN-${id}`,
  invoiceNumber: `INV-${id}`,
  accountingDate: '2025-09-30',
  transactionLineDescription: `2025.07.26-2025.08.25 billing date ${id}`,
  taxableSales: 100,
  outputVAT: 12,
  prepaidCWT: id % 2 === 0 ? -2 : 0,
  issuerShortnameUsedForMatch: `CUSTOMER${id}`,
  derivedBillingMonthMMYY: '0825',
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
  ...overrides,
})

describe('reconciliation-table-state', () => {
  it('filters rows by search term', () => {
    const rows = [
      createRow(1, { customerName: 'ACME Holdings' }),
      createRow(2, { customerName: 'Bravo Energy' }),
    ]

    expect(filterReconciliationRows(rows, 'bravo', 'all')).toEqual([
      expect.objectContaining({ customerName: 'Bravo Energy' }),
    ])
  })

  it('filters rows by selected status', () => {
    const rows = [
      createRow(1, { matchStatus: 'matched' }),
      createRow(2, { matchStatus: 'unmatched' }),
    ]

    expect(filterReconciliationRows(rows, '', 'unmatched')).toEqual([
      expect.objectContaining({ id: 2 }),
    ])
  })

  it('filters rows with differences only', () => {
    const rows = [
      createRow(1, { hasDifference: false }),
      createRow(2, { hasDifference: true, taxWithheldDifference: 5 }),
    ]

    expect(filterReconciliationRows(rows, '', 'difference')).toEqual([
      expect.objectContaining({ id: 2 }),
    ])
  })

  it('paginates the filtered rows', () => {
    const rows = Array.from({ length: 12 }, (_, index) => createRow(index + 1))

    expect(paginateReconciliationRows(rows, 2, 10)).toEqual([
      expect.objectContaining({ id: 11 }),
      expect.objectContaining({ id: 12 }),
    ])
  })
})
