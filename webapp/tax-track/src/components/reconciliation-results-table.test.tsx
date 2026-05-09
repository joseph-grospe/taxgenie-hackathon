/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ReconciliationRowView } from '@/lib/reconciliation-types'
import { ReconciliationResultsTable } from '@/components/reconciliation-results-table'
import { getReconciliationCustomerEmailGroupKey } from '@/lib/reconciliation-customer-groups'

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
  matchedTaxRecordId: 10,
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
}

afterEach(() => {
  cleanup()
})

describe('ReconciliationResultsTable', () => {
  it('renders an empty state when no rows exist', () => {
    render(<ReconciliationResultsTable rows={[]} />)

    expect(screen.getByText('No reconciliation rows yet.')).toBeTruthy()
  })

  it('renders a custom empty message when provided', () => {
    render(
      <ReconciliationResultsTable
        rows={[]}
        emptyMessage="No reconciliation rows match the current search or filter."
      />,
    )

    expect(
      screen.getByText(
        'No reconciliation rows match the current search or filter.',
      ),
    ).toBeTruthy()
  })

  it('renders table content for saved rows', () => {
    render(<ReconciliationResultsTable rows={[row]} />)

    expect(screen.getByText('ACME')).toBeTruthy()
    expect(screen.getByText('INV-1')).toBeTruthy()
    expect(screen.getByText('Taxable Sales (Sales Report)')).toBeTruthy()
    expect(screen.getByText('Prepaid CWT (Sales Report)')).toBeTruthy()
    expect(screen.getByText('Tax Base (Certificate)')).toBeTruthy()
    expect(screen.getByText('Tax Withheld (Certificate)')).toBeTruthy()
    expect(screen.getByText('Matched')).toBeTruthy()
    expect(screen.queryByText('Matched At')).toBeNull()
    expect(screen.queryByText('Apr 21, 2026, 8:30 AM')).toBeNull()
    expect(screen.queryByText('Pending')).toBeNull()
    expect(screen.queryByText('matched')).toBeNull()
  })

  it('shows customer email actions only for pending unmatched difference rows', () => {
    const onRowSelect = vi.fn()
    const onEmailRow = vi.fn()
    render(
      <ReconciliationResultsTable
        rows={[
          row,
          {
            ...row,
            id: 2,
            invoiceNumber: 'INV-2',
            hasDifference: true,
            matchStatus: 'matched',
            taxWithheldDifference: 4,
          },
          {
            ...row,
            id: 3,
            invoiceNumber: 'INV-3',
            hasDifference: true,
            matchStatus: 'unmatched',
            taxWithheldDifference: 4,
            matchedAt: null,
            daysUncollected: null,
          },
          {
            ...row,
            id: 4,
            invoiceNumber: 'INV-4',
            hasDifference: true,
            matchStatus: 'unmatched',
            taxWithheldDifference: 4,
            matchedAt: null,
            emailSentAt: '2026-04-21T01:00:00.000Z',
            daysUncollected: 0,
          },
        ]}
        onEmailRow={onEmailRow}
        onRowSelect={onRowSelect}
      />,
    )

    expect(
      screen.getByRole('button', {
        name: 'Send reconciliation email for customer ACME',
      }),
    ).toBeTruthy()
    expect(screen.getByText('Sent')).toBeTruthy()
    expect(screen.getByText('Apr 21, 2026')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Send reconciliation email for customer ACME',
      }),
    )
    expect(onEmailRow).not.toHaveBeenCalled()
    expect(screen.getByText('Send reconciliation email?')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^send email$/i }))
    expect(onEmailRow).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 3,
        invoiceNumber: 'INV-3',
      }),
    )

    fireEvent.click(screen.getAllByText('INV-1')[0])
    expect(onRowSelect).toHaveBeenCalled()
  })

  it('disables all visible rows in the customer group while sending', () => {
    const pendingRow = {
      ...row,
      id: 3,
      invoiceNumber: 'INV-3',
      hasDifference: true,
      matchStatus: 'unmatched',
      taxWithheldDifference: 4,
      matchedAt: null,
      daysUncollected: null,
    } satisfies ReconciliationRowView

    render(
      <ReconciliationResultsTable
        rows={[
          pendingRow,
          {
            ...pendingRow,
            id: 5,
            invoiceNumber: 'INV-5',
          },
        ]}
        emailingCustomerGroupKey={getReconciliationCustomerEmailGroupKey(
          pendingRow,
        )}
      />,
    )

    const buttons = screen.getAllByRole('button', {
      name: 'Send reconciliation email for customer ACME',
    })

    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toHaveProperty('disabled', true)
    expect(buttons[1]).toHaveProperty('disabled', true)
  })
})
