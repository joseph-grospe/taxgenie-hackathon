/* @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import type { ReactNode } from 'react'

import type { OperationalDocumentView } from '@/lib/documents-types'
import {
  DocumentDetailPage,
  getDocumentBackTo,
} from '@/components/document-detail-page'

vi.mock('@tanstack/react-router', () => {
  const Link = React.forwardRef<
    HTMLAnchorElement,
    {
      to: string
      params?: Record<string, string>
      search?: Record<string, string>
      asChild?: boolean
      children?: ReactNode
      className?: string
      [key: string]: unknown
    }
  >(({ to, params, search, asChild: _asChild, children, ...props }, ref) => {
    let href = to

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        href = href.replace(`$${key}`, value)
      }
    }

    if (search) {
      const query = new URLSearchParams(search).toString()
      href = query ? `${href}?${query}` : href
    }

    return (
      <a ref={ref} href={href} {...props}>
        {children}
      </a>
    )
  })

  Link.displayName = 'MockTanStackLink'

  return { Link }
})

const baseDocument: OperationalDocumentView = {
  id: 'upload-1',
  kind: 'upload',
  uploadId: 'upload-1',
  uploadBatchId: 'batch-1',
  attentionStatus: 'open',
  attentionResolvedAt: undefined,
  fileName: 'BIR2307_AKELCO_EAUC_TS-WF-230F-0045296_0825_20251003.pdf',
  uploadedAt: 'Apr 23, 2026, 08:27 PM',
  sizeBytes: 1_700_000,
  status: 'Ready',
  stage: 'Validated',
  nextStep: 'Sign batch',
  payee: 'East Asia Utilities Corporation',
  payorName: 'Aboitiz Energy Solutions, Inc.',
  period: 'September 2025',
  atc: 'WC160',
  taxBase: '781,416.66',
  taxWithheld: '15,628.33',
  confidence: '0.93',
  year: '2025',
  month: 'September',
  quarter: 'Q3',
  entity: 'Manual Upload',
  customerType: 'BIR 2307',
  errorTypes: ['None'],
  issueReason: 'Processed certificate.',
  severity: 'Low',
  owner: 'TaxTrack Admin',
  updatedAt: 'Apr 23, 2026, 08:27 PM',
  processing: {
    startedAt: 'Apr 23, 2026, 08:27 PM',
    updatedAt: 'Apr 23, 2026, 08:27 PM',
    worker: 'job-1',
    elapsed: '27s',
  },
  trail: [
    { label: 'Uploaded', status: 'complete' },
    { label: 'Queued', status: 'complete' },
    { label: 'OCR / Layout', status: 'complete' },
    { label: 'AI Normalize', status: 'complete' },
    { label: 'Masterlist Check', status: 'complete' },
    { label: 'Validation + Variance', status: 'complete' },
    { label: 'Deduplication', status: 'complete' },
    { label: 'Rename + Persist', status: 'complete' },
    { label: 'Reconciliation', status: 'complete' },
    {
      label: 'Signing',
      status: 'active',
      detail: 'Ready for batch signing.',
    },
  ],
  trailDetails: [
    {
      label: 'Uploaded',
      timestamp: 'Apr 23, 2026, 08:27 PM',
      description: 'File received and stored.',
      status: 'complete',
    },
    {
      label: 'Queued',
      timestamp: 'Apr 23, 2026, 08:27 PM',
      description: 'Document queued for processing.',
      status: 'complete',
    },
    {
      label: 'OCR / Layout',
      timestamp: 'Apr 23, 2026, 08:27 PM',
      description: 'OCR and layout analysis completed.',
      status: 'complete',
    },
    {
      label: 'AI Normalize',
      timestamp: 'Apr 23, 2026, 08:27 PM',
      description: 'Data normalized using AI.',
      status: 'complete',
    },
    {
      label: 'Masterlist Check',
      timestamp: 'Apr 23, 2026, 08:27 PM',
      description: 'Checked against masterlist.',
      status: 'complete',
    },
    {
      label: 'Validation + Variance',
      timestamp: 'Apr 23, 2026, 08:27 PM',
      description: 'Validation and variance completed.',
      status: 'complete',
    },
    {
      label: 'Deduplication',
      timestamp: 'Apr 23, 2026, 08:27 PM',
      description: 'Deduplication completed.',
      status: 'complete',
    },
    {
      label: 'Rename + Persist',
      timestamp: 'Apr 23, 2026, 08:27 PM',
      description: 'File renamed and persisted.',
      status: 'complete',
    },
    {
      label: 'Reconciliation',
      timestamp: 'Apr 23, 2026, 08:27 PM',
      description: 'Reconciliation completed.',
      status: 'complete',
    },
    {
      label: 'Signing',
      timestamp: '—',
      description: 'Ready for batch signing.',
      status: 'active',
    },
  ],
  logs: [
    {
      timestamp: 'Apr 23, 2026, 08:27 PM',
      level: 'info',
      message: 'File uploaded to the storage bucket.',
    },
    {
      timestamp: 'Apr 23, 2026, 08:27 PM',
      level: 'info',
      message: 'Document queued for async processing.',
    },
    {
      timestamp: 'Apr 23, 2026, 08:27 PM',
      level: 'info',
      message: 'Load input completed.',
    },
    {
      timestamp: 'Apr 23, 2026, 08:27 PM',
      level: 'info',
      message: 'OCR / Layout completed.',
    },
    {
      timestamp: 'Apr 23, 2026, 08:27 PM',
      level: 'info',
      message: 'Check Duplicate Page completed.',
    },
    {
      timestamp: 'Apr 23, 2026, 08:27 PM',
      level: 'info',
      message: 'AI Normalize completed.',
    },
    {
      timestamp: 'Apr 23, 2026, 08:27 PM',
      level: 'info',
      message: 'Masterlist Check completed.',
    },
    {
      timestamp: 'Apr 23, 2026, 08:27 PM',
      level: 'info',
      message: 'Validation + Variance completed.',
    },
  ],
  errors: [],
  validationChecks: [],
  reviewFields: [
    {
      label: 'Payee TIN',
      value: '266-567-164-0000',
      confidence: '0.96',
    },
    {
      label: 'Payor name',
      value: 'Aboitiz Energy Solutions, Inc.',
      confidence: '0.94',
    },
    {
      label: 'Tax withheld',
      value: '15,628.33',
      confidence: '0.91',
    },
  ],
  canSign: true,
  signingStatus: 'unsigned',
  signedAt: undefined,
  signedByName: undefined,
  signedPdfUrl: undefined,
  hasSavedTemplatePlacement: false,
}

afterEach(() => {
  cleanup()
})

describe('DocumentDetailPage', () => {
  it('renders loading, error, and empty states', () => {
    const { rerender } = render(
      <DocumentDetailPage document={null} isLoading loadError={null} />,
    )

    expect(screen.getByText('Loading document detail…')).toBeTruthy()

    rerender(
      <DocumentDetailPage
        document={null}
        isLoading={false}
        loadError="Unable to load document detail."
      />,
    )

    expect(screen.getByText('Unable to load document detail.')).toBeTruthy()

    rerender(
      <DocumentDetailPage document={null} isLoading={false} loadError={null} />,
    )

    expect(screen.getByText('Document not found.')).toBeTruthy()
  })

  it('renders the workflow-first layout and interactive detail controls', () => {
    render(
      <DocumentDetailPage
        document={baseDocument}
        isLoading={false}
        loadError={null}
      />,
    )

    expect(screen.queryByRole('link', { name: /^sign$/i })).toBeNull()
    expect(screen.getByText('Sign batch')).toBeTruthy()
    expect(screen.getByText('Document metadata')).toBeTruthy()
    const metadataCard = screen
      .getByText('Document metadata')
      .closest('[data-slot="card"]')

    expect(metadataCard).toBeTruthy()
    expect(within(metadataCard as HTMLElement).queryByText('ATC')).toBeNull()
    expect(
      within(metadataCard as HTMLElement).queryByText('Tax base'),
    ).toBeNull()
    expect(
      within(metadataCard as HTMLElement).queryByText('Tax withheld'),
    ).toBeNull()
    expect(screen.getByText('Extracted fields')).toBeTruthy()
    expect(screen.getByText('Payee TIN')).toBeTruthy()
    expect(screen.getByText('266-567-164-0000')).toBeTruthy()
    expect(
      screen.getAllByText('Aboitiz Energy Solutions, Inc.').length,
    ).toBeGreaterThan(0)
    expect(screen.getAllByText('15,628.33').length).toBeGreaterThan(0)
    expect(screen.getByText('Confidence 0.96')).toBeTruthy()
    expect(screen.getByText('Processing summary')).toBeTruthy()
    expect(screen.getByTitle('OCR / Layout').textContent).toBe('OCR')
    expect(screen.getByTitle('Signing').textContent).toBe('Sign')

    fireEvent.click(screen.getByText('Show details'))

    expect(screen.getByText('File received and stored.')).toBeTruthy()
    expect(screen.getByText('Reconciliation completed.')).toBeTruthy()
    expect(screen.getByText('Ready for batch signing.')).toBeTruthy()

    fireEvent.click(screen.getByText('Show more'))

    expect(screen.getByText('Validation + Variance completed.')).toBeTruthy()
  })

  it('renders an empty state when normalized review fields are unavailable', () => {
    render(
      <DocumentDetailPage
        document={{
          ...baseDocument,
          reviewFields: [],
        }}
        isLoading={false}
        loadError={null}
      />,
    )

    expect(screen.getByText('Extracted fields')).toBeTruthy()
    expect(screen.getByText('No extracted field data available.')).toBeTruthy()
  })

  it('renders explicit empty certificate state and preserves error review links', () => {
    const errorDocument: OperationalDocumentView = {
      ...baseDocument,
      status: 'Error',
      stage: 'Validation failed',
      nextStep: 'Review in Issues Queue',
      issueReason: 'Missing TIN',
      errorTypes: ['Missing TIN'],
      errors: [
        {
          code: 'TIN_MISSING',
          stage: 'Validation',
          message: 'Payee TIN is missing from the extracted data.',
        },
      ],
    }

    render(
      <DocumentDetailPage
        document={errorDocument}
        isLoading={false}
        loadError={null}
      />,
    )

    expect(screen.getByText('Review in Issues Queue')).toBeTruthy()

    const reviewLink = screen.getByRole('link', {
      name: /payee tin is missing from the extracted data/i,
    })

    expect(reviewLink.getAttribute('href')).toBe(
      '/error-detail?docId=upload-1&errorIndex=0',
    )
  })

  it('shows a resolve action for unresolved upload issues', () => {
    const onResolveAttention = vi.fn()

    render(
      <DocumentDetailPage
        document={{
          ...baseDocument,
          status: 'Error',
        }}
        isLoading={false}
        loadError={null}
        onResolveAttention={onResolveAttention}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /mark resolved/i }))

    expect(onResolveAttention).toHaveBeenCalledTimes(1)
  })

  it('hides the resolve action once cleared', () => {
    render(
      <DocumentDetailPage
        document={{
          ...baseDocument,
          status: 'Duplicate',
          attentionStatus: 'resolved',
          attentionResolvedAt: 'Apr 23, 2026, 09:10 PM',
        }}
        isLoading={false}
        loadError={null}
      />,
    )

    expect(screen.queryByRole('button', { name: /mark resolved/i })).toBeNull()
    expect(
      screen.queryByText('Resolved Apr 23, 2026, 09:10 PM'),
    ).toBeNull()
  })

  it('shows a signed-document action for fully signed uploads', () => {
    render(
      <DocumentDetailPage
        document={{
          ...baseDocument,
          canSign: false,
          signingStatus: 'signed',
          nextStep: 'View signed batch',
          signedAt: 'Apr 24, 2026, 09:10 AM',
          signedByName: 'Jane Doe',
        }}
        isLoading={false}
        loadError={null}
      />,
    )

    expect(screen.queryByRole('link', { name: /^sign document$/i })).toBeNull()
    expect(screen.getAllByText('View signed batch')).toHaveLength(1)
    expect(
      screen
        .getByRole('link', { name: /view signed batch/i })
        .getAttribute('href'),
    ).toBe('/upload/batches/batch-1/sign')
  })

  it('does not render a sign action for signable documents', () => {
    render(
      <DocumentDetailPage
        document={{
          ...baseDocument,
          canSign: true,
          signingStatus: 'unsigned',
        }}
        isLoading={false}
        loadError={null}
      />,
    )

    expect(screen.queryByRole('link', { name: /^sign$/i })).toBeNull()
  })

  it('hides the sign action once a certificate is already signed', () => {
    render(
      <DocumentDetailPage
        document={{
          ...baseDocument,
          id: '9001',
          kind: 'certificate',
          canSign: true,
          signingStatus: 'signed',
          signedAt: 'Apr 24, 2026, 09:10 AM',
          signedByName: 'Jane Doe',
          signedPdfUrl: '/api/s3-object?key=signed.pdf&bucket=test',
        }}
        isLoading={false}
        loadError={null}
      />,
    )

    expect(screen.queryByRole('link', { name: /sign document/i })).toBeNull()
    expect(
      screen
        .getByRole('link', { name: /view signed pdf/i })
        .getAttribute('href'),
    ).toBe('/upload/batches/batch-1/sign')
    expect(
      screen.queryByRole('link', { name: /download signed pdf/i }),
    ).toBeNull()
    expect(screen.getAllByText('Signed').length).toBeGreaterThan(0)
  })

  it('shows a signed PDF download for signed certificates when allowed', () => {
    render(
      <DocumentDetailPage
        document={{
          ...baseDocument,
          id: '9001',
          kind: 'certificate',
          canSign: false,
          signingStatus: 'signed',
          signedAt: 'Apr 24, 2026, 09:10 AM',
          signedByName: 'Jane Doe',
          signedPdfUrl: '/api/s3-object?key=signed.pdf&bucket=test',
        }}
        isLoading={false}
        loadError={null}
        canDownloadSignedPdf
      />,
    )

    expect(
      screen
        .getByRole('link', { name: /download signed pdf/i })
        .getAttribute('href'),
    ).toBe('/api/documents/9001/signed-pdf')
  })
})

describe('getDocumentBackTo', () => {
  it('preserves existing back navigation logic by status', () => {
    expect(getDocumentBackTo(null)).toBe('/upload')
    expect(getDocumentBackTo(baseDocument)).toBe('/validated')
    expect(
      getDocumentBackTo({
        ...baseDocument,
        status: 'Duplicate',
      }),
    ).toBe('/issues')
    expect(
      getDocumentBackTo({
        ...baseDocument,
        status: 'Processing',
      }),
    ).toBe('/upload')
  })
})
