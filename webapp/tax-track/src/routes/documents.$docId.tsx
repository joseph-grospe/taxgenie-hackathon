import {
  Outlet,
  createFileRoute,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { IconArrowLeft } from '@tabler/icons-react'
import { useCallback, useEffect, useState } from 'react'

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
  DocumentDetailPage,
  getDocumentBackTo,
} from '@/components/document-detail-page'

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
      />
    </AppShell>
  )
}
