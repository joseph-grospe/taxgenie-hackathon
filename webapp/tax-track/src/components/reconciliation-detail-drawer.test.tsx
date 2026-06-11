/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import type { ReconciliationRowView } from '@/lib/reconciliation-types'
import { ReconciliationDetailDrawer } from '@/components/reconciliation-detail-drawer'

vi.mock('@tanstack/react-router', () => {
  return {
    Link: ({
      children,
      params,
      ...props
    }: {
      children?: ReactNode
      params?: { rowId?: string }
      onClick?: () => void
    }) => (
      <a href={`/reconciliation/${params?.rowId ?? ''}`} {...props}>
        {children}
      </a>
    ),
  }
})

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

describe('ReconciliationDetailDrawer', () => {
  it('renders row identity, comparison, variance, and full view link', () => {
    render(
      <ReconciliationDetailDrawer
        open
        onOpenChange={vi.fn()}
        row={row}
        onEmailRow={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'ACME' })).toBeTruthy()
    expect(screen.getByText('INV-1')).toBeTruthy()
    expect(screen.getByText('Identity')).toBeTruthy()
    expect(screen.getByText('123-456-789-000')).toBeTruthy()
    expect(screen.getByText('2025.07.26-2025.08.25 billing date')).toBeTruthy()
    expect(screen.getByText('Sales report vs Certificate')).toBeTruthy()
    expect(screen.getByText('Taxable sales / Tax base')).toBeTruthy()
    expect(screen.getByText('Prepaid CWT / Tax withheld')).toBeTruthy()
    expect(screen.getByText('Output VAT')).toBeTruthy()
    expect(screen.getByText('Matched with no variance.')).toBeTruthy()

    expect(
      screen.getByRole('button', { name: /open full view/i }),
    ).toHaveProperty('pathname', '/reconciliation/1')
  })

  it('shows a disabled email action for ineligible rows', () => {
    render(
      <ReconciliationDetailDrawer
        open
        onOpenChange={vi.fn()}
        row={row}
        onEmailRow={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('button', { name: /email customer/i }),
    ).toHaveProperty('disabled', true)
  })

  it('confirms before emailing eligible rows', () => {
    const onEmailRow = vi.fn()
    const pendingRow = {
      ...row,
      id: 2,
      invoiceNumber: 'INV-2',
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

    render(
      <ReconciliationDetailDrawer
        open
        onOpenChange={vi.fn()}
        row={pendingRow}
        onEmailRow={onEmailRow}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /email customer/i }))
    expect(screen.getByText('Send reconciliation email?')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^send email$/i }))
    expect(onEmailRow).toHaveBeenCalledWith(pendingRow)
  })
})
