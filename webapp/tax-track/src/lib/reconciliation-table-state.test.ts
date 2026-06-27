import { describe, expect, it } from 'vitest'

import type { ReconciliationRowView } from '@/lib/reconciliation-types'
import {
  filterReconciliationRows,
  paginateReconciliationRows,
  sortReconciliationRowsByCustomerName,
} from '@/lib/reconciliation-table-state'

const createRow = (
  id: number,
  overrides: Partial<ReconciliationRowView> = {},
): ReconciliationRowView => ({
  id,
  uploadBatchId: 'batch-1',
  requestingEntityShortName: 'TMO',
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
  matchedAt: '2026-04-21T00:30:00.000Z',
  emailSentAt: null,
  daysUncollected: null,
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

  it('filters TIN values when the search term includes display hyphens', () => {
    const rows = [
      createRow(1, { tin: '2670900700000' }),
      createRow(2, { tin: '123456789000' }),
    ]

    expect(filterReconciliationRows(rows, '267-090-070-0000', 'all')).toEqual([
      expect.objectContaining({ id: 1 }),
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
      createRow(2, {
        hasDifference: true,
        matchStatus: 'unmatched',
        matchedAt: null,
        taxWithheldDifference: 5,
      }),
    ]

    expect(filterReconciliationRows(rows, '', 'difference')).toEqual([
      expect.objectContaining({ id: 2 }),
    ])
  })

  it('sorts rows A-Z by customer name', () => {
    const rows = [
      createRow(1, { customerName: 'Delta Power' }),
      createRow(2, { customerName: 'ACME Holdings' }),
      createRow(3, { customerName: 'Bravo Energy' }),
    ]

    expect(
      sortReconciliationRowsByCustomerName(rows).map((row) => row.id),
    ).toEqual([2, 3, 1])
  })

  it('sorts customer names case-insensitively', () => {
    const rows = [
      createRow(1, { customerName: 'charlie Renewables' }),
      createRow(2, { customerName: 'Bravo Energy' }),
      createRow(3, { customerName: 'acme Holdings' }),
    ]

    expect(
      sortReconciliationRowsByCustomerName(rows).map((row) => row.customerName),
    ).toEqual(['acme Holdings', 'Bravo Energy', 'charlie Renewables'])
  })

  it('keeps the incoming order for matching customer names', () => {
    const rows = [
      createRow(1, { customerName: 'ACME Holdings' }),
      createRow(2, { customerName: 'Bravo Energy' }),
      createRow(3, { customerName: 'acme holdings' }),
    ]

    expect(
      sortReconciliationRowsByCustomerName(rows).map((row) => row.id),
    ).toEqual([1, 3, 2])
  })

  it('paginates the filtered rows', () => {
    const rows = Array.from({ length: 12 }, (_, index) => createRow(index + 1))

    expect(paginateReconciliationRows(rows, 2, 10)).toEqual([
      expect.objectContaining({ id: 11 }),
      expect.objectContaining({ id: 12 }),
    ])
  })

  it('paginates sorted rows in customer-name order', () => {
    const rows = [
      createRow(1, { customerName: 'Delta Power' }),
      createRow(2, { customerName: 'ACME Holdings' }),
      createRow(3, { customerName: 'Charlie Renewables' }),
      createRow(4, { customerName: 'Bravo Energy' }),
    ]

    expect(
      paginateReconciliationRows(
        sortReconciliationRowsByCustomerName(rows),
        2,
        2,
      ).map((row) => row.id),
    ).toEqual([3, 1])
  })
})
