/* @vitest-environment jsdom */

import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'

import type {
  SignaturePlacementTemplate,
  SignatureProfileView,
  SigningContextView,
  SigningTargetView,
} from '@/lib/signing-module'
import {
  DocumentSigningPage,
  buildSigningCompleteFlagModel,
} from '@/components/document-signing-page'

const pdfMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  getPage: vi.fn(),
  renderPage: vi.fn(),
}))

const virtualizerMocks = vi.hoisted(() => ({
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
}))

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}))

const toastMocks = vi.hoisted(() => ({
  custom: vi.fn(),
  dismiss: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {
    workerSrc: '',
  },
  getDocument: pdfMocks.getDocument,
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => routerMocks.navigate,
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count }: { count: number }) => ({
    getTotalSize: () => count * 112,
    getVirtualItems: () =>
      Array.from({ length: Math.min(count, 12) }, (_, index) => ({
        index,
        key: `certificate-row-${index}`,
        start: index * 112,
        size: 112,
      })),
    measureElement: virtualizerMocks.measureElement,
    scrollToIndex: virtualizerMocks.scrollToIndex,
  })),
}))

vi.mock('sonner', () => ({
  toast: toastMocks,
}))

vi.mock('@/components/product-tour', () => ({
  SigningTour: ({ startSignal = 0 }: { startSignal?: number }) => (
    <div data-testid="signing-tour">Signing tour {startSignal}</div>
  ),
}))

vi.mock('@/components/ui/alert', () => {
  const Div = ({ children, ...props }: React.ComponentProps<'div'>) => (
    <div {...props}>{children}</div>
  )

  return {
    Alert: Div,
    AlertDescription: Div,
    AlertTitle: Div,
  }
})

vi.mock('@/components/ui/alert-dialog', () => {
  const Div = ({
    children,
    onOpenChange: _onOpenChange,
    open: _open,
    ...props
  }: React.ComponentProps<'div'> & {
    onOpenChange?: (open: boolean) => void
    open?: boolean
  }) => <div {...props}>{children}</div>
  const Button = ({
    children,
    render: _render,
    ...props
  }: React.ComponentProps<'button'> & { render?: React.ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  )

  return {
    AlertDialog: Div,
    AlertDialogAction: Button,
    AlertDialogCancel: Button,
    AlertDialogContent: Div,
    AlertDialogDescription: Div,
    AlertDialogFooter: Div,
    AlertDialogHeader: Div,
    AlertDialogTitle: Div,
    AlertDialogTrigger: Button,
  }
})

vi.mock('@/components/ui/badge', () => ({
  Badge: ({
    children,
    variant: _variant,
    ...props
  }: React.ComponentProps<'span'> & { variant?: string }) => (
    <span {...props}>{children}</span>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    size: _size,
    variant: _variant,
    ...props
  }: React.ComponentProps<'button'> & {
    size?: string
    variant?: string
  }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  buttonVariants: () => '',
}))

vi.mock('@/components/ui/card', () => {
  const Div = ({ children, ...props }: React.ComponentProps<'div'>) => (
    <div {...props}>{children}</div>
  )

  return {
    Card: Div,
    CardContent: Div,
    CardDescription: Div,
    CardHeader: Div,
    CardTitle: Div,
  }
})

vi.mock('@/components/ui/dropdown-menu', () => {
  const Div = ({ children, ...props }: React.ComponentProps<'div'>) => (
    <div {...props}>{children}</div>
  )
  const Trigger = ({
    asChild: _asChild,
    render,
    children,
    ...props
  }: React.ComponentProps<'div'> & {
    asChild?: boolean
    render?: React.ReactElement
  }) => {
    if (React.isValidElement(render)) {
      return React.cloneElement(render, props, children)
    }

    return <div {...props}>{children}</div>
  }
  const Button = ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button type="button" {...props}>
      {children}
    </button>
  )

  return {
    DropdownMenu: Div,
    DropdownMenuContent: Div,
    DropdownMenuGroup: Div,
    DropdownMenuItem: Button,
    DropdownMenuTrigger: Trigger,
  }
})

vi.mock('@/components/ui/field', () => {
  const Div = ({ children, ...props }: React.ComponentProps<'div'>) => (
    <div {...props}>{children}</div>
  )
  const Label = ({ children, ...props }: React.ComponentProps<'label'>) => (
    <label {...props}>{children}</label>
  )

  return {
    Field: Div,
    FieldContent: Div,
    FieldDescription: Div,
    FieldError: Div,
    FieldGroup: Div,
    FieldLabel: Label,
  }
})

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
}))

vi.mock('@/components/ui/select', () => {
  const Div = ({
    children,
    onValueChange: _onValueChange,
    value: _value,
    ...props
  }: React.ComponentProps<'div'> & {
    onValueChange?: (value: string) => void
    value?: string
  }) => <div {...props}>{children}</div>

  return {
    Select: Div,
    SelectContent: Div,
    SelectGroup: Div,
    SelectItem: Div,
    SelectTrigger: Div,
    SelectValue: Div,
  }
})

vi.mock('@/components/ui/separator', () => ({
  Separator: (props: React.ComponentProps<'hr'>) => <hr {...props} />,
}))

vi.mock('@/components/ui/sheet', () => {
  const Div = ({
    children,
    onOpenChange: _onOpenChange,
    open: _open,
    ...props
  }: React.ComponentProps<'div'> & {
    onOpenChange?: (open: boolean) => void
    open?: boolean
  }) => <div {...props}>{children}</div>

  return {
    Sheet: Div,
    SheetContent: Div,
    SheetDescription: Div,
    SheetFooter: Div,
    SheetHeader: Div,
    SheetTitle: Div,
  }
})

vi.mock('@/components/ui/tabs', () => {
  const Div = ({
    children,
    onValueChange: _onValueChange,
    value: _value,
    ...props
  }: React.ComponentProps<'div'> & {
    onValueChange?: (value: string) => void
    value?: string
  }) => <div {...props}>{children}</div>
  const Button = ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button type="button" {...props}>
      {children}
    </button>
  )

  return {
    Tabs: Div,
    TabsContent: Div,
    TabsList: Div,
    TabsTrigger: Button,
  }
})

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = []

const renderIntoDocument = async (element: React.ReactNode) => {
  const container = document.createElement('div')
  const root = createRoot(container)
  document.body.append(container)
  mountedRoots.push({ container, root })

  await React.act(() => {
    root.render(element)
  })

  return container
}

const waitForAssertion = async (assertion: () => void) => {
  const startedAt = Date.now()
  let latestError: unknown

  while (Date.now() - startedAt < 1000) {
    try {
      assertion()
      return
    } catch (error) {
      latestError = error
      await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
    }
  }

  throw latestError
}

const buildTarget = (index: number): SigningTargetView => ({
  documentResultId: `target-${index}`,
  fileName: `certificate-${index}.pdf`,
  payee: `Certificate Holder ${index}`,
  certificatePageNumber: 1,
  sourcePdfUrl: `/api/s3-object?key=certificate-${index}.pdf`,
  previewPageNumber: 1,
  templateKey: 'default-bir-2307',
  signingStatus: 'unsigned',
  hasSavedTemplatePlacement: false,
  templatePlacement: null,
})

const buildSignatureProfile = (): SignatureProfileView => ({
  displayName: 'Tax Manager',
  designation: 'Finance Lead',
  tin: '123456789000',
  signatureImageKey: 'signatures/tax-manager.png',
  signatureImageUrl: '/signature.png',
  signatureImageMimeType: 'image/png',
  signatureImageWidth: 320,
  signatureImageHeight: 120,
})

const buildSignaturePlacementTemplate = (): SignaturePlacementTemplate => ({
  pageNumber: 1,
  signatureRect: {
    x: 0.58,
    y: 0.66,
    width: 0.24,
    height: 0.16,
  },
  signatureImageRect: {
    x: 0.62,
    y: 0.68,
    width: 0.16,
    height: 0.06,
  },
  nameRect: {
    x: 0.6,
    y: 0.75,
    width: 0.08,
    height: 0.04,
  },
  designationRect: {
    x: 0.7,
    y: 0.75,
    width: 0.08,
    height: 0.04,
  },
  tinRect: {
    x: 0.8,
    y: 0.75,
    width: 0.08,
    height: 0.04,
  },
})

const buildReadyTarget = (index: number): SigningTargetView => ({
  ...buildTarget(index),
  hasSavedTemplatePlacement: true,
  templatePlacement: buildSignaturePlacementTemplate(),
})

const buildSigningContext = (targetCount: number): SigningContextView => ({
  documentId: 'batch-1',
  fileName: 'Large certificate batch',
  certificateCount: targetCount,
  targets: Array.from({ length: targetCount }, (_, index) =>
    buildTarget(index + 1),
  ),
  signatureProfile: null,
})

const buildSigningContextFromTargets = (
  targets: Array<SigningTargetView>,
  signatureProfile: SignatureProfileView | null = null,
): SigningContextView => ({
  documentId: 'batch-1',
  fileName: 'Large certificate batch',
  certificateCount: targets.length,
  targets,
  signatureProfile,
})

const buildSignedTarget = (index: number): SigningTargetView => ({
  ...buildTarget(index),
  signingStatus: 'signed',
  signedAt: '2026-06-04T10:30:00.000Z',
  signedByName: 'Tax Manager',
  signedPdfUrl: `/api/documents/target-${index}/signed-pdf`,
})

const stubSigningContext = (context: SigningContextView) => {
  const fetchMock = globalThis.fetch as unknown as {
    mockResolvedValue: (response: Response) => void
  }

  fetchMock.mockResolvedValue(Response.json({ signingContext: context }))
}

const renderSigningPage = async (
  element: React.ReactNode,
  context: SigningContextView,
) => {
  stubSigningContext(context)
  await renderIntoDocument(element)

  await waitForAssertion(() => {
    expect(document.body.textContent).toContain('Large certificate batch')
  })
}

const getActionElements = (label: string) =>
  Array.from(document.querySelectorAll('button, a')).filter((element) =>
    element.textContent.includes(label),
  )

beforeEach(() => {
  const actGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true

  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        Response.json({
          signingContext: buildSigningContext(60),
        }),
      ),
    ),
  )

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    {} as CanvasRenderingContext2D,
  )
  pdfMocks.renderPage.mockReturnValue({ promise: Promise.resolve() })
  pdfMocks.getPage.mockResolvedValue({
    getViewport: () => ({
      height: 792,
      width: 612,
    }),
    render: pdfMocks.renderPage,
  })
  pdfMocks.getDocument.mockReturnValue({
    promise: Promise.resolve({
      numPages: 1,
      getPage: pdfMocks.getPage,
    }),
  })
})

afterEach(async () => {
  for (const { container, root } of mountedRoots.splice(0)) {
    await React.act(() => {
      root.unmount()
    })
    container.remove()
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  pdfMocks.getDocument.mockReset()
  pdfMocks.getPage.mockReset()
  pdfMocks.renderPage.mockReset()
  virtualizerMocks.measureElement.mockReset()
  virtualizerMocks.scrollToIndex.mockReset()
  routerMocks.navigate.mockReset()
  toastMocks.custom.mockReset()
  toastMocks.dismiss.mockReset()
  toastMocks.error.mockReset()
  toastMocks.success.mockReset()
})

describe('buildSigningCompleteFlagModel', () => {
  it('guides users from signed documents into PDF merging', () => {
    expect(
      buildSigningCompleteFlagModel({ resign: false, signedCount: 3 }),
    ).toMatchObject({
      actionLabel: 'Merge PDFs',
      description: 'Next, merge the signed PDFs into EAFS-ready batches.',
      duration: 10_000,
      position: 'bottom-right',
      title: 'Certificates signed',
    })
  })

  it('uses updated PDF copy for re-signed documents', () => {
    expect(
      buildSigningCompleteFlagModel({ resign: true, signedCount: 1 }),
    ).toMatchObject({
      actionLabel: 'Merge PDFs',
      description:
        'Next, merge the updated signed PDFs into EAFS-ready batches.',
      title: 'Certificate re-signed',
    })
  })
})

describe('DocumentSigningPage', () => {
  it('exposes signing tour targets on the loaded workspace', async () => {
    await renderSigningPage(
      <DocumentSigningPage
        batchId="batch-1"
        tourTargets={{
          certificateList: 'signing.certificateList',
          placement: 'signing.placement',
          preview: 'signing.preview',
          previewControls: 'signing.previewControls',
          previewTabs: 'signing.previewTabs',
          profile: 'signing.profile',
          status: 'signing.status',
          summary: 'signing.summary',
          toolbar: 'signing.toolbar',
        }}
      />,
      buildSigningContext(2),
    )

    for (const targetId of [
      'signing.certificateList',
      'signing.placement',
      'signing.preview',
      'signing.previewControls',
      'signing.previewTabs',
      'signing.profile',
      'signing.status',
      'signing.summary',
      'signing.toolbar',
    ]) {
      expect(
        document.querySelector(`[data-tour-id="${targetId}"]`),
      ).toBeTruthy()
    }

    expect(document.body.textContent).toContain('Signing tour 0')

    React.act(() => {
      window.dispatchEvent(
        new CustomEvent('taxtrack.signingTour.restart', {
          detail: { signingId: 'batch-1' },
        }),
      )
    })

    await waitForAssertion(() => {
      expect(document.body.textContent).toContain('Signing tour 1')
    })
  })

  it('virtualizes certificate rows and avoids eager thumbnail rendering', async () => {
    await renderIntoDocument(<DocumentSigningPage batchId="batch-1" />)

    await waitForAssertion(() => {
      expect(document.body.textContent).toContain('Certificate Holder 1')
    })

    const renderedTargets =
      document.body.textContent.match(/Certificate Holder \d+/g) ?? []
    expect(renderedTargets).toHaveLength(12)
    expect(document.body.textContent).not.toContain('Certificate Holder 13')

    await waitForAssertion(() =>
      expect(pdfMocks.getDocument).toHaveBeenCalledTimes(1),
    )
    expect(pdfMocks.getDocument).toHaveBeenCalledWith(
      '/api/s3-object?key=certificate-1.pdf',
    )
  })

  it('shows the full certificate filename without the redundant page label', async () => {
    const longFileName =
      'very-long-certificate-filename-for-june-2026-with-billing-reference-0001.pdf'

    await renderSigningPage(
      <DocumentSigningPage batchId="batch-1" />,
      buildSigningContextFromTargets([
        {
          ...buildTarget(1),
          fileName: longFileName,
          payee: 'Certificate Holder With A Long Registered Name',
        },
      ]),
    )

    expect(document.body.textContent).toContain(longFileName)
    expect(document.body.textContent).not.toContain('Page 1')
  })

  it('shows a focused signing toolbar for a single unsigned certificate', async () => {
    await renderSigningPage(
      <DocumentSigningPage batchId="batch-1" />,
      buildSigningContext(1),
    )

    expect(getActionElements('Sign certificate')).toHaveLength(2)
    expect(
      document.querySelector('[aria-label="Open signing actions"]'),
    ).toBeTruthy()
    expect(document.body.textContent).not.toContain('Download signed')
  })

  it('uses Sign pending for multi-certificate unsigned batches', async () => {
    await renderSigningPage(
      <DocumentSigningPage batchId="batch-1" />,
      buildSigningContext(2),
    )

    expect(getActionElements('Sign pending')).toHaveLength(2)
    expect(
      document.querySelector('[aria-label="Open signing actions"]'),
    ).toBeTruthy()
  })

  it('uses one preview click for combined text and signature placement', async () => {
    const target = buildTarget(1)
    const fetchMock = globalThis.fetch as unknown as {
      mock: { calls: Array<[string, RequestInit | undefined]> }
      mockResolvedValueOnce: (response: Response) => void
    }

    fetchMock.mockResolvedValueOnce(
      Response.json({
        signingContext: buildSigningContextFromTargets(
          [target],
          buildSignatureProfile(),
        ),
      }),
    )
    fetchMock.mockResolvedValueOnce(
      Response.json({
        signedArtifacts: [
          {
            documentResultId: target.documentResultId,
            status: 'signed',
            signedAt: '2026-06-05T09:00:00.000Z',
            signedByName: 'Tax Manager',
            signedPdfUrl: '/api/documents/target-1/signed-pdf',
            templatePlacement: buildSignaturePlacementTemplate(),
          },
        ],
      }),
    )

    await renderIntoDocument(<DocumentSigningPage batchId="batch-1" />)

    await waitForAssertion(() => {
      expect(document.body.textContent).toContain('Large certificate batch')
    })

    expect(document.body.textContent).not.toContain('Placement step')
    expect(document.body.textContent).not.toContain('Place text block')
    expect(document.body.textContent).not.toContain('Place signature')
    expect(document.querySelector('#signature-size')).toBeNull()

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 1000,
      height: 1000,
      left: 0,
      right: 1000,
      top: 0,
      width: 1000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    const preview = document.querySelector('div[role="button"]')
    expect(preview).toBeTruthy()

    await React.act(() => {
      preview?.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: 780,
          clientY: 740,
        }),
      )
    })

    expect(document.body.textContent).toContain(
      'Placement set for certificate page 1.',
    )

    const signAction = getActionElements('Sign certificate').at(-1)
    expect(signAction).toBeTruthy()

    await React.act(() => {
      ;(signAction as HTMLButtonElement).click()
    })

    await waitForAssertion(() => {
      expect(fetchMock.mock.calls).toHaveLength(2)
    })

    const signRequest = JSON.parse(
      fetchMock.mock.calls[1]?.[1]?.body as string,
    ) as {
      targets: Array<{
        signatureImageRect?: unknown
        signatureRect: { x: number; y: number }
      }>
    }

    expect(signRequest.targets[0]?.signatureImageRect).toBeUndefined()
    expect(signRequest.targets[0]?.signatureRect.x).toBeGreaterThan(0)
    expect(signRequest.targets[0]?.signatureRect.y).toBeGreaterThan(0)
  })

  it('prioritizes signed downloads for fully signed downloadable batches', async () => {
    await renderSigningPage(
      <DocumentSigningPage batchId="batch-1" canDownloadSignedPdf />,
      buildSigningContextFromTargets([buildSignedTarget(1)]),
    )

    const signedDownloadLinks = Array.from(
      document.querySelectorAll('a'),
    ).filter((element) => element.textContent.includes('Download signed'))

    expect(signedDownloadLinks).toHaveLength(1)
    expect(signedDownloadLinks[0]?.getAttribute('href')).toBe(
      '/api/documents/target-1/signed-pdf',
    )
    expect(getActionElements('Batch signed')).toHaveLength(0)
    expect(getActionElements('Document signed')).toHaveLength(0)
  })

  it('shows all-signed batch download without replacing the single signed download', async () => {
    const onDownloadSignedCertificates = vi.fn().mockResolvedValue(undefined)
    await renderSigningPage(
      <DocumentSigningPage
        batchId="batch-1"
        canDownloadSignedPdf
        onDownloadSignedCertificates={onDownloadSignedCertificates}
      />,
      buildSigningContextFromTargets([buildSignedTarget(1)]),
    )

    expect(
      Array.from(document.querySelectorAll('a')).filter((element) =>
        element.textContent.includes('Download signed'),
      ),
    ).toHaveLength(1)

    const downloadAllAction = getActionElements('Download all signed')[0]
    expect(downloadAllAction).toBeTruthy()

    await React.act(async () => {
      ;(downloadAllAction as HTMLButtonElement).click()
      await Promise.resolve()
    })

    expect(onDownloadSignedCertificates).toHaveBeenCalledTimes(1)
  })

  it('keeps signed downloads hidden when downloads are not allowed', async () => {
    await renderSigningPage(
      <DocumentSigningPage batchId="batch-1" />,
      buildSigningContextFromTargets([buildSignedTarget(1)]),
    )

    expect(document.body.textContent).not.toContain('Download signed')
  })

  it('opens batch re-sign mode from the More menu', async () => {
    await renderSigningPage(
      <DocumentSigningPage batchId="batch-1" canDownloadSignedPdf />,
      buildSigningContextFromTargets([buildSignedTarget(1)]),
    )

    const reSignAction = getActionElements('Re-sign batch')[0]
    expect(reSignAction).toBeTruthy()

    await React.act(() => {
      ;(reSignAction as HTMLButtonElement).click()
    })

    expect(document.body.textContent).toContain('Apply re-sign')
    expect(document.body.textContent).toContain('Cancel')
  })

  it('keeps signed downloads available as secondary actions for active signed certificates in partial batches', async () => {
    const onDownloadSignedCertificates = vi.fn()
    await renderSigningPage(
      <DocumentSigningPage
        batchId="batch-1"
        canDownloadSignedPdf
        onDownloadSignedCertificates={onDownloadSignedCertificates}
      />,
      buildSigningContextFromTargets([buildSignedTarget(1), buildTarget(2)]),
    )

    const signedCertificateAction = getActionElements('Certificate Holder 1')[0]
    expect(signedCertificateAction).toBeTruthy()

    await React.act(() => {
      ;(signedCertificateAction as HTMLButtonElement).click()
    })

    expect(getActionElements('Sign certificate')).toHaveLength(2)
    expect(
      Array.from(document.querySelectorAll('a')).some((element) =>
        element.textContent.includes('Download signed'),
      ),
    ).toBe(true)
    expect(getActionElements('Download all signed')).toHaveLength(1)
  })

  it('shows a merge next-step flag after documents are signed', async () => {
    const readyTarget = buildReadyTarget(1)
    const fetchMock = globalThis.fetch as unknown as {
      mockResolvedValueOnce: (response: Response) => void
    }

    fetchMock.mockResolvedValueOnce(
      Response.json({
        signingContext: buildSigningContextFromTargets(
          [readyTarget],
          buildSignatureProfile(),
        ),
      }),
    )
    fetchMock.mockResolvedValueOnce(
      Response.json({
        signedArtifacts: [
          {
            documentResultId: readyTarget.documentResultId,
            status: 'signed',
            signedAt: '2026-06-05T09:00:00.000Z',
            signedByName: 'Tax Manager',
            signedPdfUrl: '/api/documents/target-1/signed-pdf',
            templatePlacement: readyTarget.templatePlacement,
          },
        ],
      }),
    )

    await renderIntoDocument(<DocumentSigningPage batchId="batch-1" />)

    await waitForAssertion(() => {
      expect(document.body.textContent).toContain('Large certificate batch')
    })

    const signAction = getActionElements('Sign certificate').at(-1)
    expect(signAction).toBeTruthy()

    await React.act(() => {
      ;(signAction as HTMLButtonElement).click()
    })

    await waitForAssertion(() => {
      expect(toastMocks.custom).toHaveBeenCalledTimes(1)
    })

    const [renderFlag, options] = toastMocks.custom.mock.calls[0] as [
      (toastId: string | number) => React.ReactNode,
      { duration: number; position: string },
    ]
    expect(options).toMatchObject({
      duration: 10_000,
      position: 'bottom-right',
    })

    const flagContainer = await renderIntoDocument(renderFlag('sign-toast'))

    expect(flagContainer.textContent).toContain('Certificate signed')
    expect(flagContainer.textContent).toContain('Large certificate batch')
    expect(flagContainer.textContent).toContain('Merge PDFs')

    const mergeAction = Array.from(
      flagContainer.querySelectorAll('button'),
    ).find((element) => element.textContent.includes('Merge PDFs'))
    expect(mergeAction).toBeTruthy()

    await React.act(() => {
      ;(mergeAction as HTMLButtonElement).click()
    })

    expect(toastMocks.dismiss).toHaveBeenCalledWith('sign-toast')
    expect(routerMocks.navigate).toHaveBeenCalledWith({ to: '/merge-pdfs' })
  })
})
