/* @vitest-environment jsdom */

import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'

import { OriginalPdfViewer } from '@/components/original-pdf-viewer'

const pdfMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  getPage: vi.fn(),
  getViewport: vi.fn(),
  renderPage: vi.fn(),
  cleanupPage: vi.fn(),
  destroyLoadingTask: vi.fn(),
}))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {
    workerSrc: '',
  },
  getDocument: pdfMocks.getDocument,
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
}))

vi.mock('@/components/ui/sheet', () => {
  const Div = ({ children, ...props }: React.ComponentProps<'div'>) => (
    <div {...props}>{children}</div>
  )

  return {
    Sheet: ({
      children,
      open,
      onOpenChange,
    }: {
      children: React.ReactNode
      open?: boolean
      onOpenChange?: (open: boolean) => void
    }) => (
      <div data-testid="original-pdf-sheet" data-open={String(open)}>
        {children}
        <button
          type="button"
          onClick={() => onOpenChange?.(false)}
          aria-label="Dismiss original PDF sheet"
        />
      </div>
    ),
    SheetContent: ({
      children,
      side: _side,
      ...props
    }: React.ComponentProps<'div'> & { side?: string }) => (
      <div {...props}>{children}</div>
    ),
    SheetDescription: Div,
    SheetHeader: Div,
    SheetTitle: Div,
  }
})

vi.mock('@/components/ui/separator', () => ({
  Separator: () => <div role="separator" />,
}))

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: (props: React.ComponentProps<'div'>) => <div {...props} />,
}))

const PDF_BYTES = Uint8Array.from([37, 80, 68, 70])
let container: HTMLDivElement
let root: Root | null

const createPdfResponse = () =>
  new Response(PDF_BYTES, {
    status: 200,
    headers: { 'content-type': 'application/pdf' },
  })

const installPdfMocks = (pageCount = 3) => {
  pdfMocks.getViewport.mockImplementation(({ scale }: { scale: number }) => ({
    width: 600 * scale,
    height: 800 * scale,
  }))
  pdfMocks.renderPage.mockImplementation(() => ({
    promise: Promise.resolve(),
    cancel: vi.fn(),
  }))
  pdfMocks.getPage.mockResolvedValue({
    getViewport: pdfMocks.getViewport,
    render: pdfMocks.renderPage,
    cleanup: pdfMocks.cleanupPage,
  })

  const pdfDocument = {
    numPages: pageCount,
    getPage: pdfMocks.getPage,
  }
  const loadingTask = {
    promise: Promise.resolve(pdfDocument),
    destroy: pdfMocks.destroyLoadingTask,
  }
  pdfMocks.getDocument.mockReturnValue(loadingTask)

  return { loadingTask, pdfDocument }
}

const renderViewer = async ({
  fileName = 'BIR2307_ACME.pdf',
  isVisible = true,
  onOpenChange,
  panelId = 'document-original-pdf-panel',
  sourceUrl = '/api/documents/upload-1/original-preview',
}: {
  fileName?: string
  isVisible?: boolean
  onOpenChange?: (open: boolean) => void
  panelId?: string
  sourceUrl?: string
} = {}) => {
  await React.act(() => {
    root?.render(
      <OriginalPdfViewer
        fileName={fileName}
        isVisible={isVisible}
        onOpenChange={onOpenChange}
        panelId={panelId}
        sourceUrl={sourceUrl}
      />,
    )
  })
}

beforeEach(() => {
  const actGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true

  vi.clearAllMocks()
  installPdfMocks()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    {} as CanvasRenderingContext2D,
  )
  Object.defineProperty(window, 'devicePixelRatio', {
    configurable: true,
    value: 2,
  })
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserverMock {
      readonly callback: ResizeObserverCallback

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
      }

      observe(target: Element) {
        this.callback(
          [
            {
              target,
              contentRect: { width: 600 },
            } as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver,
        )
      }

      disconnect() {}

      unobserve() {}
    },
  )
})

afterEach(() => {
  React.act(() => {
    root?.unmount()
  })
  root = null
  container.remove()
  const actGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }
  actGlobal.IS_REACT_ACT_ENVIRONMENT = false
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('OriginalPdfViewer', () => {
  it('shows a loading skeleton, then renders the first page fit to width', async () => {
    let resolveFetch: ((response: Response) => void) | undefined
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await renderViewer()

    expect(screen.getByTestId('original-pdf-sheet').dataset.open).toBe('true')
    expect(screen.getByText('Original PDF')).toBeTruthy()
    expect(screen.getByText('BIR2307_ACME.pdf')).toBeTruthy()
    expect(document.getElementById('document-original-pdf-panel')).toBeTruthy()
    expect(screen.getByLabelText('Loading original PDF preview')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/documents/upload-1/original-preview',
      expect.objectContaining({ cache: 'no-store' }),
    )

    await React.act(() => {
      resolveFetch?.(createPdfResponse())
    })

    await waitFor(() => {
      expect(screen.getByText(/Page 1 of 3/)).toBeTruthy()
      expect(pdfMocks.getPage).toHaveBeenCalledWith(1)
      expect(pdfMocks.renderPage).toHaveBeenCalled()
    })

    const canvas = screen.getByRole('img', {
      name: 'Original PDF page 1 of 3',
    })
    expect(canvas.width).toBe(1200)
    expect(canvas.height).toBe(1600)
    expect(canvas.style.width).toBe('600px')
    expect(canvas.style.height).toBe('800px')
  })

  it('navigates pages and disables controls at the document boundaries', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createPdfResponse()))

    await renderViewer()

    const previousButton = await screen.findByRole('button', {
      name: 'Previous',
    })
    const nextButton = screen.getByRole('button', { name: 'Next' })

    await waitFor(() => expect(pdfMocks.getPage).toHaveBeenCalledWith(1))
    expect((previousButton as HTMLButtonElement).disabled).toBe(true)
    expect((nextButton as HTMLButtonElement).disabled).toBe(false)

    await React.act(() => {
      fireEvent.click(nextButton)
    })
    await waitFor(() => {
      expect(screen.getByText(/Page 2 of 3/)).toBeTruthy()
      expect(pdfMocks.getPage).toHaveBeenCalledWith(2)
    })

    await React.act(() => {
      fireEvent.click(nextButton)
    })
    await waitFor(() => {
      expect(screen.getByText(/Page 3 of 3/)).toBeTruthy()
      expect(pdfMocks.getPage).toHaveBeenCalledWith(3)
    })

    expect((nextButton as HTMLButtonElement).disabled).toBe(true)
    expect((previousButton as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the server error and retries the preview request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Original file not found.' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(createPdfResponse())
    vi.stubGlobal('fetch', fetchMock)

    await renderViewer()

    expect(await screen.findByText('Preview unavailable')).toBeTruthy()
    expect(screen.getByText('Original file not found.')).toBeTruthy()

    await React.act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(screen.getByText(/Page 1 of 3/)).toBeTruthy()
    })
  })

  it('keeps the loaded document when hidden and shown again', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createPdfResponse())
    vi.stubGlobal('fetch', fetchMock)

    await renderViewer()

    await waitFor(() => expect(pdfMocks.getPage).toHaveBeenCalledWith(1))

    await renderViewer({ isVisible: false })
    await renderViewer({ isVisible: true })

    await waitFor(() => expect(pdfMocks.getPage).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(pdfMocks.getDocument).toHaveBeenCalledTimes(1)
  })

  it('reports sheet dismissals through the controlled open callback', async () => {
    const onOpenChange = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createPdfResponse()))

    await renderViewer({ onOpenChange })

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Dismiss original PDF sheet',
      }),
    )

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('cancels and destroys PDF.js work when unmounted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createPdfResponse()))

    await renderViewer()

    await waitFor(() => expect(pdfMocks.getDocument).toHaveBeenCalled())
    await React.act(() => {
      root?.unmount()
    })
    root = null

    expect(pdfMocks.destroyLoadingTask).toHaveBeenCalled()
  })
})
