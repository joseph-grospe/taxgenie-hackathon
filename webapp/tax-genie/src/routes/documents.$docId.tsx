import {
  Outlet,
  createFileRoute,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { IconArrowLeft, IconTrash } from '@tabler/icons-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import type { OperationalDocumentView } from '@/lib/documents-types'
import { authClient } from '@/lib/auth-client'
import {
  canAccessRoute,
  canExport,
  canRequestCertificateOverride,
  canSignCertificates,
  parseSessionContext,
} from '@/lib/access-control'
import { shouldUseHistoryBackForDocumentReferrer } from '@/lib/document-navigation'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DocumentDetailPage,
  getDocumentBackTo,
} from '@/components/document-detail-page'
import {
  isExtractionRetryActive,
  queueGeminiExtractionRetry,
} from '@/lib/extraction-retry-client'

const ACTIVE_RETRY_POLL_INTERVAL_MS = 8_000

type DocumentResponse = {
  document?: OperationalDocumentView
  error?: string
}

type DocumentDetailSearch = {
  from?: string
}

type OriginalPreviewState = {
  documentId: string
  isOpen: boolean
}

export const Route = createFileRoute('/documents/$docId')({
  validateSearch: (search): DocumentDetailSearch => ({
    from: typeof search.from === 'string' ? search.from : undefined,
  }),
  component: RouteComponent,
})

function RouteComponent() {
  const { docId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const { data: authSession } = authClient.useSession()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const [document, setDocument] = useState<OperationalDocumentView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRetryingExtraction, setIsRetryingExtraction] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeletingDocument, setIsDeletingDocument] = useState(false)
  const [originalPreviewState, setOriginalPreviewState] =
    useState<OriginalPreviewState | null>(null)
  const backTo = getDocumentBackTo(document)
  const isChildRoute = pathname.endsWith('/sign')
  const context = authSession?.user
    ? parseSessionContext(authSession.user)
    : null
  const canDownloadSignedPdf = Boolean(
    context && canExport.pdf(context.role, context.canExportPdf),
  )
  const canRequestOverride = Boolean(
    context && canRequestCertificateOverride(context.role),
  )
  const canAccessSigning = Boolean(
    context &&
    canAccessRoute('upload', context.role) &&
    canSignCertificates(context),
  )
  const canManageDocumentDeletion = Boolean(
    context && canAccessRoute('upload', context.role),
  )
  const canDeleteDocument = Boolean(
    canManageDocumentDeletion && document?.deletionEligibility?.canDelete,
  )
  const originalDocumentId = document?.id ?? ''
  const hasOriginalPdf = document?.canDownloadOriginalFile !== false
  const isOriginalPreviewOpen = Boolean(
    originalDocumentId &&
    hasOriginalPdf &&
    originalPreviewState?.documentId === originalDocumentId &&
    originalPreviewState.isOpen,
  )
  const hasOpenedOriginalPreview = Boolean(
    originalDocumentId &&
    hasOriginalPdf &&
    originalPreviewState?.documentId === originalDocumentId,
  )

  const refreshDocument = useCallback(async () => {
    setIsLoading(true)

    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(docId)}`,
        {
          cache: 'no-store',
        },
      )

      const payload = (await response
        .json()
        .catch(() => null)) as DocumentResponse | null

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            `Failed to load document detail (${response.status}).`,
        )
      }

      setDocument(payload?.document ?? null)
      setLoadError(null)
    } catch (error) {
      setDocument(null)
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Unable to load document detail.',
      )
    } finally {
      setIsLoading(false)
    }
  }, [docId])

  useEffect(() => {
    if (!isChildRoute) {
      void refreshDocument()
    }
  }, [isChildRoute, refreshDocument])

  const shouldPollExtractionRetry = isExtractionRetryActive(
    document?.extractionRetry,
  )

  useEffect(() => {
    if (isChildRoute || !shouldPollExtractionRetry) return

    const refreshIfVisible = () => {
      if (globalThis.document.visibilityState === 'visible') {
        void refreshDocument()
      }
    }
    const interval = window.setInterval(
      refreshIfVisible,
      ACTIVE_RETRY_POLL_INTERVAL_MS,
    )

    return () => window.clearInterval(interval)
  }, [isChildRoute, refreshDocument, shouldPollExtractionRetry])

  const handleRetryExtraction = useCallback(async () => {
    if (!document) return

    setIsRetryingExtraction(true)
    try {
      const retry = await queueGeminiExtractionRetry(document)
      toast.success('Extraction retry queued', {
        description: `Retry ${retry.retryNumber} will reuse the original PDF.`,
      })
      await refreshDocument()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Unable to queue the extraction retry.',
      )
      await refreshDocument()
    } finally {
      setIsRetryingExtraction(false)
    }
  }, [document, refreshDocument])

  const handleBack = useCallback(() => {
    if (search.from === 'error-detail') {
      void navigate({ to: '/upload' })
      return
    }

    if (typeof window !== 'undefined') {
      const referrer = globalThis.document.referrer

      if (
        shouldUseHistoryBackForDocumentReferrer(
          referrer,
          window.location.origin,
        ) &&
        window.history.length > 1
      ) {
        window.history.back()
        return
      }
    }

    void navigate({ to: backTo })
  }, [backTo, navigate, search.from])

  const handleOriginalPreviewOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!originalDocumentId || !hasOriginalPdf) return

      setOriginalPreviewState({
        documentId: originalDocumentId,
        isOpen,
      })
    },
    [hasOriginalPdf, originalDocumentId],
  )

  const handleDeleteDocument = useCallback(async () => {
    if (!document || isDeletingDocument) return
    setIsDeletingDocument(true)
    try {
      const response = await fetch(
        `/api/uploads/${encodeURIComponent(document.uploadId)}`,
        { method: 'DELETE' },
      )
      const payload = (await response.json().catch(() => null)) as {
        error?: string
      } | null
      if (!response.ok) {
        throw new Error(payload?.error || 'Unable to delete this document.')
      }
      toast.success('Permanent deletion queued.')
      setIsDeleteDialogOpen(false)
      handleBack()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Unable to delete this document.',
      )
      await refreshDocument()
    } finally {
      setIsDeletingDocument(false)
    }
  }, [document, handleBack, isDeletingDocument, refreshDocument])

  // This route is the parent of `/documents/$docId/sign`; render the child
  // page via <Outlet /> when we're on the signing URL.
  if (isChildRoute) {
    return <Outlet />
  }

  return (
    <AppShell
      title="Document Detail"
      subtitle="Review upload progress, validation outcomes, issue details, and generated certificate results."
      leadingActions={
        <Button type="button" size="sm" variant="outline" onClick={handleBack}>
          <IconArrowLeft data-icon="inline-start" />
          Back
        </Button>
      }
    >
      <DocumentDetailPage
        document={document}
        isLoading={isLoading}
        loadError={loadError}
        canDownloadSignedPdf={canDownloadSignedPdf}
        canAccessSigning={canAccessSigning}
        canRequestOverride={canRequestOverride}
        onOverrideRequested={refreshDocument}
        canManageMergeAssignments={canDownloadSignedPdf}
        onMergeAssignmentUpdated={refreshDocument}
        isOriginalPreviewOpen={isOriginalPreviewOpen}
        hasOpenedOriginalPreview={hasOpenedOriginalPreview}
        onOriginalPreviewOpenChange={handleOriginalPreviewOpenChange}
        isRetryingExtraction={isRetryingExtraction}
        onRetryExtraction={() => void handleRetryExtraction()}
        deletionAction={
          document && canManageDocumentDeletion
            ? {
                label:
                  document.purgeStatus === 'failed'
                    ? 'Retry deletion'
                    : 'Delete file',
                disabled: !canDeleteDocument || isDeletingDocument,
                disabledReason: isDeletingDocument
                  ? 'The deletion request is being submitted.'
                  : document.deletionEligibility?.canDelete === false
                    ? document.deletionEligibility.reason
                    : undefined,
                onSelect: () => setIsDeleteDialogOpen(true),
              }
            : undefined
        }
      />
      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          if (!isDeletingDocument) setIsDeleteDialogOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete this file?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes {document?.fileName ?? 'this file'}, its
              source PDF, extraction data, certificate records, and unsigned
              generated files. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingDocument}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!canDeleteDocument || isDeletingDocument}
              onClick={() => void handleDeleteDocument()}
            >
              <IconTrash data-icon="inline-start" />
              {isDeletingDocument ? 'Queuing...' : 'Delete permanently'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  )
}
