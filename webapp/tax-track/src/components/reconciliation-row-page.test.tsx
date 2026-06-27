/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ReconciliationRowView } from '@/lib/reconciliation-types'
import { ReconciliationRowPage } from '@/components/reconciliation-row-page'

const row: ReconciliationRowView = {
  id: 1,
  uploadBatchId: 'batch-1',
  requestingEntityShortName: 'TMO',
  customerName: 'ACME',
  tin: '123456789000',
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

describe('ReconciliationRowPage', () => {
  it('renders identity summary, comparison, match context, and outreach state', () => {
    render(<ReconciliationRowPage row={row} onSendEmail={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'ACME' })).toBeTruthy()
    expect(screen.getByText('INV-1')).toBeTruthy()
    expect(screen.getByText('123-456-789-000')).toBeTruthy()
    expect(screen.getByText('0825')).toBeTruthy()
    expect(screen.getByText('TMO')).toBeTruthy()

    expect(screen.getByText('Sales report vs Certificate')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Field' })).toBeTruthy()
    expect(
      screen.getByRole('columnheader', { name: 'Sales report' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('columnheader', { name: 'Certificate' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('columnheader', { name: 'Difference' }),
    ).toBeTruthy()
    expect(screen.getByText('Taxable sales / Tax base')).toBeTruthy()
    expect(screen.getByText('Prepaid CWT / Tax withheld')).toBeTruthy()
    expect(screen.getByText('Output VAT')).toBeTruthy()

    expect(screen.getByText('Match context')).toBeTruthy()
    expect(screen.getByText('2025.07.26-2025.08.25 billing date')).toBeTruthy()
    expect(screen.getByText('Matched tax record')).toBeTruthy()
    expect(screen.getByText('Apr 21, 2026, 8:30 AM')).toBeTruthy()

    expect(screen.getByText('Variance and outreach')).toBeTruthy()
    expect(screen.getByText('Matched with no variance.')).toBeTruthy()
    expect(screen.getByText('No outreach required.')).toBeTruthy()
  })

  it('disables email for matched, sent, and scope-ineligible rows', () => {
    const cases: Array<ReconciliationRowView> = [
      row,
      {
        ...row,
        id: 2,
        hasDifference: true,
        matchStatus: 'unmatched',
        matchedAt: null,
        emailSentAt: '2026-04-21T01:00:00.000Z',
      },
      {
        ...row,
        id: 3,
        uploadBatchId: null,
        salesReportId: null,
        salesReportRunId: null,
        hasDifference: true,
        matchStatus: 'unmatched',
        matchedAt: null,
      },
    ]

    for (const item of cases) {
      const { unmount } = render(
        <ReconciliationRowPage row={item} onSendEmail={vi.fn()} />,
      )

      expect(
        screen.getByRole('button', { name: /email customer/i }),
      ).toHaveProperty('disabled', true)

      unmount()
    }
  })

  it('opens confirmation and calls the email callback for eligible rows', () => {
    const onSendEmail = vi.fn()
    const pendingRow = {
      ...row,
      id: 4,
      invoiceNumber: 'INV-4',
      matchedTaxRecordId: null,
      taxBase: null,
      taxWithheld: null,
      taxBaseDifference: -100,
      taxWithheldDifference: -2,
      hasDifference: true,
      matchStatus: 'unmatched',
      matchedAt: null,
      daysUncollected: null,
    } satisfies ReconciliationRowView

    render(<ReconciliationRowPage row={pendingRow} onSendEmail={onSendEmail} />)

    const emailButton = screen.getByRole('button', {
      name: /email customer/i,
    })
    expect(emailButton).toHaveProperty('disabled', false)

    fireEvent.click(emailButton)
    expect(screen.getByText('Send reconciliation email?')).toBeTruthy()
    expect(
      screen.getByText(
        'This will email the customer about all open-variance reconciliation rows for ACME.',
      ),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^send email$/i }))
    expect(onSendEmail).toHaveBeenCalledTimes(1)
  })

  it('shows open variance copy for partial rows with attached certificates', () => {
    render(
      <ReconciliationRowPage
        row={{
          ...row,
          id: 5,
          invoiceNumber: 'INV-5',
          taxBase: 90,
          taxWithheld: 1,
          taxBaseDifference: -10,
          taxWithheldDifference: -1,
          hasDifference: true,
          matchStatus: 'unmatched',
          matchedAt: null,
          daysUncollected: null,
        }}
        onSendEmail={vi.fn()}
      />,
    )

    expect(
      screen.getByText('Certificate attached, but variance remains open.'),
    ).toBeTruthy()
    expect(screen.getByText('Pending outreach.')).toBeTruthy()
  })
})
