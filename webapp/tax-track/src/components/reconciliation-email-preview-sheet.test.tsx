/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ReconciliationRowView } from '@/lib/reconciliation-types'
import { ReconciliationEmailPreviewSheetView } from '@/components/reconciliation-email-preview-sheet'

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

const previewPayload = {
  to: ['customer@example.com'],
  cc: ['region@example.com'],
  subject: 'Urgent Request for BIR Form 2307 | BACon',
  body: 'Dear Valued Customers',
  customerName: 'ACME',
  attachmentFileName: 'Outstanding-CWT-Reconciliation-Report.xlsx',
  rowCount: 1,
  rows: [
    {
      shortName: 'ACME',
      tin: '123',
      customerName: 'ACME',
      invoiceNumber: 'INV-1',
      billingMonthMMYY: '0825',
      accountingDate: '2025-09-30',
      taxableSales: 100,
      prepaidCWT: 2,
      collectedTaxBase: 0,
      collectedPrepaidCWT: 0,
      taxBaseDifference: -100,
      prepaidCWTDifference: -2,
    },
  ],
}

afterEach(() => {
  cleanup()
})

describe('ReconciliationEmailPreviewSheetView', () => {
  it('renders the loaded preview and calls send/download actions', () => {
    const onSendEmail = vi.fn()
    const onDownloadAttachment = vi.fn()

    render(
      <ReconciliationEmailPreviewSheetView
        open
        row={row}
        onOpenChange={vi.fn()}
        onSendEmail={onSendEmail}
        canDownloadAttachment
        preview={previewPayload}
        loadError={null}
        isLoading={false}
        isSending={false}
        isDownloading={false}
        onDownloadAttachment={onDownloadAttachment}
      />,
    )

    expect(
      screen.getByText('Urgent Request for BIR Form 2307 | BACon'),
    ).toBeTruthy()
    expect(screen.getByText('customer@example.com')).toBeTruthy()
    expect(screen.getByText('Dear Valued Customers')).toBeTruthy()
    expect(screen.getAllByText('INV-1')).toHaveLength(1)
    expect(screen.getAllByText('1 workbook row')).toHaveLength(2)
    expect(
      document.body.querySelector('[data-slot="sheet-footer"]')?.className,
    ).toContain('sticky')
    expect(
      document.body.querySelector('[data-slot="sheet-content"]')?.className,
    ).toContain('!w-[min(92vw,760px)]')
    expect(
      document.body.querySelector('[data-slot="sheet-footer"] .grid')
        ?.className,
    ).toContain('sm:grid-cols')
    expect(
      screen.getByRole('button', { name: /^send email$/i }).className,
    ).toContain('w-full')

    fireEvent.click(screen.getByRole('button', { name: /^send email$/i }))
    expect(onSendEmail).toHaveBeenCalledWith(row)

    fireEvent.click(
      screen.getByRole('button', { name: /download attachment/i }),
    )
    expect(onDownloadAttachment).toHaveBeenCalledTimes(1)
  })

  it('renders loading skeletons while the preview request is pending', () => {
    render(
      <ReconciliationEmailPreviewSheetView
        open
        row={row}
        onOpenChange={vi.fn()}
        onSendEmail={vi.fn()}
        preview={null}
        loadError={null}
        isLoading
        isDownloading={false}
        onDownloadAttachment={vi.fn()}
      />,
    )

    expect(
      document.body.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBe(5)
  })

  it('renders an error when the preview cannot be loaded', () => {
    render(
      <ReconciliationEmailPreviewSheetView
        open
        row={row}
        onOpenChange={vi.fn()}
        onSendEmail={vi.fn()}
        preview={null}
        loadError="Customer masterlist entry with email address was not found."
        isLoading={false}
        isDownloading={false}
        onDownloadAttachment={vi.fn()}
      />,
    )

    expect(screen.getByText('Unable to load preview')).toBeTruthy()
    expect(
      screen.getByText(
        'Customer masterlist entry with email address was not found.',
      ),
    ).toBeTruthy()
  })
})
