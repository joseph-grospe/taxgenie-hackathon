/* @vitest-environment jsdom */

import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'

import type {
  SigningContextView,
  SigningTargetView,
} from '@/lib/signing-module'
import { DocumentSigningPage } from '@/components/document-signing-page'

const pdfMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  getPage: vi.fn(),
  renderPage: vi.fn(),
}))

const virtualizerMocks = vi.hoisted(() => ({
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
}))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {
    workerSrc: '',
  },
  getDocument: pdfMocks.getDocument,
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
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
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

  await React.act(async () => {
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
): SigningContextView => ({
  documentId: 'batch-1',
  fileName: 'Large certificate batch',
  certificateCount: targets.length,
  targets,
  signatureProfile: null,
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
    element.textContent?.includes(label),
  )

beforeEach(() => {
  const actGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true

  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        signingContext: buildSigningContext(60),
      }),
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
    await React.act(async () => {
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
})

describe('DocumentSigningPage', () => {
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

  it('prioritizes signed downloads for fully signed downloadable batches', async () => {
    await renderSigningPage(
      <DocumentSigningPage batchId="batch-1" canDownloadSignedPdf />,
      buildSigningContextFromTargets([buildSignedTarget(1)]),
    )

    const signedDownloadLinks = Array.from(
      document.querySelectorAll('a'),
    ).filter((element) => element.textContent?.includes('Download signed'))

    expect(signedDownloadLinks).toHaveLength(1)
    expect(signedDownloadLinks[0]?.getAttribute('href')).toBe(
      '/api/documents/target-1/signed-pdf',
    )
    expect(getActionElements('Batch signed')).toHaveLength(0)
    expect(getActionElements('Document signed')).toHaveLength(0)
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

    await React.act(async () => {
      ;(reSignAction as HTMLButtonElement).click()
    })

    expect(document.body.textContent).toContain('Apply re-sign')
    expect(document.body.textContent).toContain('Cancel')
  })

  it('keeps signed downloads available as secondary actions for active signed certificates in partial batches', async () => {
    await renderSigningPage(
      <DocumentSigningPage batchId="batch-1" canDownloadSignedPdf />,
      buildSigningContextFromTargets([buildSignedTarget(1), buildTarget(2)]),
    )

    const signedCertificateAction = getActionElements('Certificate Holder 1')[0]
    expect(signedCertificateAction).toBeTruthy()

    await React.act(async () => {
      ;(signedCertificateAction as HTMLButtonElement).click()
    })

    expect(getActionElements('Sign certificate')).toHaveLength(2)
    expect(
      Array.from(document.querySelectorAll('a')).some((element) =>
        element.textContent?.includes('Download signed'),
      ),
    ).toBe(true)
  })
})
