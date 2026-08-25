/* @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'

import type { OperationalDocumentView } from '@/lib/documents-types'
import {
  DocumentDetailPage,
  getDocumentBackTo,
} from '@/components/document-detail-page'

vi.mock('@tanstack/react-router', () => {
  const Link = React.forwardRef<
    HTMLAnchorElement,
    Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
      to: string
      params?: Record<string, string>
      search?: Record<string, unknown>
      asChild?: boolean
    }
  >(({ to, params, search, asChild: _asChild, children, ...props }, ref) => {
    let href = to

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        href = href.replace(`$${key}`, value)
      }
    }

    if (search) {
      const query = new URLSearchParams(
        Object.entries(search).map(([key, value]) => [key, String(value)]),
      ).toString()
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

vi.mock('@/components/original-pdf-viewer', () => ({
  OriginalPdfViewer: ({
    fileName,
    isVisible,
    panelId,
    sourceUrl,
  }: {
    fileName: string
    isVisible: boolean
    panelId?: string
    sourceUrl: string
  }) => (
    <div
      data-testid="original-pdf-viewer"
      data-file-name={fileName}
      data-panel-id={panelId}
      data-source-url={sourceUrl}
      data-visible={String(isVisible)}
    />
  ),
}))

const baseDocument: OperationalDocumentView = {
  id: 'upload-1',
  kind: 'upload',
  uploadId: 'upload-1',
  uploadBatchId: 'batch-1',
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
  atcCodes: ['WC160'],
  taxRows: [],
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
    { label: 'Agent extraction', status: 'complete' },
    { label: 'Certificate validation', status: 'complete' },
    { label: 'Persist results', status: 'complete' },
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
      label: 'Agent extraction',
      timestamp: 'Apr 23, 2026, 08:27 PM',
      description: 'Whole-document agent extraction completed.',
      status: 'complete',
    },
    {
      label: 'Certificate validation',
      timestamp: 'Apr 23, 2026, 08:27 PM',
      description:
        'Certificate validation, masterlist resolution, and deduplication completed.',
      status: 'complete',
    },
    {
      label: 'Persist results',
      timestamp: 'Apr 23, 2026, 08:27 PM',
      description: 'Envelope, child certificates, and artifacts persisted.',
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
      message: 'Agent extraction completed.',
    },
    {
      timestamp: 'Apr 23, 2026, 08:27 PM',
      level: 'info',
      message: 'Certificate validation completed.',
    },
    {
      timestamp: 'Apr 23, 2026, 08:27 PM',
      level: 'info',
      message: 'Persist results completed.',
    },
  ],
  errors: [],
  validationChecks: [],
  reviewFields: [
    {
      key: 'payeeTin',
      label: 'Payee TIN',
      rawValue: '2665671640000',
      value: '266-567-164-0000',
      confidence: '0.96',
    },
    {
      key: 'payorName',
      label: 'Payor name',
      rawValue: 'Aboitiz Energy Solutions, Inc.',
      value: 'Aboitiz Energy Solutions, Inc.',
      confidence: '0.94',
    },
    {
      key: 'taxWithheld',
      label: 'Tax withheld',
      rawValue: '15628.33',
      value: '15,628.33',
      confidence: '0.91',
    },
  ],
  canDownloadOriginalFile: true,
  canSign: true,
  signingStatus: 'unsigned',
  signedAt: undefined,
  signedByName: undefined,
  signedPdfUrl: undefined,
  hasSavedTemplatePlacement: false,
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
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
    expect(screen.getByTitle('Agent extraction').textContent).toBe('Extract')
    expect(screen.getByTitle('Signing').textContent).toBe('Sign')

    fireEvent.click(screen.getByText('Show details'))

    expect(screen.getByText('File received and stored.')).toBeTruthy()
    expect(screen.getByText('Reconciliation completed.')).toBeTruthy()
    expect(screen.getByText('Ready for batch signing.')).toBeTruthy()

    expect(
      screen.getAllByText('Certificate validation completed.').length,
    ).toBeGreaterThan(0)
  })

  it('renders every certificate ATC row in document order', () => {
    render(
      <DocumentDetailPage
        document={{
          ...baseDocument,
          atc: 'WC157, WV020',
          atcCodes: ['WC157', 'WV020'],
          taxRows: [
            {
              lineNumber: 1,
              pageNumber: 1,
              atcCode: 'WC157',
              description: 'Income payments to suppliers',
              monthlyAmounts: {
                first: '123.45',
                second: null,
                third: null,
              },
              taxBase: '28030.86',
              taxRate: '0.020000',
              taxWithheld: '560.62',
            },
            {
              lineNumber: 2,
              pageNumber: 1,
              atcCode: 'WV020',
              description: 'Government money payments',
              monthlyAmounts: {
                first: '678.90',
                second: null,
                third: null,
              },
              taxBase: '28030.86',
              taxRate: '0.050000',
              taxWithheld: '1401.54',
            },
          ],
        }}
        isLoading={false}
        loadError={null}
      />,
    )

    const rows = screen.getAllByTestId('document-tax-row')
    const atcDetailsCard = screen
      .getByText('ATC details')
      .closest('[data-slot="card"]')

    expect(atcDetailsCard).toBeTruthy()
    expect(
      within(atcDetailsCard as HTMLElement).queryByRole('columnheader', {
        name: 'Description',
      }),
    ).toBeNull()
    expect(
      within(atcDetailsCard as HTMLElement).queryByRole('columnheader', {
        name: /Month [123]/u,
      }),
    ).toBeNull()
    expect(
      within(atcDetailsCard as HTMLElement).queryByText(
        'Income payments to suppliers',
      ),
    ).toBeNull()
    expect(
      within(atcDetailsCard as HTMLElement).queryByText('123.45'),
    ).toBeNull()
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('WC157')).toBeTruthy()
    expect(within(rows[0]).getByText('2%')).toBeTruthy()
    expect(within(rows[0]).getByText('560.62')).toBeTruthy()
    expect(within(rows[1]).getByText('WV020')).toBeTruthy()
    expect(within(rows[1]).getByText('5%')).toBeTruthy()
    expect(within(rows[1]).getByText('1,401.54')).toBeTruthy()
  })

  it('opens the original PDF sheet and resets it for another document', () => {
    const onOriginalPreviewOpenChange = vi.fn()
    const { rerender } = render(
      <DocumentDetailPage
        document={baseDocument}
        isLoading={false}
        loadError={null}
        onOriginalPreviewOpenChange={onOriginalPreviewOpenChange}
      />,
    )

    const toggle = screen.getByRole('button', { name: 'View original PDF' })
    expect(toggle.getAttribute('aria-controls')).toBe(
      'document-original-pdf-panel',
    )
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('original-pdf-viewer')).toBeNull()

    fireEvent.click(toggle)
    expect(onOriginalPreviewOpenChange).toHaveBeenCalledWith(true)

    rerender(
      <DocumentDetailPage
        document={baseDocument}
        isLoading={false}
        loadError={null}
        isOriginalPreviewOpen
        hasOpenedOriginalPreview
        onOriginalPreviewOpenChange={onOriginalPreviewOpenChange}
      />,
    )

    const hideToggle = screen.getByRole('button', {
      name: 'Hide original PDF',
    })
    expect(hideToggle.getAttribute('aria-expanded')).toBe('true')
    const viewer = screen.getByTestId('original-pdf-viewer')
    expect(viewer.getAttribute('data-source-url')).toBe(
      '/api/documents/upload-1/original-preview',
    )
    expect(viewer.getAttribute('data-file-name')).toBe(baseDocument.fileName)
    expect(viewer.getAttribute('data-panel-id')).toBe(
      'document-original-pdf-panel',
    )
    expect(viewer.getAttribute('data-visible')).toBe('true')

    fireEvent.click(hideToggle)
    expect(onOriginalPreviewOpenChange).toHaveBeenLastCalledWith(false)

    rerender(
      <DocumentDetailPage
        document={baseDocument}
        isLoading={false}
        loadError={null}
        hasOpenedOriginalPreview
        onOriginalPreviewOpenChange={onOriginalPreviewOpenChange}
      />,
    )

    expect(
      screen
        .getByRole('button', { name: 'View original PDF' })
        .getAttribute('aria-expanded'),
    ).toBe('false')
    expect(viewer.getAttribute('data-visible')).toBe('false')

    rerender(
      <DocumentDetailPage
        document={{
          ...baseDocument,
          id: 'upload-2',
          uploadId: 'upload-2',
          fileName: 'BIR2307_SECOND.pdf',
        }}
        isLoading={false}
        loadError={null}
        onOriginalPreviewOpenChange={onOriginalPreviewOpenChange}
      />,
    )

    expect(
      screen
        .getByRole('button', { name: 'View original PDF' })
        .getAttribute('aria-expanded'),
    ).toBe('false')
    expect(screen.queryByTestId('original-pdf-viewer')).toBeNull()
  })

  it('disables the original PDF control when the source file is unavailable', () => {
    render(
      <DocumentDetailPage
        document={{
          ...baseDocument,
          canDownloadOriginalFile: false,
        }}
        isLoading={false}
        loadError={null}
      />,
    )

    const unavailableButton = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Original PDF unavailable',
    })
    expect(unavailableButton.disabled).toBe(true)
    expect(unavailableButton.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('original-pdf-viewer')).toBeNull()
  })

  it('places file deletion in the labeled document actions menu', async () => {
    const onDelete = vi.fn()

    render(
      <DocumentDetailPage
        document={baseDocument}
        isLoading={false}
        loadError={null}
        deletionAction={{
          label: 'Delete file',
          onSelect: onDelete,
        }}
      />,
    )

    const summaryCard = screen
      .getByText(baseDocument.fileName)
      .closest('[data-slot="card"]')

    expect(summaryCard).toBeTruthy()
    expect(
      within(summaryCard as HTMLElement).queryByRole('button', {
        name: 'Delete file',
      }),
    ).toBeNull()

    fireEvent.click(
      within(summaryCard as HTMLElement).getByRole('button', {
        name: 'More document actions',
      }),
    )
    const deleteAction = await screen.findByRole('menuitem', {
      name: 'Delete file',
    })

    fireEvent.click(deleteAction)
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('explains protected deletion and surfaces failed deletion status', async () => {
    const onDelete = vi.fn()

    render(
      <DocumentDetailPage
        document={{ ...baseDocument, purgeStatus: 'failed' }}
        isLoading={false}
        loadError={null}
        deletionAction={{
          label: 'Retry deletion',
          disabled: true,
          disabledReason: 'Signed certificates cannot be deleted.',
          onSelect: onDelete,
        }}
      />,
    )

    expect(screen.getByText('Delete failed')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'More document actions' }),
    )

    const retryLabel = await screen.findByText('Retry deletion')
    const retryAction = retryLabel.closest('[data-slot="dropdown-menu-item"]')
    expect(retryAction).toBeTruthy()
    expect(
      screen.getByText('Signed certificates cannot be deleted.'),
    ).toBeTruthy()
    expect((retryAction as HTMLElement).hasAttribute('data-disabled')).toBe(
      true,
    )

    fireEvent.click(retryAction as HTMLElement)
    expect(onDelete).not.toHaveBeenCalled()
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
        canAccessSigning
      />,
    )

    expect(screen.getByText('Extracted fields')).toBeTruthy()
    expect(screen.getByText('No extracted field data available.')).toBeTruthy()
  })

  it('shows nonblocking unassigned-page warnings', () => {
    render(
      <DocumentDetailPage
        document={{
          ...baseDocument,
          warnings: [
            {
              code: 'unassigned_nonblank_page',
              pageNumber: 2,
              message:
                'Page 2 is not assigned to the BIR 2307 certificate and appears to contain other content.',
            },
          ],
        }}
        isLoading={false}
        loadError={null}
      />,
    )

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('Unassigned document page')).toBeTruthy()
    expect(screen.getByText(/Page 2 is not assigned/)).toBeTruthy()
    expect(screen.getByText('Ready')).toBeTruthy()
  })

  it('shows corrected TIN provenance instead of provider confidence', () => {
    render(
      <DocumentDetailPage
        document={{
          ...baseDocument,
          reviewFields: [
            {
              ...baseDocument.reviewFields[0],
              value: '008-778-572-00000',
              verification: {
                status: 'corrected',
                initialValue: '908-778-572-00000',
                initialConfidence: '90%',
                rereadValue: '008-778-572-00000',
                rereadConfidence: '99%',
                originalValue: '908-778-572-00000',
                verifiedAt: 'Aug 05, 2026, 09:02 AM',
              },
            },
          ],
        }}
        isLoading={false}
        loadError={null}
      />,
    )

    expect(screen.getByText('Auto-corrected')).toBeTruthy()
    expect(screen.getByText('First read: 908-778-572-00000 (90%)')).toBeTruthy()
    expect(
      screen.getByText('Focused reread: 008-778-572-00000 (99%)'),
    ).toBeTruthy()
    expect(screen.queryByText(/Initial extraction:/)).toBeNull()
    expect(screen.getByText('Effective confidence 0.96')).toBeTruthy()
    expect(screen.queryByText('Verified by two reads')).toBeNull()
  })

  it('shows a confirmed empty identity field as blank on the form', () => {
    render(
      <DocumentDetailPage
        document={{
          ...baseDocument,
          reviewFields: [
            {
              key: 'payorName',
              label: 'Payor name',
              rawValue: null,
              value: '',
              confidence: '0%',
              verification: {
                status: 'blank',
                initialValue: '',
                initialConfidence: '0%',
              },
            },
          ],
        }}
        isLoading={false}
        loadError={null}
      />,
    )

    expect(screen.getByText('Blank on form')).toBeTruthy()
    expect(screen.getByText('Visibly blank')).toBeTruthy()
    expect(screen.queryByText('AI cannot read confidently')).toBeNull()
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

  it('does not show a resolve action for upload issues', () => {
    render(
      <DocumentDetailPage
        document={{
          ...baseDocument,
          status: 'Error',
        }}
        isLoading={false}
        loadError={null}
        canAccessSigning
      />,
    )

    expect(screen.queryByRole('button', { name: /mark resolved/i })).toBeNull()
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
        canAccessSigning
      />,
    )

    expect(screen.queryByRole('link', { name: /^sign document$/i })).toBeNull()
    expect(screen.getAllByText('View signed batch')).toHaveLength(1)
    expect(
      screen
        .getByRole('link', { name: /view signed batch/i })
        .getAttribute('href'),
    ).toMatch(/^\/upload\/batches\/batch-1\/sign(?:\?|$)/u)
  })

  it('hides signed batch workspace links when signing access is denied', () => {
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
        canAccessSigning={false}
      />,
    )

    expect(
      screen.queryByRole('link', { name: /view signed batch/i }),
    ).toBeNull()
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
        canAccessSigning
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
        canAccessSigning
      />,
    )

    expect(screen.queryByRole('link', { name: /sign document/i })).toBeNull()
    expect(
      screen
        .getByRole('link', { name: /view signed pdf/i })
        .getAttribute('href'),
    ).toMatch(/^\/upload\/batches\/batch-1\/sign(?:\?|$)/u)
    expect(
      screen.queryByRole('link', { name: /download signed pdf/i }),
    ).toBeNull()
    expect(screen.getAllByText('Signed').length).toBeGreaterThan(0)
  })

  it('shows a signed PDF download in More for signed certificates', async () => {
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
        canAccessSigning={false}
      />,
    )

    expect(screen.queryByRole('link', { name: /view signed pdf/i })).toBeNull()
    expect(
      screen.queryByRole('link', { name: /download signed pdf/i }),
    ).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: 'More document actions' }),
    )
    expect(
      (
        await screen.findByRole('menuitem', { name: /download signed pdf/i })
      ).getAttribute('href'),
    ).toBe('/api/documents/9001/signed-pdf')
  })

  it('shows a manual review merge assignment override form for PDF export users', () => {
    render(
      <DocumentDetailPage
        document={{
          ...baseDocument,
          id: '9001',
          certificateId: 9001,
          kind: 'certificate',
          signingStatus: 'signed',
          mergeAssignments: [
            {
              packageType: 'annual',
              status: 'manual_review',
              sourcePeriod: 'TY 2025',
              sourceYear: 2025,
              sourceQuarter: null,
              assignedPeriod: 'Manual review',
              assignedYear: null,
              assignedQuarter: null,
              isLate: true,
              reason: 'late_after_finalized_annual',
              updatedAt: 'May 10, 2026, 08:00 AM',
            },
          ],
        }}
        isLoading={false}
        loadError={null}
        canManageMergeAssignments
      />,
    )

    expect(screen.getByText('Merge assignment review')).toBeTruthy()
    expect(
      screen.getByText('TY 2025 certificate needs an assigned package.', {
        exact: false,
      }),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: /assign package/i })).toBeTruthy()
  })

  it('submits manual review merge assignment overrides', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ assignment: { id: 'assignment-1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const onMergeAssignmentUpdated = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(
      <DocumentDetailPage
        document={{
          ...baseDocument,
          id: 'upload-1',
          certificateId: 9001,
          kind: 'certificate',
          signingStatus: 'signed',
          mergeAssignments: [
            {
              packageType: 'annual',
              status: 'manual_review',
              sourcePeriod: 'TY 2025',
              sourceYear: 2025,
              sourceQuarter: null,
              assignedPeriod: 'Manual review',
              assignedYear: null,
              assignedQuarter: null,
              isLate: true,
              reason: 'late_after_finalized_annual',
              updatedAt: 'May 10, 2026, 08:00 AM',
            },
          ],
        }}
        isLoading={false}
        loadError={null}
        canManageMergeAssignments
        onMergeAssignmentUpdated={onMergeAssignmentUpdated}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /assign package/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/certificates/9001/merge-assignment',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          packageType: 'annual',
          status: 'assigned',
          assignedYear: 2025,
        }),
      }),
    )
    await waitFor(() => expect(onMergeAssignmentUpdated).toHaveBeenCalled())
  })

  it('submits certificate override requests from issue detail', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ request: { id: 'override-1' } }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const onOverrideRequested = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(
      <DocumentDetailPage
        document={{
          ...baseDocument,
          id: 'upload-1',
          certificateId: 9001,
          kind: 'upload',
          status: 'Error',
          stage: 'Validation failed',
          nextStep: 'Review in Issues Queue',
          issueReason: 'Payor was not found in masterlist.',
          errors: [
            {
              code: 'MASTERLIST',
              stage: 'Validation',
              message: 'Payor was not found in masterlist.',
            },
          ],
          canRequestOverride: true,
        }}
        isLoading={false}
        loadError={null}
        canRequestOverride
        onOverrideRequested={onOverrideRequested}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /request override/i }))
    fireEvent.change(await screen.findByLabelText(/field to correct/i), {
      target: { value: 'totals.taxWithheld' },
    })
    fireEvent.change(screen.getByLabelText(/corrected value/i), {
      target: { value: '24.01' },
    })
    fireEvent.change(await screen.findByLabelText(/request note/i), {
      target: { value: 'Business-approved exception.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /submit request/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/certificate-overrides',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          certificateId: 9001,
          changes: [
            {
              fieldPath: 'totals.taxWithheld',
              proposedValue: '24.01',
            },
          ],
          requestNote: 'Business-approved exception.',
        }),
      }),
    )
    await waitFor(() => expect(onOverrideRequested).toHaveBeenCalled())
  })

  it('shows approved override metadata on document detail', () => {
    render(
      <DocumentDetailPage
        document={{
          ...baseDocument,
          id: '9001',
          certificateId: 9001,
          kind: 'certificate',
          override: {
            requestId: 'override-1',
            status: 'approved',
            requestNote: 'Business-approved exception.',
            requestedAt: 'May 20, 2026, 09:00 AM',
            requestedByName: 'Editor User',
            decisionNote: 'Approved for reconciliation.',
            decidedAt: 'May 20, 2026, 10:00 AM',
            decidedByName: 'Admin User',
          },
        }}
        isLoading={false}
        loadError={null}
      />,
    )

    expect(screen.getByText('Override request')).toBeTruthy()
    expect(screen.getByText('Approved')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /view override/i }))
    expect(screen.getByText('Approved for reconciliation.')).toBeTruthy()
  })

  it('shows the retry action in the Errors card for an eligible failed upload', () => {
    const onRetryExtraction = vi.fn()
    render(
      <DocumentDetailPage
        document={{
          ...baseDocument,
          status: 'Error',
          extractionRetry: {
            provider: 'gemini',
            sourceDocumentResultId: 38,
            sourceExtractionAttemptId: 104,
            reasonCodes: ['gemini_http_503'],
            canRetry: true,
            retryCount: 0,
            maxRetries: 3,
            cooldownUntil: null,
            disabledReason: null,
          },
        }}
        isLoading={false}
        loadError={null}
        onRetryExtraction={onRetryExtraction}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Retry extraction' }))
    expect(onRetryExtraction).toHaveBeenCalledTimes(1)
    expect(
      screen.getByText('Retry 1 of 3 · Uses the original PDF.'),
    ).toBeTruthy()

    const summaryCard = screen
      .getByText(baseDocument.fileName)
      .closest('[data-slot="card"]')
    expect(summaryCard).toBeTruthy()
    expect(
      within(summaryCard as HTMLElement).queryByRole('button', {
        name: 'Retry extraction',
      }),
    ).toBeNull()
  })

  it('shows why an extraction retry is disabled', () => {
    render(
      <DocumentDetailPage
        document={{
          ...baseDocument,
          status: 'Queued',
          extractionRetry: {
            provider: 'gemini',
            sourceDocumentResultId: 38,
            sourceExtractionAttemptId: 104,
            reasonCodes: ['gemini_http_503'],
            canRetry: false,
            retryCount: 1,
            maxRetries: 3,
            cooldownUntil: null,
            disabledReason: 'already_processing',
          },
        }}
        isLoading={false}
        loadError={null}
      />,
    )

    const retryButton = screen.getByRole('button', {
      name: 'Extraction queued',
    })
    expect(retryButton.hasAttribute('disabled')).toBe(true)
    expect(
      screen.getByText('Extraction is already queued or processing.'),
    ).toBeTruthy()
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
        status: 'Review',
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
