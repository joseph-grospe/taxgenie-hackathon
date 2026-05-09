import { describe, expect, it } from 'vitest'

import type { ReconciliationRowView } from '@/lib/reconciliation-types'
import {
  countPendingReconciliationCustomerEmailGroups,
  getReconciliationCustomerEmailGroupKey,
  isPendingReconciliationCustomerEmailRow,
} from '@/lib/reconciliation-customer-groups'

const row: ReconciliationRowView = {
  id: 1,
  uploadBatchId: 'batch-1',
  requestingEntityShortName: 'TMO',
  customerName: 'ACME',
  tin: '123',
  invoiceNumber: 'INV-1',
  accountingDate: '2025-09-30',
  transactionLineDescription: '2025.07.26-2025.08.25 billing date',
  taxableSales: 100,
  outputVAT: 12,
  prepaidCWT: 2,
  issuerShortnameUsedForMatch: 'ACME',
  derivedBillingMonthMMYY: '0825',
  matchedTaxRecordId: null,
  taxBase: null,
  taxWithheld: null,
  taxBaseDifference: -100,
  taxWithheldDifference: -2,
  hasDifference: true,
  matchStatus: 'unmatched',
  matchedAt: null,
  emailSentAt: null,
  daysUncollected: null,
  createdAt: '2026-04-21T00:00:00.000Z',
  updatedAt: '2026-04-21T00:00:00.000Z',
}

describe('reconciliation customer groups', () => {
  it('builds the same key for rows in the same customer email group', () => {
    expect(getReconciliationCustomerEmailGroupKey(row)).toBe(
      getReconciliationCustomerEmailGroupKey({
        uploadBatchId: row.uploadBatchId,
        requestingEntityShortName: row.requestingEntityShortName,
        customerName: row.customerName,
        tin: row.tin,
      }),
    )
  })

  it('counts distinct pending customer email groups', () => {
    expect(
      countPendingReconciliationCustomerEmailGroups([
        row,
        {
          ...row,
          id: 2,
          invoiceNumber: 'INV-2',
        },
        {
          ...row,
          id: 3,
          customerName: 'Other Customer',
        },
        {
          ...row,
          id: 4,
          emailSentAt: '2026-04-21T01:00:00.000Z',
        },
        {
          ...row,
          id: 5,
          matchStatus: 'matched',
        },
        {
          ...row,
          id: 6,
          hasDifference: false,
        },
      ]),
    ).toBe(2)
  })

  it('identifies only unsent unmatched rows with differences as pending', () => {
    expect(isPendingReconciliationCustomerEmailRow(row)).toBe(true)
    expect(
      isPendingReconciliationCustomerEmailRow({
        ...row,
        emailSentAt: '2026-04-21T01:00:00.000Z',
      }),
    ).toBe(false)
    expect(
      isPendingReconciliationCustomerEmailRow({
        ...row,
        matchStatus: 'matched',
      }),
    ).toBe(false)
    expect(
      isPendingReconciliationCustomerEmailRow({
        ...row,
        hasDifference: false,
      }),
    ).toBe(false)
  })
})
