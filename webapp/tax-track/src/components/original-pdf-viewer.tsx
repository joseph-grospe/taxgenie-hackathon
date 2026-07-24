import { useEffect, useRef, useState } from 'react'
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from 'pdfjs-dist'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

type OriginalPdfViewerProps = {
  fileName: string
  isVisible: boolean
  onOpenChange?: (open: boolean) => void
  panelId?: string
  sourceUrl: string
}

type PreviewStatus = 'loading' | 'ready' | 'error'

const loadPdfJs = async () => {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()

  return pdfjs
}

const readResponseError = async (response: Response) => {
  const payload = (await response.json().catch(() => null)) as {
    error?: string
  } | null

  return (
    payload?.error || `Unable to load the original PDF (${response.status}).`
  )
}

const fetchOriginalPdfBytes = async (
  sourceUrl: string,
  signal: AbortSignal,
) => {
  const response = await fetch(sourceUrl, {
    cache: 'no-store',
    signal,
  })

  if (!response.ok) {
    throw new Error(await readResponseError(response))
  }

  return new Uint8Array(await response.arrayBuffer())
}

const toPreviewErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.name === 'AbortError') {
    return null
  }

  return error instanceof Error
    ? error.message
    : 'Unable to render the original PDF.'
}

export function OriginalPdfViewer({
  fileName,
  isVisible,
  onOpenChange,
  panelId,
  sourceUrl,
}: OriginalPdfViewerProps) {
  const [status, setStatus] = useState<PreviewStatus>('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [retryAttempt, setRetryAttempt] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const renderTaskRef = useRef<RenderTask | null>(null)

  useEffect(() => {
    const abortController = new AbortController()
    const requestWasAborted = () => abortController.signal.aborted
    let loadingTask: PDFDocumentLoadingTask | null = null

    const loadDocument = async () => {
      setStatus('loading')
      setErrorMessage('')
      setPdfDocument(null)
      setPageNumber(1)

      try {
        const [bytes, pdfjs] = await Promise.all([
          fetchOriginalPdfBytes(sourceUrl, abortController.signal),
          loadPdfJs(),
        ])

        if (abortController.signal.aborted) return

        loadingTask = pdfjs.getDocument({ data: bytes })
        const nextDocument = await loadingTask.promise

        if (requestWasAborted()) {
          await loadingTask.destroy()
          return
        }

        if (nextDocument.numPages < 1) {
          await loadingTask.destroy()
          loadingTask = null
          throw new Error('The original PDF does not contain any pages.')
        }

        setPdfDocument(nextDocument)
        setStatus('ready')
      } catch (error) {
        if (abortController.signal.aborted) return

        const message = toPreviewErrorMessage(error)
        if (message) {
          setErrorMessage(message)
          setStatus('error')
        }
      }
    }

    void loadDocument()

    return () => {
      abortController.abort()
      renderTaskRef.current?.cancel()
      renderTaskRef.current = null
      if (loadingTask) {
        void loadingTask.destroy()
      }
    }
  }, [retryAttempt, sourceUrl])

  useEffect(() => {
    if (!isVisible) return

    const viewport = viewportRef.current
    if (!viewport) return

    const updateWidth = (width: number) => {
      const nextWidth = Math.max(0, Math.floor(width))
      setViewportWidth((current) =>
        current === nextWidth ? current : nextWidth,
      )
    }
    const measureViewport = () =>
      updateWidth(viewport.getBoundingClientRect().width)

    measureViewport()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureViewport)
      return () => window.removeEventListener('resize', measureViewport)
    }

    const observer = new ResizeObserver((entries) => {
      const [entry] = entries
      updateWidth(entry.contentRect.width)
    })
    observer.observe(viewport)

    return () => observer.disconnect()
  }, [isVisible, status])

  useEffect(() => {
    if (!isVisible || status !== 'ready' || !pdfDocument || viewportWidth < 1) {
      return
    }

    const renderController = new AbortController()
    let pageCleanup: (() => void) | undefined

    const renderPage = async () => {
      try {
        const page = await pdfDocument.getPage(pageNumber)
        pageCleanup = () => page.cleanup()

        if (renderController.signal.aborted) return

        const baseViewport = page.getViewport({ scale: 1 })
        const cssScale = viewportWidth / baseViewport.width
        const pixelRatio = Math.max(window.devicePixelRatio || 1, 1)
        const renderViewport = page.getViewport({
          scale: cssScale * pixelRatio,
        })
        const canvas = canvasRef.current
        const context = canvas?.getContext('2d')

        if (!canvas || !context) {
          throw new Error('Canvas is not available.')
        }

        canvas.width = Math.floor(renderViewport.width)
        canvas.height = Math.floor(renderViewport.height)
        canvas.style.width = `${Math.floor(baseViewport.width * cssScale)}px`
        canvas.style.height = `${Math.floor(baseViewport.height * cssScale)}px`

        const renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport: renderViewport,
        })
        renderTaskRef.current = renderTask
        await renderTask.promise

        if (renderTaskRef.current === renderTask) {
          renderTaskRef.current = null
        }
      } catch (error) {
        if (renderController.signal.aborted) return

        const message = toPreviewErrorMessage(error)
        if (!message) return

        setErrorMessage(message)
        setStatus('error')
      }
    }

    void renderPage()

    return () => {
      renderController.abort()
      renderTaskRef.current?.cancel()
      renderTaskRef.current = null
      pageCleanup?.()
    }
  }, [isVisible, pageNumber, pdfDocument, status, viewportWidth])

  const pageCount = pdfDocument?.numPages ?? 0
  const handleRetry = () => {
    setRetryAttempt((current) => current + 1)
  }

  return (
    <Sheet
      open={isVisible}
      onOpenChange={(open) => {
        if (open !== isVisible) {
          onOpenChange?.(open)
        }
      }}
    >
      <SheetContent
        id={panelId}
        side="right"
        className="w-full overflow-hidden"
        style={{ width: 'min(100vw, 64rem)', maxWidth: '100vw' }}
      >
        <SheetHeader className="border-b border-border/60 pr-14">
          <SheetTitle>Original PDF</SheetTitle>
          <SheetDescription className="truncate" title={fileName}>
            {fileName}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <p
              className="text-xs text-muted-foreground"
              aria-live="polite"
              aria-atomic="true"
            >
              Page {status === 'ready' ? pageNumber : '—'} of{' '}
              {status === 'ready' ? pageCount : '—'}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={status !== 'ready' || pageNumber <= 1}
                onClick={() =>
                  setPageNumber((current) => Math.max(1, current - 1))
                }
              >
                Previous
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={status !== 'ready' || pageNumber >= pageCount}
                onClick={() =>
                  setPageNumber((current) => Math.min(pageCount, current + 1))
                }
              >
                Next
              </Button>
            </div>
          </div>
          <Separator />

          {status === 'loading' ? (
            <div className="min-h-0 flex-1 p-4">
              <Skeleton
                className="h-full min-h-80 w-full"
                aria-label="Loading original PDF preview"
              />
            </div>
          ) : status === 'error' ? (
            <div className="min-h-0 flex-1 p-4">
              <Alert variant="destructive">
                <AlertTitle>Preview unavailable</AlertTitle>
                <AlertDescription>
                  <p>{errorMessage || 'Unable to render the original PDF.'}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={handleRetry}
                  >
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto bg-muted/30 p-4">
              <div ref={viewportRef} className="mx-auto w-full">
                <canvas
                  ref={canvasRef}
                  className="block max-w-full rounded-md border border-border bg-background shadow-sm"
                  role="img"
                  aria-label={`Original PDF page ${pageNumber} of ${pageCount}`}
                />
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
